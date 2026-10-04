/**
 * setupCloud.test.ts —— scripts/setup-cloud.js 的可本机验证部分（R27）。
 *
 * 覆盖：参数解析、迁移文件名解析、迁移读取与 SQL 透传、凭据解析与"缺哪个/去哪儿拿"的提示、
 *   幂等计划（只做差量、不覆盖既有）、CLI 客户端的命令拼装与 fail-closed 行为。
 *
 * ⚠️ **端到端下发（真实打到云端）标"待控制台配置后验证"** —— 需要真实 envId + 已配置的
 *   控制台（自定义登录/私钥/Publishable Key），本单测**不**触碰真实 CloudBase，只验证编排与命令拼装。
 *
 * 隔离方式：`scripts/setup-cloud.js` 是 ESM，用【动态 import】加载真源码；其 CLI 由
 *   `import.meta.url === pathToFileURL(process.argv[1])` 守卫，被 import 时无副作用。
 */
import * as nodeFs from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url)); // src/lib
const PROJECT_ROOT = resolve(here, "../..");
const SCRIPT_PATH = resolve(PROJECT_ROOT, "scripts/setup-cloud.js");

interface Migration {
  version: string;
  name: string;
  file?: string;
  sql: string;
}
interface PlanResult {
  pendingMigrations: Migration[];
  domainsToAdd: string[];
  invokeRuleAction: string;
}
interface SetupModule {
  MIGRATIONS_DIR: string;
  DEFAULT_SECURITY_DOMAINS: string[];
  PUBLIC_FUNCTIONS: string[];
  WILDCARD_INVOKE_RULE: string;
  MINIMAL_INVOKE_RULE: string;
  LOGIN_REQUIRED_INVOKE_RULE: string;
  DESIRED_FUNCTION_INVOKE_RULE: string;
  INVOKE_PRESETS: Record<string, string>;
  DEFAULT_INVOKE_PRESET: string;
  MIN_TCB_VERSION: string;
  DOCS_HINT: string;
  SetupError: new (code: string, message: string) => Error & { code: string };
  buildInvokeRule: (functions?: string[]) => string;
  resolveInvokeRule: (preset?: string) => string;
  cliMissingHint: (tcbBin?: string) => string;
  versionDriftHint: (subcommand?: string) => string;
  parseArgs: (argv: string[]) => {
    env: string;
    dryRun: boolean;
    yes: boolean;
    help: boolean;
    json: boolean;
    forceInvokeRule: boolean;
    invokeRule: string;
  };
  parseMigrationFilename: (f: string) => { version: string; name: string } | null;
  loadMigrations: (
    dir: string,
    fsImpl?: { readFileSync: (p: string) => string; readdirSync: (p: string) => string[] }
  ) => Array<{ version: string; name: string; file: string; sql: string }>;
  resolveEnvId: (env: Record<string, string | undefined>, flags?: { env?: string }) => string;
  resolveApiKey: (env: Record<string, string | undefined>) => string;
  normalizeRule: (r: string | null | undefined) => string | null;
  rulesEqual: (a: unknown, b: unknown) => boolean;
  planSetup: (input: Record<string, unknown>) => PlanResult;
  createCliClient: (opts: Record<string, unknown>) => CliClient;
  runSetup: (client: unknown, options: Record<string, unknown>) => Promise<{
    dryRun: boolean;
    plan: PlanResult;
    applied: string[];
    domainsAdded: string[];
    invokeRuleApplied: boolean;
  }>;
}
interface CliCall {
  file: string;
  args: string[];
}
interface CliClient {
  listMigrations: () => Promise<string[]>;
  applyMigration: (m: Migration) => Promise<void>;
  getFunctionInvokeRule: () => Promise<{ found: boolean; rule: string | null }>;
  setFunctionInvokeRule: (rule: string) => Promise<void>;
  listSecurityDomains: () => Promise<string[]>;
  addSecurityDomains: (domains: string[]) => Promise<void>;
}

const mod = (await import(/* @vite-ignore */ pathToFileURL(SCRIPT_PATH).href)) as SetupModule;

