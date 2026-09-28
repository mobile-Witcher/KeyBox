#!/usr/bin/env node
/**
 * scripts/setup-cloud.js —— KeyBox 云端「一键下发 / 幂等复跑」脚本（R27：开源部署可复现）。
 *
 * 它做什么（把 `docs/CONSOLE-STEPS.md` 里能干的部分固化成可复跑的一步）：
 *   ① 驱动【版本化迁移】下发建表 + REVOKE/GRANT + RLS（DDL 一律走迁移，绝不走 execute）；
 *   ② 下发云函数的 invoke 规则（**默认＝官方文档确证的通配写法** `{"*":{"invoke":true}}`）；
 *      如需收紧，用 `--invoke-rule login-only|minimal` 选择档位（详见 docs/CONSOLE-STEPS.md 附录 D.3）；
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

// --- 云函数 invoke 规则：默认用【官方文档确证】的通配写法；收紧是"可选硬化档位" ---

/**
 * 官方文档**确证**的「通配键」写法：对**所有**函数生效。此处＝放通全部（`{"*":{"invoke":true}}`）。
 * 出处：CloudBase 官方 CLI 参考 `permission.md`（`tcb permission set function --rule '{"*":{"invoke":…}}'`）。
 *
 * **这是默认值**——理由（见 `docs/CONSOLE-STEPS.md` 附录 D.3）：默认必须是**已被官方文档证明**的写法。
 * "以函数名为键"的 per-function 写法**文档未直接给出**，若平台判其非法，最可能"规则整体不生效 →
 * 登录前三个函数也调不到 → 初始化/注册/登录整条链路断"，而这恰是最难事后排查的路径。故**不作默认**。
 */
export const WILDCARD_INVOKE_RULE = JSON.stringify({ "*": { invoke: true } }); // → {"*":{"invoke":true}}

/**
 * 「登录前（尚未认证）就必须能调用」的函数——**收紧档位②**的目标名单。
 * 这三个是登录/注册链路的前置：没有会话也得能调，否则用户永远进不来。
 */
export const PUBLIC_FUNCTIONS = ["kbInitAdmin", "kbRegister", "kbLogin"];

/**
 * 由函数名列表派生 **per-function** invoke 规则（只列出的函数 `{"invoke":true}`）。
 *
 * ⚠️ **【待实测】**：官方文档演示的是通配键 `{"*":{…}}`（cloudbase-cli 参考 `permission.md`）
 * 与整段 `package authz.user` Rego（cloud-functions 参考 `http-functions.md`，PG 环境专用）；
 * "以具体函数名为键"的写法**文档未直接给出**。故它**只作收紧档位②**（**实测通过后**再用），
 * **绝不作默认**。
 * @param {string[]} [functions]
 * @returns {string} JSON 文本
 */
export function buildInvokeRule(functions = PUBLIC_FUNCTIONS) {
  const rule = {};
  for (const name of functions) rule[name] = { invoke: true };
  return JSON.stringify(rule);
}

/** 收紧档位②目标规则：per-function 最小名单（**【待实测】**，非默认）。 */
export const MINIMAL_INVOKE_RULE = buildInvokeRule(PUBLIC_FUNCTIONS);

/**
 * 收紧档位①规则：**仅已登录（且非匿名）用户可调**——官方示例**确证**的条件表达式。
 * 出处：CloudBase 官方 CLI 参考 `permission.md`：
 *   tcb permission set function --level custom \
 *     --rule '{"*":{"invoke":"auth != null && auth.loginType != '\''ANONYMOUS'\''"}}'
 * 语义：`auth != null`＝存在登录会话；`loginType != 'ANONYMOUS'`＝排除匿名会话。
 * ⚠️ 它会让"登录后可调"的**所有**函数可调（比通配放通精确、但比最小名单宽）——故只是**档位①**。
 */
export const LOGIN_REQUIRED_INVOKE_RULE = JSON.stringify({
  "*": { invoke: "auth != null && auth.loginType != 'ANONYMOUS'" },
});

/**
 * 可选的 invoke 规则档位（供 `--invoke-rule <preset>` 选择）：
 *   · `wildcard`   —— **默认**：文档确证，放通全部 `{"*":{"invoke":true}}`
 *   · `login-only` —— 收紧档位①：文档确证，仅登录（非匿名）用户可调
 *   · `minimal`    —— 收紧档位②：per-function 写法 **【待实测】**
 */
