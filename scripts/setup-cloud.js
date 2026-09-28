#!/usr/bin/env node
/**
 * scripts/setup-cloud.js —— KeyBox 云端「一键下发 / 幂等复跑」脚本（R27：开源部署可复现）。
 *
 * 它做什么（把 `docs/CONSOLE-STEPS.md` 里能干的部分固化成可复跑的一步）：
 *   ① 驱动【版本化迁移】下发建表 + REVOKE/GRANT + RLS（DDL 一律走迁移，绝不走 execute）；
 *   ② 下发云函数的 invoke 规则（注册/登录在未登录时也要能调到云函数）；
 *   ③ 配置【安全域名白名单】（至少 `localhost:5173`，浏览器跨域 origin 白名单）。
 * 它不做什么（**必须仍手工**，见 `docs/CONSOLE-STEPS.md` 附录 C）：
 *   · 开启「用户名密码登录」开关；· 生成并注入「自定义登录私钥」；
 *   · 取 Publishable Key 填 `.env.local`；· 首次管理员初始化（应用内跑 kbInitAdmin）。
 *
 * ⚠️ 纪律：
 *   · **幂等**：重复运行不报错、不重复创建、不覆盖既有策略（先查后写、只补差量）。
 *   · **迁移文件为准**：迁移以仓库 `cloudbase/migrations/` 为**权威副本**；脚本读取后**原样透传 SQL**
 *     （不依赖"本地文件匹配"——MCP/CLI 的 cwd 可能不是仓库目录；文件与传入 SQL 不一致则 fail-closed）。
 *   · **凭据**只从 `.env.local` / 运行时环境变量读；**绝不硬编码、绝不回显、不打印**。
 *
 * 运行（在项目根目录）：
 *   node scripts/setup-cloud.js                 # 执行下发（幂等）
 *   node scripts/setup-cloud.js --dry-run       # 只打印将要做什么，不改动任何东西
 *   node scripts/setup-cloud.js --env <envId>   # 显式指定环境
 *   node scripts/setup-cloud.js --help
 *
 * 传输层：默认走**官方 CloudBase CLI（`tcb`）**——它是 MCP 的**逐能力对齐**的官方命令行
 * （`tcb db pg migration` / `tcb permission` / `tcb cors`）；写成可注入的 `CloudOps` 客户端，
 * 便于单测注入假客户端，也便于日后替换为 MCP 传输。
 * （README/文档所述"applyMigration"＝ CLI 的 `tcb db pg migration up`，等价能力。）
 */
import { execFile } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// 常量（导出以便单测）
// ---------------------------------------------------------------------------
/** 迁移文件目录（相对仓库根）——仓库权威副本。 */
export const MIGRATIONS_DIR = "cloudbase/migrations";
/** 至少必须放行的浏览器安全域名（本地 Vite dev server）。 */
export const DEFAULT_SECURITY_DOMAINS = ["localhost:5173"];
/** 期望的云函数 invoke 规则（未登录也要能调用云函数；函数内部各自做身份/权限自检）。 */
export const DESIRED_FUNCTION_INVOKE_RULE = '{"invoke":true}';
/** 缺凭据时的指路文案（指向仓库文档）。 */
export const DOCS_HINT = "获取方式见 docs/CONSOLE-STEPS.md 附录 A 与仓库根 .env.example。";