// ---------------------------------------------------------------------------
// 参数解析
// ---------------------------------------------------------------------------
describe("setup-cloud：参数解析", () => {
  it("解析 --env/-e/--dry-run/--yes/--json/--force-invoke-rule/--invoke-rule/--help", () => {
    expect(mod.parseArgs([])).toEqual({
      env: "",
      dryRun: false,
      yes: false,
      help: false,
      json: false,
      forceInvokeRule: false,
      invokeRule: mod.DEFAULT_INVOKE_PRESET,
    });
    expect(mod.parseArgs(["--env", "env-1", "--dry-run", "--yes"])).toMatchObject({
      env: "env-1",
      dryRun: true,
      yes: true,
    });
    expect(mod.parseArgs(["-e", "env-2", "-n", "-y"]).env).toBe("env-2");
    expect(mod.parseArgs(["--env=env-3"]).env).toBe("env-3");
    expect(mod.parseArgs(["--json", "--force-invoke-rule", "-h"])).toMatchObject({
      json: true,
      forceInvokeRule: true,
      help: true,
    });
    expect(mod.parseArgs(["--invoke-rule", "minimal"]).invokeRule).toBe("minimal");
    expect(mod.parseArgs(["--invoke-rule=login-only"]).invokeRule).toBe("login-only");
  });
});

// ---------------------------------------------------------------------------
// 迁移文件名 / 读取
// ---------------------------------------------------------------------------
describe("setup-cloud：迁移文件名与读取", () => {
  it("解析 <14位时间戳>_<snake_name>.sql", () => {
    expect(mod.parseMigrationFilename("20260927193625_init_keybox.sql")).toEqual({
      version: "20260927193625",
      name: "init_keybox",
    });
  });

  it("非法命名返回 null（时间戳位数不对 / 名字含数字 / 非 sql / 大写）", () => {
    expect(mod.parseMigrationFilename("2026092719362_init.sql")).toBeNull(); // 13 位
    expect(mod.parseMigrationFilename("20260927193625_add_users2.sql")).toBeNull(); // 名字含数字
    expect(mod.parseMigrationFilename("20260927193625_init_keybox.txt")).toBeNull(); // 非 .sql
    expect(mod.parseMigrationFilename("20260927193625_Init.sql")).toBeNull(); // 大写
  });

  it("loadMigrations 按版本升序、读取 SQL 文本、忽略不合规文件", () => {
    const files: Record<string, string> = {
      "20260927193751_b.sql": "SELECT 2;",
      "20260927193625_a.sql": "SELECT 1;",
      "notes.txt": "ignore me",
    };
    const dir = "cloudbase/migrations";
    const result = mod.loadMigrations(dir, {
      readdirSync: () => Object.keys(files),
      readFileSync: (p: string) => files[p.split(/[\\/]/).pop() ?? ""] ?? "",
    });
    expect(result.map((m) => m.version)).toEqual(["20260927193625", "20260927193751"]);
    expect(result[0].name).toBe("a");
    expect(result[0].sql).toBe("SELECT 1;");
  });

  it("真实仓库迁移可被解析（4 条、版本升序、名字均为合法 snake_case）", () => {
    const dir = join(PROJECT_ROOT, mod.MIGRATIONS_DIR);
    const fsLike = nodeFs as unknown as {
      readFileSync: (p: string) => string;
      readdirSync: (p: string) => string[];
    };
    const result = mod.loadMigrations(dir, fsLike);
    expect(result.length).toBeGreaterThanOrEqual(4);
    for (let i = 1; i < result.length; i += 1) {
      expect(result[i - 1].version <= result[i].version).toBe(true);
    }
    for (const m of result) expect(m.name).toMatch(/^[a-z][a-z_]*$/);
  });
});

