/**
 * SecretTable.render.test.ts —— 列表渲染的冒烟断言（真实 React，静态渲染）。
 *
 * 说明：本仓未安装 jsdom，故用 react-dom/server 的 renderToStaticMarkup 把组件渲染成 HTML 字符串，
 *   断言初始态的外观（R15/R16 遮掩 + R25 的初始“复制”文案）。交互行为另见 SecretTable.test.ts。
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import SecretTable from "./SecretTable";
import type { SecretItem } from "../lib/vault";

function item(id: number, key: string): SecretItem {
  return {
    id,
    keyEpoch: 0,
    updatedAt: "2026-01-01T00:00:00.000Z",
    pending: false,
    plain: { site: "站点", url: "https://example.com", key, note: "备注", tags: ["工作"] },
    decryptError: false,
  };
}

const noop = (): void => undefined;

function render(items: SecretItem[]): string {
  return renderToStaticMarkup(createElement(SecretTable, { items, onEdit: noop, onDelete: noop }));
}

describe("SecretTable 渲染（R15/R16 + R25 初始态）", () => {
  it("空列表 → 显示引导文案", () => {
    expect(render([])).toContain("还没有密钥");
  });

  it("默认遮掩明文 key；复制按钮初始显示『复制』；不显示倒计时提示", () => {
    const html = render([item(1, "PLAINTEXT-LEAK-CANARY")]);
    expect(html).toContain("••••••••"); // 默认遮掩
    expect(html).not.toContain("PLAINTEXT-LEAK-CANARY"); // 初始不出明文
    expect(html).toContain(">复制<"); // R25 初始文案
    expect(html).not.toContain("秒后自动清空"); // 未复制时不出现倒计时提示
  });

  it("解密失败的行：显示提示且禁用显示/复制按钮", () => {
    const broken: SecretItem = { ...item(2, ""), plain: null, decryptError: true };
    const html = render([broken]);
    expect(html).toContain("无法解密");
    expect(html).toContain("disabled");
  });
});
