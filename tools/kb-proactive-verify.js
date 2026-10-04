// 验证实验：① 启动主动续期是否能避免"被其他设备登录顶掉 refresh_token"。
//   X 组（模拟 ①）：signIn S1 → **先 refresh S1 一次** → signIn S2 → refresh S1 → 应仍成功
//   Y 组（对照）    ：signIn S1 → signIn S2 → refresh S1 → 已知失败（4026）
// 每轮都记录续期状态码与函数调用状态（401 表示会话已死）。
// 只测平台会话行为，不依赖 kb_users 行。
const ENV = 'weichi-d4gfw5uo1334e0ffb';
const KEY = process.env.KB_PUB_KEY;
const USER = process.env.KB_TEST_USER;
const PASS = process.env.KB_TEST_PASS;
const GW = `https://${ENV}.api.tcloudbasegateway.com`;
const ITER = 4;

async function post(path, body, headers = {}) {
  const r = await fetch(GW + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: KEY, ...headers },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 非 JSON */ }
  return { status: r.status, json, text: text.slice(0, 100) };
}

async function signIn() {
  const r = await post('/auth/v1/signin', { username: USER, password: PASS });
  return { access: r.json?.access_token, refresh: r.json?.refresh_token, status: r.status };
}

async function refresh(s) {
  const r = await post('/auth/v1/token', { grant_type: 'refresh_token', refresh_token: s.refresh });
  if (r.status === 200) {
    s.access = r.json.access_token;
    s.refresh = r.json.refresh_token || s.refresh;
  }
  return { status: r.status, err: String(r.json?.error_description || '').slice(0, 60) };
}

async function probe(s) {
  const r = await post('/v1/functions/kbGetMyRole', {}, { Authorization: 'Bearer ' + s.access });
  return r.status;
}

async function runGroup(label, proactive) {
  const rows = [];
  for (let i = 1; i <= ITER; i += 1) {
    const s1 = await signIn();
    let pre = { status: 0 };
    if (proactive) {
      pre = await refresh(s1);            // ① 的核心：登录后先把自己续期一次
    }
    const s2 = await signIn();            // 另一台设备登录
    const after = await refresh(s1);      // 关键判定：先登录的一方还能否续期
    const p1 = await probe(s1);
    const p2 = await probe(s2);
    rows.push({ i, pre: pre.status, after: after.status, err: after.err, p1, p2 });
  }
  return rows;
}

(async () => {
  const X = await runGroup('X', true);
  const Y = await runGroup('Y', false);

  const show = (label, rows) => {
    console.log(`\n=== ${label} ===`);
    for (const r of rows) {
      console.log(`  轮${r.i}: 预续期 ${r.pre} | 他端登录后续期 ${r.after}${r.err ? ' <' + r.err + '>' : ''} | 调用 S1/S2 ${r.p1}/${r.p2}`);
    }
    const ok = rows.filter((r) => r.after === 200).length;
    console.log(`  小结：他端登录后仍能续期 ${ok}/${rows.length}`);
    return ok;
  };
  const x = show('X 组：登录后先续期一次（模拟 ①）', X);
  const y = show('Y 组：登录后不续期（对照）', Y);

  console.log(`\n结论：X=${x}/${X.length} 成功，Y=${y}/${Y.length} 成功`);
  if (x > y) {
    console.log('⇒ ①（启动主动续期）有效：先续期过的会话在另一设备登录后仍可续期 ✔');
  } else if (x === 0 && y === 0) {
    console.log('⇒ 两组都失败：① 不足以规避，需要回到产品层面（降级提示或改用多会话方案）');
  } else {
    console.log('⇒ 两组表现接近：① 的效果不明确，需加大样本或改时序再验');
  }
})();