/** 结构化错误：带可读的 code 与"怎么修"的提示。 */
export class SetupError extends Error {
  /**
   * @param {string} code 机器可读错误码
   * @param {string} message 给人看的说明（含"去哪儿拿/怎么修"）
   */
  constructor(code, message) {
    super(message);
    this.name = "SetupError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// 纯函数：参数解析 / 迁移文件解析 / 凭据解析 / 幂等计划
// ---------------------------------------------------------------------------
/**
 * 极简参数解析。
 * @param {string[]} argv
 * @returns {{env:string,dryRun:boolean,yes:boolean,help:boolean,json:boolean,forceInvokeRule:boolean}}
 */
export function parseArgs(argv) {
  const out = {
    env: "",
    dryRun: false,
    yes: false,
    help: false,
    json: false,
    forceInvokeRule: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--dry-run" || a === "-n") out.dryRun = true;
    else if (a === "--yes" || a === "-y") out.yes = true;
    else if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--json") out.json = true;
    else if (a === "--force-invoke-rule") out.forceInvokeRule = true;
    else if (a === "--env" || a === "-e") {
      out.env = String(argv[i + 1] || "");
      i += 1;
    } else if (typeof a === "string" && a.startsWith("--env=")) {
      out.env = a.slice("--env=".length);
    }
  }
  return out;
}

/**
 * 解析迁移文件名 `<14位时间戳>_<snake_name>.sql`。
 * 名字必须匹配 MCP 约束 `^[a-z][a-z_]*$`（小写字母开头，仅小写字母与下划线，**不含数字**）。
 * @param {string} filename
 * @returns {{version:string,name:string}|null} 不合法返回 null
 */
export function parseMigrationFilename(filename) {
  const m = /^(\d{14})_([a-z][a-z0-9_]*)\.sql$/.exec(filename);
  if (!m) return null;
  const version = m[1];
  const rawName = m[2];
  // MCP 的 migrationName 不允许数字；含数字则视为非法（fail-closed，避免下发被服务端拒绝）
  if (!/^[a-z][a-z_]*$/.test(rawName)) return null;
  return { version, name: rawName };
}

/**
 * 读取并解析仓库内全部迁移（按版本号升序）。
 * @param {string} dir 迁移目录
 * @param {{readFileSync:Function,readdirSync:Function}} [fsImpl] 便于测试注入
 * @returns {Array<{version:string,name:string,file:string,sql:string}>}
 */
export function loadMigrations(dir, fsImpl = { readFileSync, readdirSync }) {
  const files = fsImpl.readdirSync(dir).filter((f) => typeof f === "string" && f.endsWith(".sql"));
  const parsed = [];
  for (const file of files) {
    const meta = parseMigrationFilename(file);
    if (!meta) continue; // 忽略不合规命名（不静默下发）
    const sql = fsImpl.readFileSync(join(dir, file), "utf8");
    parsed.push({ version: meta.version, name: meta.name, file, sql });
  }
  parsed.sort((a, b) => (a.version < b.version ? -1 : a.version > b.version ? 1 : 0));
  return parsed;
}

/**
 * 解析环境 ID：命令行 --env 优先，其次环境变量（与云函数 lib.js 同源命名）。
 * @param {Record<string,string|undefined>} env
 * @param {{env?:string}} flags
 */
export function resolveEnvId(env = process.env, flags = {}) {
  const fromFlag = String(flags.env || "").trim();
  if (fromFlag) return fromFlag;
  const raw = env.TCB_ENV || env.ENV_ID || env.VITE_CLOUDBASE_ENV_ID || "";
  return String(raw).trim();
}

/** 解析服务端 API Key（可选：若提供则由 CLI 用它做免账号登录）。 */
export function resolveApiKey(env = process.env) {
  return String(env.CLOUDBASE_API_KEY || env.TCB_API_KEY || "").trim();
}

/**
 * 归一化 invoke 规则用于比较（去空白/键序）。
 * @param {string|null|undefined} rule
 * @returns {string|null}
 */
export function normalizeRule(rule) {
  if (rule === null || rule === undefined) return null;
  const text = String(rule).trim();
  if (text === "") return null;
  try {
    const obj = JSON.parse(text);
    return JSON.stringify(sortKeysDeep(obj));
  } catch {
    return text;
  }
}

/** 递归排序对象键（稳定序列化）。 */
function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortKeysDeep(value[key]);
    return out;
  }
  return value;
}

/** 两个 invoke 规则是否等价。 */
export function rulesEqual(a, b) {
  return normalizeRule(a) === normalizeRule(b);
}

