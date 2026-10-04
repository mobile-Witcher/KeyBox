/**
 * step8Security.test.ts —— 第 8 步【静态安全断言】测试（team-lead 第 6 条）。
 *
 * 做法：直接读源码/迁移文件文本做断言（含注释剔除，避免被"注释里写着禁令"误导），
 *   - 无 `CREATE VIEW`（PG 的 View 默认 security_definer 会绕过 RLS，是 R10 的隐形杀手）；
 *   - 云函数无 `select *`、无任何 `console.*`（防把密文/敏感值打进日志）；
 *   - 管理员界面无任何"查看密钥"入口，且 step-8 代码不引用密文/敏感列；
 *   - kbAdminDeleteUserData 只用 return=minimal，绝无 representation / RETURNING；
 *   - 迁移确实 DROP 掉了 kb_secrets_delete_by_admin（R14 收口）；
 *   - kb_admin_user_list() 返回白名单列、kb_secrets 的 SELECT 策略不含 is_admin()（R10/R12 的 DB 保证）。
 *
 * 只读断言，不修改任何生产文件。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { repoRoot } from "./testRepoRoot";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = repoRoot();
const SRC = resolve(REPO, "src");
const CLOUD = resolve(REPO, "cloudfunctions");
const MIGRATIONS = resolve(REPO, "cloudbase/migrations");

/** 递归收集指定扩展名的文件（跳过 node_modules/dist/.git）。 */
function walk(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === ".git") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p, exts));
    else if (exts.some((e) => name.endsWith(e))) out.push(p);
  }
  return out;
}

/** 去掉块注释与行注释；行注释仅在 `//` 前不是冒号时剔除，避免误伤 https://。 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const cloudJs = (): string[] => walk(CLOUD, [".js"]);
/** 仅生产源码（排除 *.test.ts(x)：测试用例自身会包含这些关键字，避免自指误报）。 */
const srcProd = (): string[] => walk(SRC, [".ts", ".tsx"]).filter((f) => !/\.test\.tsx?$/.test(f));
const code = (f: string): string => stripComments(readFileSync(f, "utf8"));

describe("静态安全：无 View（防绕过 RLS）", () => {
  it("src/ 与 cloudfunctions/ 生产代码全仓无 CREATE VIEW", () => {
    const offenders = [...srcProd(), ...cloudJs()].filter((f) =>
      /CREATE\s+VIEW/i.test(readFileSync(f, "utf8"))
    );
    expect(offenders).toEqual([]);
  });
});

