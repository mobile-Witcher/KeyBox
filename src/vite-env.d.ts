/**
 * vite-env.d.ts —— Vite 与自定义环境变量的类型声明。
 * 硬约束：环境变量一律走 import.meta.env，且仓库里不得出现真实环境 ID / publishable key。
 * 真值只放在 .env.local（已被 .gitignore 挡住）。
 */
/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** CloudBase 环境 ID（形如 xxxx-xxxxxxxx；属受保护信息，只放 .env.local） */
  readonly VITE_CLOUDBASE_ENV_ID: string;
  /** CloudBase Publishable Key（前端可用公钥，映射到 anon 角色） */
  readonly VITE_PUBLISHABLE_KEY: string;
  /** CloudBase 地域，例如 ap-shanghai */
  readonly VITE_CLOUDBASE_REGION: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