/**
 * 计算幂等计划：只挑出"需要做"的差量，已存在的一律跳过。
 * @param {{
 *   migrations: Array<{version:string,name:string,sql:string}>,
 *   appliedVersions: string[],
 *   desiredDomains: string[],
 *   currentDomains: string[],
 *   invokeRule: {found:boolean, rule:string|null},
 *   desiredInvokeRule: string,
 *   forceInvokeRule?: boolean,
 * }} input
 */
export function planSetup(input) {
  const applied = new Set(input.appliedVersions || []);
  const pendingMigrations = (input.migrations || []).filter((m) => !applied.has(m.version));

  const currentLower = new Set((input.currentDomains || []).map((d) => String(d).toLowerCase()));
  const domainsToAdd = (input.desiredDomains || []).filter(
    (d) => !currentLower.has(String(d).toLowerCase())
  );

  const invoke = input.invokeRule || { found: false, rule: null };
  let invokeRuleAction;
  if (!invoke.found && !input.forceInvokeRule) {
    // 读不到现有规则：为"不覆盖既有策略"而**跳过**（除非显式 --force-invoke-rule）
    invokeRuleAction = "skip-unknown";
  } else if (invoke.found && invoke.rule === null) {
    invokeRuleAction = "apply"; // 尚未设置 → 下发
  } else if (rulesEqual(invoke.rule, input.desiredInvokeRule)) {
    invokeRuleAction = "skip-equal"; // 已是期望值 → 跳过（幂等）
  } else {
    invokeRuleAction = "apply"; // 与期望不同 → 下发期望值
  }

  return { pendingMigrations, domainsToAdd, invokeRuleAction };
}

// ---------------------------------------------------------------------------
// CloudOps 客户端：默认实现走官方 `tcb` CLI（可注入 exec 便于单测）
// ---------------------------------------------------------------------------
/**
 * 创建一个基于 CloudBase CLI 的 CloudOps 客户端。
 * @param {{
 *   envId:string, apiKey?:string, repoRoot?:string, tcbBin?:string,
 *   exec?: (file:string,args:string[],opts:object)=>Promise<{stdout:string}>,
 *   log?: (msg:string)=>void,
 * }} opts
 */
