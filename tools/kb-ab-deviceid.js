// A/B 反证实验：验证「不带 x-device-id ⇒ 多端会话互相顶掉」这一真因。
//   A 组：登录/续期【完全不带】x-device-id
//   B 组：登录/续期【带】各自的随机 x-device-id
// 每组重复 N 轮，每轮：两个会话各自登录 → 各自续期 → 各自调用一次函数；
// 记录续期状态码与错误、以及调用状态码（401 表示该会话已死）。
// 只测平台会话行为，不依赖 kb_users 行（函数调用只取 HTTP 状态码）。
const ENV = 'weichi-d4gfw5uo1334e0ffb';
const KEY = process.env.KB_PUB_KEY;
const USER = process.env.KB_TEST_USER;
const PASS = process.env.KB_TEST_PASS;
const GW = `https://${ENV}.api.tcloudbasegateway.com`;
const ITER = 3;

async function post(path, body, headers = {}) {
  const r = await fetch(GW + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: KEY, ...headers },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 非 JSON */ }
  return { status: r.status, json, text: text.slice(0, 120) };
}

async function signIn(deviceId) {
  const h = deviceId ? { 'x-device-id': deviceId } : {};
  const r = await post('/auth/v1/signin', { username: USER, password: PASS }, h);
  return { deviceId, access: r.json?.access_token, refresh: r.json?.refresh_token, status: r.status };
}

async function refresh(s) {
  const h = s.deviceId ? { 'x-device-id': s.deviceId } : {};
  const r = await post('/auth/v1/token', { grant_type: 'refresh_token', refresh_token: s.refresh }, h);
  if (r.status === 200) {
    s.access = r.json.access_token;
    s.refresh = r.json.refresh_token || s.refresh;
  }
  const desc = r.json?.error_description || r.json?.error || '';
  return { status: r.status, err: String(desc).slice(0, 70) };
}

async function probe(s) {
  const h = s.deviceId ? { 'x-device-id': s.deviceId } : {};
  const r = await post('/v1/functions/kbGetMyRole', {}, { ...h, Authorization: 'Bearer ' + s.access });
  return r.status;
}

async function runGroup(label, withHeader) {
  const out = [];
  for (let i = 1; i <= ITER; i += 1) {
    const d1 = withHeader ? `ab-${label}1-${i}-${Math.random().toString(36).slice(2, 8)}` : null;
    const d2 = withHeader ? `ab-${label}2-${i}-${Math.random().toString(36).slice(2, 8)}` : null;
    const s1 = await signIn(d1);
    const s2 = await signIn(d2);
    const r1 = await refresh(s1);
    const r2 = await refresh(s2);
    const p1 = await probe(s1);
    const p2 = await probe(s2);
    out.push({ i, sign1: s1.status, sign2: s2.status, r1: r1.status, r1err: r1.err, r2: r2.status, r2err: r2.err, p1, p2 });
  }
  return out;
}

(async () => {
  const A = await runGroup('A', false);   // 不带 x-device-id
  const B = await runGroup('B', true);    // 带各自 device-id

  const show = (label, rows) => {
    console.log(`\n=== ${label} ===`);
    for (const r of rows) {
      console.log(`  轮${r.i}: signin ${r.sign1}/${r.sign2} | 续期A ${r.r1}${r.r1err ? ' <' + r.r1err + '>' : ''} | 续期B ${r.r2}${r.r2err ? ' <' + r.r2err + '>' : ''} | 调用A/B ${r.p1}/${r.p2}`);
    }
    const badRefresh = rows.filter((r) => r.r1 !== 200 || r.r2 !== 200).length;
    const deadSession = rows.filter((r) => r.p1 === 401 || r.p2 === 401).length;
    console.log(`  小结：续期失败轮数 ${badRefresh}/${rows.length} · 出现 401 的轮数 ${deadSession}/${rows.length}`);
  };
  show('A 组：不带 x-device-id', A);
  show('B 组：带各自 x-device-id', B);

  const rate = (rows) => {
    const bad = rows.filter((r) => r.r1 !== 200 || r.r2 !== 200).length;
    return `${bad}/${rows.length}`;
  };
  console.log(`\n结论数据：续期失败轮数  A=${rate(A)}  B=${rate(B)}（每轮 2 次续期机会）`);
})();
