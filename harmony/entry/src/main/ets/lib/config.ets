/**
 * config.ets —— 对外暴露的环境配置（结构稳定，引用方无需感知实现）。
 *
 * 真实值在 config.private.ets（已 gitignore，不入库），本文件只做转发与派生。
 * 好处：仓库可公开（历史里无环境 ID），同时本地构建不受影响。
 *
 * 注意：若此仓库曾被以含真实值的状态提交过（2026-10-01 前），git 历史中
 * 仍存在环境 ID——公开仓库前需重建历史或以新仓库替代。
 */
import { ENV_ID, PUBLISHABLE_KEY } from './config.private';

export { ENV_ID, PUBLISHABLE_KEY };

export const API_BASE: string = 'https://' + ENV_ID + '.api.tcloudbasegateway.com';
