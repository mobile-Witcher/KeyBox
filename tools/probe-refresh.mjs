/**
 * 实测：CloudBase refresh_token 是否轮换（多端并存的根因验证）
 *
 * 方法：用同一账号连续调用两次 /auth/v1/token（模拟两个端各自续期），
 * 观察 ① 两次是否都成功 ② 返回的 refresh_token 是否不同 ③ 旧的刷新后还能否用
 *
 * 用法：ENV_ID / REFRESH_TOKEN 从环境变量传入（不写死在文件里）
 */
const ENV_ID = process.env.ENV_ID;
const RT = process.env.REFRESH_TOKEN;

async function refresh(label, token) {
  const res = await fetch(`https://${ENV_ID}.api.tcloudbasegateway.com/auth/v1/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: ENV_ID,
      client_secret: '',
      grant_type: 'refresh_token',
      refresh_token: token,
    }),
  });
  const text = await res.text();
  let obj = {};
  try { obj = JSON.parse(text); } catch {}
  const out = {
    label,
    http: res.status,
    ok: res.ok,
    newRefresh: obj.refresh_token ? obj.refresh_token.slice(0, 16) + '…' : '(无)',
    sameAsInput: obj.refresh_token === token,
    hasAccess: Boolean(obj.access_token),
    err: obj.error || obj.message || text.slice(0, 120),
  };
  console.log(JSON.stringify(out, null, 1));
  return obj;
}

(async () => {
  if (!ENV_ID || !RT) {
    console.log('缺少 ENV_ID 或 REFRESH_TOKEN 环境变量，跳过实测');
    return;
  }
  // 第一轮续期（模拟设备 A）
  const r1 = await refresh('第 1 次续期（设备A）', RT);
  // 第二轮：用同一个旧 token 再续期（模拟设备 B 拿着同一个 token）
  const r2 = await refresh('第 2 次续期（设备B，用同一个旧 token）', RT);
  console.log('---');
  console.log('结论提示：');
  console.log('  若第2次失败 → 服务端轮换 refresh_token，旧的用一次即失效（多端抢刷新会互踢）');
  console.log('  若两次都成功且返回新 token → 未轮换，多端可并存');
  console.log('  若 r1 返回的新 token 与输入相同 → 不轮换');
})();