export function createCliClient(opts) {
  const envId = String(opts.envId || "").trim();
  if (!envId) throw new SetupError("MISSING_ENV_ID", `缺少环境 ID（envId）。${DOCS_HINT}`);
  const apiKey = String(opts.apiKey || "").trim();
  const repoRoot = opts.repoRoot || process.cwd();
  const tcbBin = opts.tcbBin || "tcb";
  const log = opts.log || (() => {});
  const exec =
    opts.exec ||
    (async (file, args, o) => {
      const { stdout } = await execFileAsync(file, args, { ...o, windowsHide: true });
      return { stdout: String(stdout || "") };
    });

  let authed = false;

  /** 执行一条 tcb 命令（凭据只经环境/CLI 自身处理，**绝不 put 进日志**）。 */
  async function run(args) {
    try {
      return await exec(tcbBin, args, { cwd: repoRoot });
    } catch (err) {
      const stderr = err && err.stderr ? String(err.stderr) : "";
      const hint = /ENOENT|not found/i.test(String(err && err.message))
        ? `未找到 \`${tcbBin}\` 命令：请先安装官方 CLI —— \`npm i -g @cloudbase/cli\`，再 \`tcb login\`。`
        : "命令执行失败。若为鉴权问题，请先 `tcb login`（或设置 CLOUDBASE_API_KEY 供免账号登录）。";
      throw new SetupError("TCB_COMMAND_FAILED", `执行 \`${tcbBin} ${args.join(" ")}\` 失败：${stderr || (err && err.message) || "未知错误"}。${hint}`);
    }
  }

  /** 若提供了 API Key，用官方"环境 API Key 免账号登录"完成鉴权（只做一次）。 */
  async function ensureAuth() {
    if (authed) return;
    if (apiKey) {
      // 该子命令是 CLI 官方的“环境 API Key 免账号登录”路径（不打印 key）
      await run(["login", "--cloudbase-api-key", apiKey, "-e", envId]);
      log("· 已用环境 API Key 登录 CloudBase CLI");
    } else {
      log("· 未提供 API Key，按已有 `tcb login` 会话执行（若未登录请先 tcb login）");
    }
    authed = true;
  }

  return {
    /**
     * 查询已应用迁移的版本列表。
     * @returns {Promise<string[]>} 已应用的 migrationVersion 数组
     */
    async listMigrations() {
      await ensureAuth();
      const { stdout } = await run(["db", "pg", "migration", "list", "-e", envId, "--json"]);
      try {
        const data = JSON.parse(stdout || "[]");
        const arr = Array.isArray(data) ? data : Array.isArray(data.List) ? data.List : [];
        return arr
          .map((x) => String((x && (x.migrationVersion || x.Version || x.version)) || ""))
          .filter(Boolean);
      } catch {
        log("⚠️ 无法解析迁移列表 JSON，按“无已应用迁移”处理（`migration up` 本身会跳过已应用项，安全）。");
        return [];
      }
    },

    /**
     * 应用一条迁移：**先校验仓库文件与传入 SQL 一致**（fail-closed），再驱动版本化迁移。
     * DDL 只经此路径下发，**绝不走 execute**。
     * @param {{version:string,name:string,sql:string}} migration
     */
    async applyMigration(migration) {
      await ensureAuth();
      const filePath = join(repoRoot, MIGRATIONS_DIR, `${migration.version}_${migration.name}.sql`);
      let onDisk;
      try {
        onDisk = readFileSync(filePath, "utf8");
      } catch {
        throw new SetupError(
          "LOCAL_MIGRATION_MISSING",
          `仓库内缺少迁移文件 ${MIGRATIONS_DIR}/${migration.version}_${migration.name}.sql（${filePath}）。`
        );
      }
      if (onDisk !== migration.sql) {
        throw new SetupError(
          "LOCAL_MIGRATION_FILE_MISMATCH",
          `迁移文件内容与传入 SQL 不一致（fail-closed）：${migration.version}_${migration.name}.sql。` +
            "请确认仓库为权威副本，勿手工改动已下发迁移。"
        );
      }
      // CLI 的 `migration up` 会按目录内版本顺序应用全部“未应用”迁移（天然幂等）。
      await run(["db", "pg", "migration", "up", "-e", envId, "--yes"]);
    },

    /**
     * 读取云函数 invoke 规则（不是设置成期望值，只是尽量读现状用于幂等比较）。
     * @returns {Promise<{found:boolean, rule:string|null}>} found=false 表示读取不到（不覆盖）
     */
    async getFunctionInvokeRule() {
      await ensureAuth();
      // 命令本身失败（如 tcb 未安装）应向外冒泡；只有“响应对但形状不认识”才退化为 found:false（跳过、不覆盖）
      const { stdout } = await run(["permission", "get", "function", "-e", envId, "--json"]);
      try {
        const data = JSON.parse(stdout || "null");
        const rule = extractInvokeRule(data);
        return { found: true, rule: rule === undefined ? null : rule };
      } catch {
        return { found: false, rule: null };
      }
    },

    /** 下发云函数 invoke 规则（未登录也可调用云函数；函数内部自检身份/权限）。 */
    async setFunctionInvokeRule(rule) {
      await ensureAuth();
      await run([
        "permission",
        "set",
        "function",
        "--level",
        "custom",
        "--rule",
        String(rule),
        "-e",
        envId,
        "--yes",
      ]);
    },

    /** 读取当前安全域名（CORS）白名单。 */
    async listSecurityDomains() {
      await ensureAuth();
      const { stdout } = await run(["cors", "list", "-e", envId, "--json"]);
      try {
        const data = JSON.parse(stdout || "[]");
        const arr = Array.isArray(data) ? data : Array.isArray(data.Domains) ? data.Domains : [];
        return arr
          .map((x) => (typeof x === "string" ? x : String((x && (x.domain || x.Domain || x.origin)) || "")))
          .filter(Boolean);
      } catch {
        return [];
      }
    },

    /** 添加缺失的安全域名。 */
    async addSecurityDomains(domains) {
      await ensureAuth();
      if (!domains || domains.length === 0) return;
      await run(["cors", "add", domains.join(","), "-e", envId, "--yes"]);
    },
  };
}