export const INVOKE_PRESETS = {
  wildcard: WILDCARD_INVOKE_RULE,
  "login-only": LOGIN_REQUIRED_INVOKE_RULE,
  minimal: MINIMAL_INVOKE_RULE,
};

/** 默认档位名。 */
export const DEFAULT_INVOKE_PRESET = "wildcard";

/** 期望的云函数 invoke 规则（默认＝文档确证的通配写法）。 */
export const DESIRED_FUNCTION_INVOKE_RULE = WILDCARD_INVOKE_RULE;

/**
 * 解析 `--invoke-rule` 档位名为具体规则文本；未知档位 → SetupError。
 * @param {string} [preset]
 * @returns {string}
 */
export function resolveInvokeRule(preset = DEFAULT_INVOKE_PRESET) {
  const key = String(preset || DEFAULT_INVOKE_PRESET).trim();
  if (!Object.prototype.hasOwnProperty.call(INVOKE_PRESETS, key)) {
    throw new SetupError(
      "UNKNOWN_INVOKE_PRESET",
      `未知的 --invoke-rule 档位「${key}」；可选：${Object.keys(INVOKE_PRESETS).join(" / ")}。`
    );
  }
  return INVOKE_PRESETS[key];
}

/** 缺凭据时的指路文案（指向仓库文档）。 */
export const DOCS_HINT = "获取方式见 docs/CONSOLE-STEPS.md 附录 A 与仓库根 .env.example。";

/** 官方 CLI 要求的最低版本。 */
export const MIN_TCB_VERSION = "3.0.0";

/**
 * 缺 `tcb` 命令时可照做的补救（安装 → 校验版本 → 登录）。**不是一句 "command not found"。**
 * @param {string} [tcbBin]
 * @returns {string}
 */
export function cliMissingHint(tcbBin = "tcb") {
  return [
    `未找到 \`${tcbBin}\` 命令（CloudBase 官方 CLI）。请照做：`,
    `  1) 安装：  npm i -g @cloudbase/cli`,
    `  2) 校验：  ${tcbBin} --version        （需 ≥ ${MIN_TCB_VERSION}）`,
    `  3) 登录：  ${tcbBin} login             （交互式；或用环境 API Key 免账号登录：`,
    `            ${tcbBin} login --cloudbase-api-key <key> -e <envId>）`,
    `完成后重跑本脚本。详见 docs/CONSOLE-STEPS.md 附录 D。`,
  ].join("\n");
}

/**
 * 版本漂移提示：`tcb` 的参数名/子命令随版本可能变化，报错先怀疑版本。
 * @param {string} [subcommand] 形如 "db pg migration" / "permission set function"
 * @returns {string}
 */
export function versionDriftHint(subcommand = "") {
  const probe = subcommand ? `\`tcb ${subcommand} --help\`` : "该子命令的 `tcb <cmd> --help`";
  return (
    `若报错涉及**参数名或子命令本身**，可能是 CLI 版本差异：先 \`tcb --version\`` +
    `（需 ≥ ${MIN_TCB_VERSION}），再核对 ${probe} 与本机实际用法。`
  );
}

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
 * @returns {{env:string,dryRun:boolean,yes:boolean,help:boolean,json:boolean,forceInvokeRule:boolean,invokeRule:string}}
 */
