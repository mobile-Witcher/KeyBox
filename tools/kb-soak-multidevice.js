// §6.4-B 多端并发 / 静置自动化冒烟（一次性测试账号，用完即删）
// 模拟 4 个独立客户端：4 个不同 x-device-id 各登一次；静置 30 分钟期间每 5 分钟心跳；
// 结束前做「单会话续期是否踢掉其它会话」「跨会话数据一致性」「非管理员越权调用」三项判定。
const ENV = 'weichi-d4gfw5uo1334e0ffb';
const KEY = process.env.KB_PUB_KEY;   // 环境 publishable key（客户端公开密钥）
const USER = process.env.KB_TEST_USER;   // 一次性测试账号（用完即删）
const PASS = process.env.KB_TEST_PASS;
const GW = `https://${ENV}.api.tcloudbasegateway.com`;
const MIN = 60 * 1000;

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function post(path, body, headers = {}) {
  const r = await fetch(GW + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: KEY, ...headers },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 非 JSON */ }
  return { status: r.status, json, text: text.slice(0, 160) };
}

async function signIn(deviceId) {
  const r = await post('/auth/v1/signin', { username: USER, password: PASS }, { 'x-device-id': deviceId });
  if (r.status !== 200) throw new Error(`signin ${r.status} ${r.text}`);
  return {
    deviceId,
    access: r.json.access_token,
    refresh: r.json.refresh_token,
    expiresIn: r.json.expires_in,
    accessTag: r.json.access_token.slice(-12),
    refreshes: 0,
  };
}

const callFn = (s, name, data = {}) =>
  post('/v1/functions/' + name, data, { Authorization: 'Bearer ' + s.access, 'x-device-id': s.deviceId });

async function refresh(s) {
  const r = await post('/auth/v1/token?grant_type=refresh_token', { refresh_token: s.refresh }, { 'x-device-id': s.deviceId });
  if (r.status !== 200) return { ok: false, status: r.status, text: r.text };
  s.access = r.json.access_token;
  s.refresh = r.json.refresh_token || s.refresh;
  s.accessTag = r.json.access_token.slice(-12);
  s.refreshes++;
  return { ok: true, status: r.status, expiresIn: r.json.expires_in };
}

// 客户端语义：401 时用 refresh_token 静默续期一次并重放原请求
async function callWithRenew(s, name, data = {}) {
  let r = await callFn(s, name, data);
  if (r.status === 401) {
    const rf = await refresh(s);
    if (!rf.ok) return { ...r, renewFailed: rf };
    r = await callFn(s, name, data);
    return { ...r, renewed: true };
  }
  return r;
}

(async () => {
  const t0 = Date.now();
  const out = { env: ENV, startedAt: new Date().toISOString(), sessions: [], heartbeats: [], final: {} };

  log('== 阶段 1：4 个独立设备会话（4 个不同 x-device-id）==');
  const sessions = [];
  for (let i = 1; i <= 4; i++) {
    const s = await signIn(`kb-soak-device-${i}`);
    sessions.push(s);
    const r = await callFn(s, 'kbGetMyRole');
    log(`  device-${i}: signin ok access_expires=${s.expiresIn}s kbGetMyRole=${r.status}`,
      r.status === 200 ? JSON.stringify(r.json).slice(0, 140) : r.text);
    out.sessions.push({ device: s.deviceId, expiresIn: s.expiresIn, firstCall: r.status, body: r.json ?? r.text });
  }

  log('== 阶段 2：静置 30 分钟（每 5 分钟心跳一次，模拟客户端保持登录）==');
  for (let round = 1; round <= 6; round++) {
    await new Promise((res) => setTimeout(res, 5 * MIN));
    const row = { minute: round * 5, results: [] };
    for (const s of sessions) {
      const r = await callWithRenew(s, 'kbGetMyRole');
      row.results.push({ device: s.deviceId, status: r.status, renewed: !!r.renewed, refreshCount: s.refreshes });
    }
    const bad = row.results.filter((x) => x.status !== 200);
    log(`  +${round * 5}min: ${row.results.map((x) => `${x.device.slice(-1)}:${x.status}${x.renewed ? '(续期)' : ''}`).join(' ')}${bad.length ? '  <-- 异常' : ''}`);
    out.heartbeats.push(row);
  }

  log('== 阶段 3：结束判定 ==');
  const a = sessions[0];
  const beforeTag = a.accessTag;
  const rf = await refresh(a);
  log(`  ① 会话A 主动续期: ${rf.ok ? 'OK' : 'FAILED ' + JSON.stringify(rf)}  token尾12位 ${beforeTag} -> ${a.accessTag}`);
  out.final.manualRefresh = { ok: rf.ok, tokenChanged: beforeTag !== a.accessTag, ...rf };

  const afterA = await callFn(a, 'kbGetMyRole');
  const others = [];
  for (const s of sessions.slice(1)) {
    const r = await callFn(s, 'kbGetMyRole');
    others.push({ device: s.deviceId, status: r.status, tag: s.accessTag });
  }
  log(`  ② 续期后 A=${afterA.status}；其余会话 ${others.map((o) => o.device.slice(-1) + ':' + o.status).join(' ')}`);
  out.final.otherSessionsAfterRefresh = others;
  out.final.othersUnaffected = afterA.status === 200 && others.every((o) => o.status === 200);

  const bodies = [];
  for (const s of sessions) {
    const r = await callFn(s, 'kbGetMyRole');
    bodies.push(JSON.stringify(r.json));
  }
  const identical = bodies.every((b) => b === bodies[0]);
  log(`  ③ 四会话返回体一致: ${identical ? 'YES' : 'NO'}`);
  out.final.consistentAcrossSessions = identical;
  out.final.sampleBody = bodies[0];

  const esc = await callFn(a, 'kbInviteCreate', {});
  log(`  ④ 普通用户越权调用 kbInviteCreate: HTTP ${esc.status} ${JSON.stringify(esc.json).slice(0, 120)}`);
  out.final.privilegeEscalation = { status: esc.status, body: esc.json ?? esc.text };

  const s5 = await signIn(a.deviceId);
  const aStill = await callFn(a, 'kbGetMyRole');
  const s5ok = await callFn(s5, 'kbGetMyRole');
  log(`  ⑤ 同一 device-id 再次登录：旧会话A=${aStill.status} 新会话=${s5ok.status}`);
  out.final.sameDeviceSecondLogin = { oldSession: aStill.status, newSession: s5ok.status };

  out.finishedAt = new Date().toISOString();
  out.elapsedMinutes = Math.round((Date.now() - t0) / MIN);
  require('fs').writeFileSync(process.env.TEMP + '\\kb-soak-result.json', JSON.stringify(out, null, 1));
  log('== 完成，结果写入 %TEMP%\\kb-soak-result.json ==');
  console.log(JSON.stringify(out.final, null, 1));
})().catch((e) => {
  console.error('SOAK FAILED', e);
  process.exit(1);
});