/** 从 `permission get function` 的返回里尽量取出 invoke 规则文本（形状随 CLI 版本，容错）。 */
function extractInvokeRule(data) {
  if (data === null || data === undefined) return undefined;
  if (typeof data === "string") return data;
  const candidates = ["Rule", "rule", "InvokeRule", "invokeRule", "SecurityRule", "securityRule"];
  for (const key of candidates) {
    if (data && typeof data === "object" && data[key] !== undefined) {
      const v = data[key];
      return typeof v === "string" ? v : JSON.stringify(v);
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// 编排：读取现状 → 计算差量 → 只做差量（幂等）
// ---------------------------------------------------------------------------
/**
 * 执行下发的核心编排（客户端可注入，便于单测）。
 * @param {object} client CloudOps 客户端（见 createCliClient 返回值）
 * @param {{
 *   migrations: Array<{version:string,name:string,sql:string}>,
 *   desiredDomains?: string[],
 *   desiredInvokeRule?: string,
 *   forceInvokeRule?: boolean,
 *   dryRun?: boolean,
 *   log?: (msg:string)=>void,
 * }} options
 * @returns {Promise<object>} 结构化结果摘要
 */
export async function runSetup(client, options) {
  const log = options.log || (() => {});
  const desiredDomains = options.desiredDomains || DEFAULT_SECURITY_DOMAINS;
  const desiredInvokeRule = options.desiredInvokeRule || DESIRED_FUNCTION_INVOKE_RULE;
  const dryRun = Boolean(options.dryRun);

  const appliedVersions = await client.listMigrations();
  const currentDomains = await client.listSecurityDomains();
  const invokeRule = await client.getFunctionInvokeRule();

  const plan = planSetup({
    migrations: options.migrations,
    appliedVersions,
    desiredDomains,
    currentDomains,
    invokeRule,
    desiredInvokeRule,
    forceInvokeRule: Boolean(options.forceInvokeRule),
  });

  log(`· 已应用迁移：${appliedVersions.length} 条；待下发：${plan.pendingMigrations.length} 条`);
  for (const m of plan.pendingMigrations) log(`    → 迁移 ${m.version}_${m.name}`);
  log(`· 安全域名待添加：${plan.domainsToAdd.length ? plan.domainsToAdd.join(", ") : "（无）"}`);
  log(`· 云函数 invoke 规则：${plan.invokeRuleAction}`);

  if (dryRun) {
    log("[dry-run] 仅预览，未做任何改动。");
    return { dryRun: true, plan, applied: [], domainsAdded: [], invokeRuleApplied: false };
  }

  const applied = [];
  for (const m of plan.pendingMigrations) {
    await client.applyMigration(m); // ← DDL 只经版本化迁移
    applied.push(`${m.version}_${m.name}`);
    log(`    ✓ 迁移已下发：${m.version}_${m.name}`);
  }

  let invokeRuleApplied = false;
  if (plan.invokeRuleAction === "apply") {
    await client.setFunctionInvokeRule(desiredInvokeRule);
    invokeRuleApplied = true;
    log("    ✓ 云函数 invoke 规则已下发");
  } else if (plan.invokeRuleAction === "skip-unknown") {
    log("    ⏭ 读不到现有 invoke 规则，跳过以免覆盖既有策略；如确需下发请加 --force-invoke-rule");
  } else {
    log("    ⏭ invoke 规则已是期望值，跳过");
  }

  if (plan.domainsToAdd.length > 0) {
    await client.addSecurityDomains(plan.domainsToAdd);
    log(`    ✓ 安全域名已添加：${plan.domainsToAdd.join(", ")}`);
  }

  return {
    dryRun: false,
    plan,
    applied,
    domainsAdded: plan.domainsToAdd,
    invokeRuleApplied,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const USAGE = [
  "KeyBox 云端一键下发（幂等）—— R27 开源可复现",
  "",
  "  node scripts/setup-cloud.js [--env <envId>] [--dry-run] [--json] [--force-invoke-rule]",
  "",
  "做什么：① 版本化迁移下发建表+GRANT+RLS（DDL 走迁移，不走 execute）",
  "        ② 下发云函数 invoke 规则  ③ 配置安全域名白名单（至少 localhost:5173）",
  "幂等：重复运行不报错、不重复创建、不覆盖既有策略（先查后写）。",
  "凭据：环境 ID 取 --env / TCB_ENV / ENV_ID / VITE_CLOUDBASE_ENV_ID；",
  "      可选 CLOUDBASE_API_KEY 用于免账号登录；均只从 .env.local / 环境变量读，绝不回显。",
  "仍须手工：开启用户名密码登录、注入自定义登录私钥、取 Publishable Key、首次管理员初始化。",
  "详见 docs/CONSOLE-STEPS.md。",
].join("\n");

/** 加载 `.env.local`（缺失/不可用不致命）。 */
function loadEnvLocal(cwd = process.cwd()) {
  const path = resolve(cwd, ".env.local");
  if (existsSync(path) && typeof process.loadEnvFile === "function") {
    try {
      process.loadEnvFile(path);
    } catch {
      /* 忽略：由后续缺凭据提示兜底 */
    }
  }
}

async function main(argv = process.argv.slice(2)) {
  const flags = parseArgs(argv);
  if (flags.help) {
    console.log(USAGE);
    return 0;
  }
  loadEnvLocal();

  const envId = resolveEnvId(process.env, flags);
  if (!envId) {
    throw new SetupError(
      "MISSING_ENV_ID",
      "缺少环境 ID：请设置 TCB_ENV / ENV_ID / VITE_CLOUDBASE_ENV_ID，或用 --env <envId> 指定。" + DOCS_HINT
    );
  }

  const migrations = loadMigrations(join(process.cwd(), MIGRATIONS_DIR));
  if (migrations.length === 0) {
    throw new SetupError(
      "NO_MIGRATIONS",
      `未在 ${MIGRATIONS_DIR}/ 找到任何迁移文件；请确认在项目根目录运行。`
    );
  }

  const apiKey = resolveApiKey(process.env);
  const client = createCliClient({
    envId,
    apiKey,
    repoRoot: process.cwd(),
    log: (m) => console.log(m),
  });

  const result = await runSetup(client, {
    migrations,
    desiredDomains: DEFAULT_SECURITY_DOMAINS,
    desiredInvokeRule: DESIRED_FUNCTION_INVOKE_RULE,
    forceInvokeRule: flags.forceInvokeRule,
    dryRun: flags.dryRun,
    log: (m) => console.log(m),
  });

  if (flags.json) console.log(JSON.stringify(result));
  else console.log(result.dryRun ? "\n[dry-run] 完成（未改动）。" : "\n✅ 下发完成（幂等，可重复运行）。");
  return 0;
}

// 仅在被当作 CLI 直接运行时才执行（被 import 时不产生副作用）。
const isCli = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      if (err instanceof SetupError) {
        console.error(`❌ [${err.code}] ${err.message}`);
        process.exitCode = 2;
        return;
      }
      console.error(`❌ 错误：${err && err.message ? err.message : String(err)}`);
      process.exitCode = 1;
    });
}
