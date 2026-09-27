/**
 * AdminPage.test.ts —— 管理员后台「用户表」渲染断言（Q1：自己那行不渲染“删除数据”）。
 *
 * 说明：本仓未安装 jsdom / @testing-library，故用 react-dom/server 的 renderToStaticMarkup 做
 *   静态渲染断言（等价于把表格渲染成 HTML 字符串，再断言按钮是否出现）。
 *   顶部把 SDK / 云函数依赖 mock 掉，避免“导入即初始化真实 CloudBase”（cloudbase.ts 缺 env 会抛）。
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/cloudbase", () => ({ db: {}, auth: {}, app: {}, getActiveSession: async () => null }));
vi.mock("../lib/admin", () => ({
  adminListUsers: async () => [],
  adminSetUserStatus: async () => undefined,
  adminDeleteUserData: async () => 0,
}));
vi.mock("../lib/api", () => ({ api: {} }));
vi.mock("../hooks/useSessionGuard", () => ({ useSessionGuard: () => ({ checkNow: async () => true }) }));
vi.mock("../components/ThemeToggle", () => ({ default: () => null }));

import { UserTable } from "./AdminPage";
import type { AdminUserRow } from "../lib/admin";

function row(uid: string, username: string): AdminUserRow {
  return { uid, username, status: "active", created_at: "2026-01-01T00:00:00.000Z", item_count: 1 };
}

function render(users: AdminUserRow[], myUid: string): string {
  return renderToStaticMarkup(
    createElement(UserTable, {
      users,
      myUid,
      busy: false,
      onToggle: () => undefined,
      onDelete: () => undefined,
    })
  );
}

/** 用 `>文字<` 精确匹配“按钮内的文字节点”，避免把防呆文案里的“停用/删除”也数进去。 */
const btnCount = (html: string, label: string): number => html.split(`>${label}<`).length - 1;

describe("AdminPage 用户表：Q1 自己那行不出危险按钮", () => {
  it("★自己那行【不】渲染“删除数据”按钮，另一行照常有；并给出防呆文案", () => {
    const html = render([row("me", "本人"), row("other", "同事")], "me");
    expect(btnCount(html, "删除数据")).toBe(1); // 只有“同事”那行有
    expect(btnCount(html, "停用")).toBe(1); // 只有“同事”那行有
    expect(html).toContain("不能删除自己的数据"); // 自己那行的防呆文案
    expect(html).toContain("不能停用自己"); // 停用防呆仍在（文案风格一致）
  });

  it("只有自己一行时：停用与删除数据按钮都为 0 个", () => {
    const html = render([row("me", "本人")], "me");
    expect(btnCount(html, "停用")).toBe(0);
    expect(btnCount(html, "删除数据")).toBe(0);
  });

  it("别人那行：停用 + 删除数据 都在", () => {
    const html = render([row("other", "同事")], "me");
    expect(btnCount(html, "停用")).toBe(1);
    expect(btnCount(html, "删除数据")).toBe(1);
  });
});