// ---------------------------------------------------------------------------
// 凭据解析 + 缺凭据提示
// ---------------------------------------------------------------------------
describe("setup-cloud：凭据解析与缺凭据提示", () => {
  it("resolveEnvId 优先级：--env > TCB_ENV > ENV_ID > VITE_CLOUDBASE_ENV_ID，并去空白", () => {
    expect(mod.resolveEnvId({ TCB_ENV: " t1 ", ENV_ID: "e1" }, {})).toBe("t1");
    expect(mod.resolveEnvId({ ENV_ID: "e1", VITE_CLOUDBASE_ENV_ID: "v1" }, {})).toBe("e1");
    expect(mod.resolveEnvId({ VITE_CLOUDBASE_ENV_ID: "v1" }, {})).toBe("v1");
    expect(mod.resolveEnvId({ TCB_ENV: "t1" }, { env: "flag" })).toBe("flag");
    expect(mod.resolveEnvId({}, {})).toBe("");
  });

  it("resolveApiKey 兼容 CLOUDBASE_API_KEY / TCB_API_KEY", () => {
    expect(mod.resolveApiKey({ CLOUDBASE_API_KEY: " k " })).toBe("k");
    expect(mod.resolveApiKey({ TCB_API_KEY: "k2" })).toBe("k2");
    expect(mod.resolveApiKey({})).toBe("");
  });

  it("缺 envId → SetupError(MISSING_ENV_ID)，且提示指向 docs/CONSOLE-STEPS.md（非裸错误）", () => {
    let err: (Error & { code?: string }) | null = null;
    try {
      mod.createCliClient({ envId: "", exec: async () => ({ stdout: "" }) });
    } catch (e) {
      err = e as Error & { code?: string };
    }
    expect(err).toBeTruthy();
    expect(err!.code).toBe("MISSING_ENV_ID");
    expect(String(err!.message)).toContain("docs/CONSOLE-STEPS.md");
  });
});