describe("静态安全：云函数查询与日志纪律", () => {
  it("云函数无 `select *`（剔除注释后）", () => {
    const offenders = cloudJs().filter((f) => /\bselect\s*\*/i.test(code(f)));
    expect(offenders).toEqual([]);
  });

  it("云函数无任何 console.* 调用（防敏感值入日志）", () => {
    const offenders = cloudJs().filter((f) => /console\.\w+\s*\(/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("src/ 与 cloudfunctions/ 无把 payload 变量直接送进日志的语句", () => {
    const files = [...srcProd(), ...cloudJs()];
    const offenders = files.filter((f) =>
      readFileSync(f, "utf8")
        .split("\n")
        .some((line) => /(log\.(info|warn|error)|console\.\w+)\s*\([^)]*\bpayload\b/.test(line))
    );
    expect(offenders).toEqual([]);
  });
});

describe("静态安全：管理员界面无查看密钥入口（R10/R12）", () => {
  const adminPage = readFileSync(resolve(SRC, "pages/AdminPage.tsx"), "utf8");
  const adminLib = readFileSync(resolve(SRC, "lib/admin.ts"), "utf8");

  it("AdminPage 代码（去注释）无任何“查看密钥/明文”入口文案或 handlers", () => {
    const c = stripComments(adminPage);
    expect(c).not.toMatch(/查看密钥|查看明文|显示密钥|读取密钥/);
    expect(c).not.toMatch(/showKey|revealKey|revealSecret|decrypt/i);
  });

  it("AdminPage 与 admin.ts 不引用密文字段或敏感列（payload / kdf_* / login_hash）", () => {
    for (const f of [adminPage, adminLib]) {
      const c = stripComments(f);
      expect(c).not.toMatch(/\bpayload\b/);
      expect(c).not.toMatch(/kdf_verifier|kdf_salt|login_hash/);
    }
  });

  it("admin.ts 的 R13 更新只提交 status（源码层面无“整行对象”写法）", () => {
    const c = stripComments(adminLib);
    expect(c).toMatch(/update\(\s*\{\s*status\s*\}\s*\)/);
    expect(c).toMatch(/\.eq\(\s*"uid"/);
  });
});

describe("静态安全：管理入口按云端 role 门控（R11）", () => {
  it("App.tsx：仅 role==='admin' 时才传入 onOpenAdmin（角色来自 api.getMyRole）", () => {
    const app = readFileSync(resolve(SRC, "App.tsx"), "utf8");
    expect(app).toMatch(/api\.getMyRole\(\)/);
    expect(app).toMatch(/role\s*===\s*"admin"\s*\?\s*\(\)\s*=>\s*setScreen\("admin"\)\s*:\s*undefined/);
  });
});

describe("静态安全：R14 删除云函数的返回纪律", () => {
  const delSrc = readFileSync(resolve(CLOUD, "kbAdminDeleteUserData/index.js"), "utf8");
  const delCode = stripComments(delSrc);

  it("删除请求只用 return=minimal", () => {
    expect(delCode).toMatch(/return=minimal/);
  });

  it("源码（去注释）绝无 return=representation，也绝无 RETURNING 关键字", () => {
    expect(delCode).not.toMatch(/return=representation/i);
    expect(delCode).not.toMatch(/\bRETURNING\b/i);
  });

  it("入参只读 event.uid（不存在 event.role / event.isAdmin 之类身份字段）", () => {
    expect(delSrc).toMatch(/event\s*&&\s*event\.uid/);
    expect(delSrc).not.toMatch(/event\.(role|isAdmin|is_admin|owner_id|payload)/);
  });
});

describe("静态安全：迁移收口 R14 + R10/R12 的数据库保证", () => {
  const initFile = resolve(MIGRATIONS, "20260927193625_init_keybox.sql");
  const initSql = readFileSync(initFile, "utf8");

  it("存在 DROP kb_secrets_delete_by_admin 的迁移（R14 直连无范围删除敞口已堵）", () => {
    const drop = readdirSync(MIGRATIONS).find((n) => n.endsWith("_drop_kb_secrets_delete_by_admin.sql"));
    expect(drop).toBeTruthy();
    const sql = readFileSync(resolve(MIGRATIONS, drop as string), "utf8");
    expect(sql).toMatch(/DROP POLICY IF EXISTS\s+kb_secrets_delete_by_admin\s+ON\s+public\.kb_secrets/i);
  });

  it("初始迁移建了 7 条策略、其中含 delete_by_admin；drop 后应为 6 条", () => {
    const creates = initSql.match(/CREATE POLICY/g) ?? [];
    expect(creates.length).toBe(7);
    expect(initSql).toMatch(/CREATE POLICY kb_secrets_delete_by_admin/);
  });

  it("kb_admin_user_list() 只返回白名单 5 列、函数体内自检 is_admin、绝不含 payload", () => {
    const fn = initSql.match(/CREATE OR REPLACE FUNCTION public\.kb_admin_user_list[\s\S]*?\$\$;/)?.[0] ?? "";
    expect(fn).not.toBe("");
    expect(fn).toMatch(
      /RETURNS TABLE \(uid text, username text, status text, created_at timestamptz, item_count bigint\)/
    );
    expect(fn).toMatch(/public\.is_admin\(\)/);
    expect(fn).not.toMatch(/payload|login_hash|kdf_/);
  });

  it("kb_secrets 的 SELECT 策略只按 owner_id=自己，【不含】is_admin（管理员读不到他人密文）", () => {
    const sel = initSql.match(/CREATE POLICY kb_secrets_select_own[\s\S]*?;/)?.[0] ?? "";
    expect(sel).not.toBe("");
    expect(sel).toMatch(/owner_id = \(select auth\.uid\(\)\)/);
    expect(sel).not.toMatch(/is_admin/);
  });

  it("kb_users 列级授权只放开 status 一列（管理员改不了登录哈希）", () => {
    expect(initSql).toMatch(/GRANT UPDATE \(status\) ON public\.kb_users TO authenticated/);
    expect(initSql).not.toMatch(/GRANT UPDATE \(.*login_hash.*\)/);
  });
});