export function parseArgs(argv) {
  const out = {
    env: "",
    dryRun: false,
    yes: false,
    help: false,
    json: false,
    forceInvokeRule: false,
    invokeRule: DEFAULT_INVOKE_PRESET,
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
    } else if (a === "--invoke-rule") {
      out.invokeRule = String(argv[i + 1] || "");
      i += 1;
    } else if (typeof a === "string" && a.startsWith("--invoke-rule=")) {
      out.invokeRule = a.slice("--invoke-rule=".length);
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

  /** 取【开头连续的非 flag 词】作为人类可读子命令名（遇到首个 `-` 即停，避免把选项值带进来）。 */
  function subcommandLabel(args) {
    const out = [];
    for (const a of args) {
      if (typeof a !== "string" || a.startsWith("-")) break;
      out.push(a);
      if (out.length >= 3) break;
    }
    return out.join(" ");
  }

  /** 需要打码的「取值为机密」的开关。 */
  const SECRET_FLAGS = new Set(["--cloudbase-api-key", "--apiKey", "--apiKeyId", "--token", "--key"]);

  /** 生成【不含凭据】的命令行文本：机密开关的下一个参数一律替换为 `***`。 */
  function redactArgs(args) {
    const out = [];
    let maskNext = false;
    for (const a of args) {
      if (maskNext) {
        out.push("***");
        maskNext = false;
        continue;
      }
      if (typeof a === "string" && SECRET_FLAGS.has(a)) {
        out.push(a);
        maskNext = true;
        continue;
      }
      out.push(a);
    }
    return out.join(" ");
  }

  /** 执行一条 tcb 命令（凭据只经环境/CLI 自身处理，**绝不 put 进日志**）。 */
  async function run(args) {
    try {
      return await exec(tcbBin, args, { cwd: repoRoot });
    } catch (err) {
      const msg = String((err && err.message) || "");
      const stderr = err && err.stderr ? String(err.stderr) : "";
      // ① CLI 缺失：ENOENT / command not found → 给出可照做的安装/登录补救（而非裸报错）
      if (/ENOENT|command not found|not found/i.test(msg) || /not found/i.test(stderr)) {
        throw new SetupError("TCB_COMMAND_FAILED", cliMissingHint(tcbBin));
      }
      // ② 其它失败：命令文本经打码（绝不含凭据）+ 鉴权指引 + 版本漂移提示
      const authHint = `若为鉴权问题，请先 \`${tcbBin} login\`（或设置 CLOUDBASE_API_KEY 供免账号登录）。`;
      throw new SetupError(
        "TCB_COMMAND_FAILED",
        `执行 \`${tcbBin} ${redactArgs(args)}\` 失败：${stderr || msg || "未知错误"}。\n` +
          `提示：${authHint}\n${versionDriftHint(subcommandLabel(args))}`
      );
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

    /**
     * 下发云函数 invoke 规则。
     * 默认规则为**最小放通名单**（仅 kbInitAdmin/kbRegister/kbLogin，`{"invoke":true}`）；
     * 其它函数不下发放通规则。`function` 仅支持 `--level custom`（见 CLI 参考 permission.md）。
     */
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
  log(`· 云函数 invoke 规则：${plan.invokeRuleAction}（目标规则：${desiredInvokeRule}）`);

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
  "  node scripts/setup-cloud.js [--env <envId>] [--dry-run] [--json]",
  "        [--force-invoke-rule] [--invoke-rule wildcard|login-only|minimal]",
  "",
  "做什么：① 版本化迁移下发建表+GRANT+RLS（DDL 走迁移，不走 execute）",
  "        ② 下发云函数 invoke 规则（默认 wildcard＝文档确证的通配写法，放通全部）",
  "        ③ 配置安全域名白名单（至少 localhost:5173）",
  "档位：--invoke-rule 可选 wildcard(默认) / login-only(仅登录用户可调) /",
  "      minimal(仅放通 kbInitAdmin/kbRegister/kbLogin，per-function 写法【待实测】)。",
  "幂等：重复运行不报错、不重复创建、不覆盖既有策略（先查后写）。",
  "凭据：环境 ID 取 --env / TCB_ENV / ENV_ID / VITE_CLOUDBASE_ENV_ID；",
  "      可选 CLOUDBASE_API_KEY 用于免账号登录；均只从 .env.local / 环境变量读，绝不回显。",
  `依赖官方 CLI：npm i -g @cloudbase/cli（需 ≥ ${MIN_TCB_VERSION}）并 tcb login。`,
  "仍须手工：开启用户名密码登录、注入自定义登录私钥、取 Publishable Key、首次管理员初始化。",
  "配置后必验（两条）：① 登录前能调 kbInitAdmin/kbRegister/kbLogin；② 登录后能调 kbGetMyRole。",
  "详见 docs/CONSOLE-STEPS.md 附录 D.3。",
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

  const desiredInvokeRule = resolveInvokeRule(flags.invokeRule);

  const result = await runSetup(client, {
    migrations,
    desiredDomains: DEFAULT_SECURITY_DOMAINS,
    desiredInvokeRule,
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
