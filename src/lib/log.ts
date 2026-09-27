/**
 * log.ts —— 脱敏日志（架构 §9 第 4 行，硬约束 3 / R17）。
 *
 * 铁律：绝不输出明文、密钥、主密码、恢复码、会话票据、盐、verifier、密文内容。
 *   - 对象：按键名递归打码（见 REDACT_KEY_PATTERN）。
 *   - 错误：只取 message / code，绝不把整个 error 对象序列化（可能携带请求体）。
 *   - 字符串：调用方只应传“事件名 / 状态码”这类无害短句，禁止把用户输入直接拼进日志。
 *
 * 为什么单独成文件：脱敏规则必须在所有网络与日志路径最早统一，避免某处漏打码。
 */

/** 命中即打码的键名（覆盖密码、密钥、盐、校验值、恢复码、票据、密文载荷、服务端凭据等）。 */
const REDACT_KEY_PATTERN =
  /pass(word)?|pwd|secret|token|salt|verifier|recover|payload|ticket|master|api[-_]?key|private|credential|ciphertext|plaintext/i;

const MASK = "***";

/** 递归脱敏任意值，返回可安全序列化的副本。 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[deep]";
  if (value == null) return value;
  if (typeof value === "string") {
    // 字符串无法判断是否含密文；为稳妥，长度超过 64 一律截断（密文/密钥远长于此）。
    return value.length > 64 ? `${value.slice(0, 8)}…(len=${value.length})` : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Error) return safeError(value);
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = REDACT_KEY_PATTERN.test(key) ? MASK : redact(val, depth + 1);
    }
    return out;
  }
  return "[unloggable]";
}

/** 把错误压成只含安全字段的对象。 */
export function safeError(error: unknown): { name: string; message: string; code?: string } {
  if (error instanceof Error) {
    const code = (error as Error & { code?: string }).code;
    return { name: error.name, message: error.message, ...(code ? { code } : {}) };
  }
  return { name: "UnknownError", message: String(error) };
}

function emit(level: "info" | "warn" | "error", event: string, payload?: unknown): void {
  const line = `[keybox] ${event}`;
  if (payload === undefined) {
    // eslint-disable-next-line no-console
    console[level](line);
    return;
  }
  // eslint-disable-next-line no-console
  console[level](line, redact(payload));
}

export const log = {
  /** 常规事件（无敏感信息）。 */
  info(event: string, payload?: unknown): void {
    emit("info", event, payload);
  },
  /** 可恢复的异常。 */
  warn(event: string, payload?: unknown): void {
    emit("warn", event, payload);
  },
  /** 失败；payload 建议传 Error，会被压成安全字段。 */
  error(event: string, payload?: unknown): void {
    emit("error", event, payload);
  },
};