// ---------------------------------------------------------------------------
// 幂等计划
// ---------------------------------------------------------------------------
describe("setup-cloud：幂等计划（只做差量、不覆盖既有）", () => {
  const M = (v: string, n: string): Migration => ({ version: v, name: n, sql: `-- ${n}` });

  it("只挑出未应用的迁移（已应用一律跳过）", () => {
    const plan = mod.planSetup({
      migrations: [M("20260927193625", "a"), M("20260927193751", "b")],
      appliedVersions: ["20260927193625"],
      desiredDomains: ["localhost:5173"],
      currentDomains: ["localhost:5173"],
      invokeRule: { found: true, rule: null },
      desiredInvokeRule: mod.DESIRED_FUNCTION_INVOKE_RULE,
    });
    expect(plan.pendingMigrations.map((m) => m.name)).toEqual(["b"]);
  });

  it("安全域名只补缺失（大小写不敏感、已存在的不重复添加）", () => {
    const plan = mod.planSetup({
      migrations: [],
      appliedVersions: [],
      desiredDomains: ["localhost:5173", "app.example.com"],
      currentDomains: ["LocalHost:5173"],
      invokeRule: { found: true, rule: null },
      desiredInvokeRule: mod.DESIRED_FUNCTION_INVOKE_RULE,
    });
    expect(plan.domainsToAdd).toEqual(["app.example.com"]);
  });

  it("invoke 规则：未设置→apply；已等于期望→skip-equal；不同→apply；读不到→skip-unknown", () => {
    const base = {
      migrations: [],
      appliedVersions: [],
      desiredDomains: [],
      currentDomains: [],
      desiredInvokeRule: mod.DESIRED_FUNCTION_INVOKE_RULE,
    };
    expect(mod.planSetup({ ...base, invokeRule: { found: true, rule: null } }).invokeRuleAction).toBe("apply");
    expect(
      mod.planSetup({ ...base, invokeRule: { found: true, rule: mod.DESIRED_FUNCTION_INVOKE_RULE } })
        .invokeRuleAction
    ).toBe("skip-equal");
    expect(
      mod.planSetup({ ...base, invokeRule: { found: true, rule: '{"invoke":false}' } }).invokeRuleAction
    ).toBe("apply");
    // 旧的 `{"invoke":true}`（无通配键）≠ 默认通配写法 `{"*":{"invoke":true}}` → 视为不同，收敛下发
    expect(
      mod.planSetup({ ...base, invokeRule: { found: true, rule: '{"invoke":true}' } }).invokeRuleAction
    ).toBe("apply");
    expect(
      mod.planSetup({ ...base, invokeRule: { found: false, rule: null } }).invokeRuleAction
    ).toBe("skip-unknown");
    expect(
      mod.planSetup({ ...base, invokeRule: { found: false, rule: null }, forceInvokeRule: true })
        .invokeRuleAction
    ).toBe("apply");
  });

  it("rulesEqual 忽略键序与空白", () => {
    expect(mod.rulesEqual('{"a":1,"b":2}', ' { "b": 2, "a": 1 } ')).toBe(true);
    expect(mod.rulesEqual(null, "")).toBe(true);
    expect(mod.rulesEqual('{"invoke":true}', '{"invoke":false}')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// runSetup：编排（注入假客户端）
// ---------------------------------------------------------------------------
interface FakeClient extends CliClient {
  calls: Array<[string, string?]>;
}
function makeFakeClient(init: {
  applied?: string[];
  domains?: string[];
  invoke?: { found: boolean; rule: string | null };
}): FakeClient {
  const applied = init.applied ?? [];
  const domains = init.domains ?? [];
  const invoke = init.invoke ?? { found: true, rule: null };
  const calls: Array<[string, string?]> = [];
  return {
    calls,
    async listMigrations() {
      calls.push(["listMigrations"]);
      return applied;
    },
    async applyMigration(m: Migration) {
      calls.push(["applyMigration", `${m.version}_${m.name}`]);
    },
    async getFunctionInvokeRule() {
      calls.push(["getFunctionInvokeRule"]);
      return invoke;
    },
    async setFunctionInvokeRule(r: string) {
      calls.push(["setFunctionInvokeRule", r]);
    },
    async listSecurityDomains() {
      calls.push(["listSecurityDomains"]);
      return domains;
    },
    async addSecurityDomains(d: string[]) {
      calls.push(["addSecurityDomains", d.join(",")]);
    },
  };
}
const MIGS: Migration[] = [
  { version: "20260927193625", name: "init_keybox", sql: "-- 1" },
  { version: "20260927193751", name: "harden_keybox_grants", sql: "-- 2" },
];

describe("setup-cloud：runSetup 编排", () => {
  it("只下发未应用迁移；补缺失域名；下发 invoke 规则", async () => {
    const client = makeFakeClient({
      applied: ["20260927193625"],
      domains: [],
      invoke: { found: true, rule: null },
    });
    const res = await mod.runSetup(client, { migrations: MIGS, log: () => {} });
    expect(client.calls.filter((c) => c[0] === "applyMigration").map((c) => c[1])).toEqual([
      "20260927193751_harden_keybox_grants",
    ]);
    expect(client.calls).toContainEqual(["addSecurityDomains", "localhost:5173"]);
    expect(client.calls).toContainEqual(["setFunctionInvokeRule", mod.DESIRED_FUNCTION_INVOKE_RULE]);
    expect(res.applied).toEqual(["20260927193751_harden_keybox_grants"]);
    expect(res.domainsAdded).toEqual(["localhost:5173"]);
    expect(res.invokeRuleApplied).toBe(true);
  });

  it("★幂等：全部已应用 + 域名已在 + invoke 规则已等于期望 → 【零写操作】", async () => {
    const client = makeFakeClient({
      applied: ["20260927193625", "20260927193751"],
      domains: ["localhost:5173"],
      invoke: { found: true, rule: mod.DESIRED_FUNCTION_INVOKE_RULE },
    });
    const res = await mod.runSetup(client, { migrations: MIGS, log: () => {} });
    const writes = client.calls.filter((c) =>
      ["applyMigration", "setFunctionInvokeRule", "addSecurityDomains"].includes(c[0])
    );
    expect(writes).toEqual([]); // 重复运行不产生任何写
    expect(res.applied).toEqual([]);
    expect(res.domainsAdded).toEqual([]);
    expect(res.invokeRuleApplied).toBe(false);
  });

  it("--dry-run：只预览、绝不写", async () => {
    const client = makeFakeClient({ applied: [], domains: [], invoke: { found: true, rule: null } });
    const res = await mod.runSetup(client, { migrations: MIGS, dryRun: true, log: () => {} });
    const writes = client.calls.filter((c) =>
      ["applyMigration", "setFunctionInvokeRule", "addSecurityDomains"].includes(c[0])
    );
    expect(writes).toEqual([]);
    expect(res.dryRun).toBe(true);
    expect(res.plan.pendingMigrations).toHaveLength(2);
  });

  it("读不到 invoke 规则 → 跳过（不覆盖既有策略），除非 --force-invoke-rule", async () => {
    const c1 = makeFakeClient({ applied: MIGS.map((m) => m.version), domains: ["localhost:5173"], invoke: { found: false, rule: null } });
    const r1 = await mod.runSetup(c1, { migrations: MIGS, log: () => {} });
    expect(r1.invokeRuleApplied).toBe(false);
    expect(c1.calls.some((c) => c[0] === "setFunctionInvokeRule")).toBe(false);

    const c2 = makeFakeClient({ applied: MIGS.map((m) => m.version), domains: ["localhost:5173"], invoke: { found: false, rule: null } });
    const r2 = await mod.runSetup(c2, { migrations: MIGS, forceInvokeRule: true, log: () => {} });
    expect(r2.invokeRuleApplied).toBe(true);
    expect(c2.calls.some((c) => c[0] === "setFunctionInvokeRule")).toBe(true);
  });

  it("--invoke-rule minimal：把【档位规则】原样下发（而非默认通配写法）", async () => {
    const client = makeFakeClient({
      applied: MIGS.map((m) => m.version),
      domains: ["localhost:5173"],
      invoke: { found: true, rule: null },
    });
    const res = await mod.runSetup(client, {
      migrations: MIGS,
      desiredInvokeRule: mod.resolveInvokeRule("minimal"),
      log: () => {},
    });
    expect(res.invokeRuleApplied).toBe(true);
    expect(client.calls).toContainEqual(["setFunctionInvokeRule", mod.MINIMAL_INVOKE_RULE]);
    expect(mod.rulesEqual(mod.MINIMAL_INVOKE_RULE, mod.DESIRED_FUNCTION_INVOKE_RULE)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CLI 客户端：命令拼装 + fail-closed（注入假 exec）
// ---------------------------------------------------------------------------
function makeExec(responder?: (args: string[]) => string) {
  const calls: CliCall[] = [];
  const exec = async (file: string, args: string[]): Promise<{ stdout: string }> => {
    calls.push({ file, args });
    return { stdout: responder ? responder(args) : "" };
  };
  return { calls, exec };
}

describe("setup-cloud：CLI 客户端命令拼装", () => {
  it("applyMigration 先校验仓库文件与 SQL 一致（fail-closed），再驱动 migration up", async () => {
    const realSql = nodeFs.readFileSync(
      join(PROJECT_ROOT, mod.MIGRATIONS_DIR, "20260927193625_init_keybox.sql"),
      "utf8"
    );
    const { calls, exec } = makeExec();
    const client = mod.createCliClient({ envId: "env-abc", repoRoot: PROJECT_ROOT, exec });

    await client.applyMigration({ version: "20260927193625", name: "init_keybox", sql: realSql });
    const upCall = calls.find((c) => c.args.includes("up"));
    expect(upCall).toBeTruthy();
    expect(upCall!.args).toEqual(["db", "pg", "migration", "up", "-e", "env-abc", "--yes"]); // DDL 走迁移
    expect(calls.some((c) => c.args.includes("execute"))).toBe(false); // 绝不走 execute

    // 内容不一致 → SetupError(code=LOCAL_MIGRATION_FILE_MISMATCH)（fail-closed，不下发）
    const c2 = mod.createCliClient({ envId: "env-abc", repoRoot: PROJECT_ROOT, exec });
    let mismatch: (Error & { code?: string }) | null = null;
    try {
      await c2.applyMigration({ version: "20260927193625", name: "init_keybox", sql: "-- 被篡改" });
    } catch (e) {
      mismatch = e as Error & { code?: string };
    }
    expect(mismatch!.code).toBe("LOCAL_MIGRATION_FILE_MISMATCH");
  });

  it("listMigrations 解析 JSON 版本数组；setFunctionInvokeRule 拼装 permission set", async () => {
    const { calls, exec } = makeExec((args) =>
      args.includes("list") ? JSON.stringify([{ migrationVersion: "20260927193625" }]) : ""
    );
    const client = mod.createCliClient({ envId: "env-abc", repoRoot: PROJECT_ROOT, exec });
    expect(await client.listMigrations()).toEqual(["20260927193625"]);

    await client.setFunctionInvokeRule(mod.DESIRED_FUNCTION_INVOKE_RULE);
    const setCall = calls.find((c) => c.args.includes("set"));
    expect(setCall!.args).toEqual([
      "permission",
      "set",
      "function",
      "--level",
      "custom",
      "--rule",
      mod.DESIRED_FUNCTION_INVOKE_RULE,
      "-e",
      "env-abc",
      "--yes",
    ]);
  });

  it("安全域名：list 解析 + add 逗号拼接", async () => {
    const { calls, exec } = makeExec((args) =>
      args.includes("list") ? JSON.stringify({ Domains: ["localhost:5173"] }) : ""
    );
    const client = mod.createCliClient({ envId: "env-abc", repoRoot: PROJECT_ROOT, exec });
    expect(await client.listSecurityDomains()).toEqual(["localhost:5173"]);

    await client.addSecurityDomains(["localhost:5173", "app.example.com"]);
    const addCall = calls.find((c) => c.args.includes("add"));
    expect(addCall!.args).toEqual(["cors", "add", "localhost:5173,app.example.com", "-e", "env-abc", "--yes"]);
  });

  it("提供 API Key：首条命令是免账号登录，且【后续命令不再携带 key】（不外泄）", async () => {
    const { calls, exec } = makeExec();
    const client = mod.createCliClient({ envId: "env-abc", apiKey: "SECRET-KEY", repoRoot: PROJECT_ROOT, exec });
    await client.listSecurityDomains();
    const loginCall = calls[0];
    expect(loginCall.args[0]).toBe("login");
    expect(loginCall.args).toContain("SECRET-KEY");
    for (const c of calls.slice(1)) {
      expect(c.args).not.toContain("SECRET-KEY"); // key 只出现在登录那一次
    }
  });

  it("★CLI 缺失（ENOENT）→ 可照做的补救（安装→校验版本→登录），非裸报错", async () => {
    const exec = async (): Promise<{ stdout: string }> => {
      const e = new Error("spawn tcb ENOENT") as Error & { stderr?: string };
      e.stderr = "command not found";
      throw e;
    };
    const client = mod.createCliClient({ envId: "env-abc", repoRoot: PROJECT_ROOT, exec });
    let err: (Error & { code?: string }) | null = null;
    try {
      await client.listSecurityDomains();
    } catch (e) {
      err = e as Error & { code?: string };
    }
    expect(err!.code).toBe("TCB_COMMAND_FAILED");
    const msg = String(err!.message);
    expect(msg).toMatch(/npm i -g @cloudbase\/cli/); // 装什么
    expect(msg).toContain("--version"); // 怎么校验版本
    expect(msg).toMatch(/login/); // 怎么登录
    expect(msg).toContain(mod.MIN_TCB_VERSION); // 需要 ≥ 3.0.0
  });

  it("★子命令失败（非缺失）→ 附【版本漂移提示】（先怀疑版本，再核对 --help）", async () => {
    const exec = async (): Promise<{ stdout: string }> => {
      const e = new Error("Command failed") as Error & { stderr?: string };
      e.stderr = "error: unknown option '--env-id'";
      throw e;
    };
    const client = mod.createCliClient({ envId: "env-abc", repoRoot: PROJECT_ROOT, exec });
    let err: (Error & { code?: string }) | null = null;
    try {
      await client.setFunctionInvokeRule(mod.DESIRED_FUNCTION_INVOKE_RULE);
    } catch (e) {
      err = e as Error & { code?: string };
    }
    expect(err!.code).toBe("TCB_COMMAND_FAILED");
    const msg = String(err!.message);
    expect(msg).toContain("--help"); // 指向帮助
    expect(msg).toMatch(/版本差异|版本/); // 版本漂移措辞
    expect(msg).toContain(mod.MIN_TCB_VERSION);
    expect(msg).toContain("permission set function"); // 具体子命令，便于核对
  });

  it("★失败信息不含凭据：login 用 API Key 失败时，错误文本必须打码（绝不回显）", async () => {
    const exec = async (): Promise<{ stdout: string }> => {
      const e = new Error("Command failed") as Error & { stderr?: string };
      e.stderr = "auth failed";
      throw e;
    };
    const client = mod.createCliClient({
      envId: "env-abc",
      apiKey: "SUPER-SECRET-KEY",
      repoRoot: PROJECT_ROOT,
      exec,
    });
    let err: (Error & { code?: string }) | null = null;
    try {
      await client.listSecurityDomains();
    } catch (e) {
      err = e as Error & { code?: string };
    }
    expect(err!.code).toBe("TCB_COMMAND_FAILED");
    const msg = String(err!.message);
    expect(msg).not.toContain("SUPER-SECRET-KEY"); // 绝不回显凭据
    expect(msg).toContain("***"); // 已打码
  });
});

// ---------------------------------------------------------------------------
// invoke 规则档位：默认＝文档确证的通配写法；收紧＝可选硬化档位
// ---------------------------------------------------------------------------
describe("setup-cloud：invoke 规则档位", () => {
  it("★默认 DESIRED_FUNCTION_INVOKE_RULE ＝【官方文档确证】的通配写法 {\"*\":{\"invoke\":true}}", () => {
    expect(mod.DESIRED_FUNCTION_INVOKE_RULE).toBe(mod.WILDCARD_INVOKE_RULE);
    expect(JSON.parse(mod.DESIRED_FUNCTION_INVOKE_RULE)).toEqual({ "*": { invoke: true } });
    // 默认＝通配写法（文档示例原文），**不是**未核实的 per-function 写法
    expect(mod.rulesEqual(mod.DESIRED_FUNCTION_INVOKE_RULE, mod.WILDCARD_INVOKE_RULE)).toBe(true);
    expect(mod.rulesEqual(mod.DESIRED_FUNCTION_INVOKE_RULE, mod.MINIMAL_INVOKE_RULE)).toBe(false);
  });

  it("PUBLIC_FUNCTIONS 恰好是「登录前必须可调」的三个函数", () => {
    expect(mod.PUBLIC_FUNCTIONS).toEqual(["kbInitAdmin", "kbRegister", "kbLogin"]);
  });

  it("收紧档位①（login-only）＝文档确证的【仅已登录且非匿名】条件表达式", () => {
    const parsed = JSON.parse(mod.LOGIN_REQUIRED_INVOKE_RULE) as Record<string, { invoke: string }>;
    expect(parsed["*"]).toBeTruthy();
    expect(parsed["*"].invoke).toContain("auth != null");
    expect(parsed["*"].invoke).toContain("ANONYMOUS");
    expect(parsed["*"].invoke).not.toBe("true"); // 比放通全部精确
  });

  it("收紧档位②（minimal）＝per-function 写法【待实测】，且不是默认", () => {
    const parsed = JSON.parse(mod.MINIMAL_INVOKE_RULE) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual([...mod.PUBLIC_FUNCTIONS].sort());
    for (const name of mod.PUBLIC_FUNCTIONS) expect(parsed[name]).toEqual({ invoke: true });
    expect(parsed["*"]).toBeUndefined(); // per-function：不含通配键
    expect(Object.keys(parsed)).not.toContain("kbGetMyRole"); // 不混入"非登录链路"函数
    expect(mod.rulesEqual(mod.MINIMAL_INVOKE_RULE, mod.DESIRED_FUNCTION_INVOKE_RULE)).toBe(false);
  });

  it("buildInvokeRule 由名单派生（空名单=空对象；可自定义；默认=三个登录前函数）", () => {
    expect(mod.buildInvokeRule()).toBe(mod.MINIMAL_INVOKE_RULE);
    expect(JSON.parse(mod.buildInvokeRule([]))).toEqual({});
    expect(JSON.parse(mod.buildInvokeRule(["kbLogin"]))).toEqual({ kbLogin: { invoke: true } });
  });

  it("resolveInvokeRule：默认→wildcard；三档位可解析；未知档位 → SetupError(UNKNOWN_INVOKE_PRESET)", () => {
    expect(mod.DEFAULT_INVOKE_PRESET).toBe("wildcard");
    expect(mod.resolveInvokeRule()).toBe(mod.WILDCARD_INVOKE_RULE);
    expect(mod.resolveInvokeRule("wildcard")).toBe(mod.WILDCARD_INVOKE_RULE);
    expect(mod.resolveInvokeRule("login-only")).toBe(mod.LOGIN_REQUIRED_INVOKE_RULE);
    expect(mod.resolveInvokeRule("minimal")).toBe(mod.MINIMAL_INVOKE_RULE);

    let err: (Error & { code?: string }) | null = null;
    try {
      mod.resolveInvokeRule("nope");
    } catch (e) {
      err = e as Error & { code?: string };
    }
    expect(err!.code).toBe("UNKNOWN_INVOKE_PRESET");
    expect(String(err!.message)).toContain("wildcard");
  });
});
