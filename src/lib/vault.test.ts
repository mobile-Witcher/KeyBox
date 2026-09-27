/**
 * vault.test.ts —— 第 7 步纯本机逻辑单测：标签统计 / 搜索过滤 / 标签批量变更。
 *
 * 目的：
 *   - 验证 R18（标签：多选统计、重命名、删除前的“影响条数”来自 countByTag）；
 *   - 验证 R19（搜索是【纯内存】谓词：给定同一输入必得同一输出，不依赖任何网络/全局状态）；
 *   - 验证解密失败条目的展示边界（仅在无任何筛选时可见，避免“误以为数据丢失”）。
 *
 * 本文件只测纯函数：不触碰 IndexedDB、不发网络、不接触主密钥。
 */
import { describe, expect, it } from "vitest";
import {
  collectTags,
  countByTag,
  emptyPlain,
  filterItems,
  mapTagChange,
  normalizePlain,
  type SecretItem,
} from "./vault";

/** 造一条可解密的条目。 */
function item(
  id: number,
  site: string,
  url: string,
  key: string,
  tags: string[]
): SecretItem {
  return {
    id,
    keyEpoch: 0,
    updatedAt: "2026-01-01T00:00:00.000Z",
    pending: false,
    plain: { site, url, key, note: "", tags },
    decryptError: false,
  };
}

/** 造一条解密失败的条目（plain=null）。 */
function brokenItem(id: number): SecretItem {
  return {
    id,
    keyEpoch: 0,
    updatedAt: "2026-01-01T00:00:00.000Z",
    pending: false,
    plain: null,
    decryptError: true,
  };
}

describe("normalizePlain / emptyPlain", () => {
  it("emptyPlain 字段齐全且为空", () => {
    expect(emptyPlain()).toEqual({ site: "", url: "", key: "", note: "", tags: [] });
  });

  it("normalizePlain 补全缺失字段并过滤非字符串标签", () => {
    const out = normalizePlain({ site: "X", tags: ["a", 1 as unknown as string, "b"] });
    expect(out).toEqual({ site: "X", url: "", key: "", note: "", tags: ["a", "b"] });
  });

  it("normalizePlain 对 null/undefined 容错", () => {
    expect(normalizePlain(null)).toEqual(emptyPlain());
    expect(normalizePlain(undefined)).toEqual(emptyPlain());
  });
});

describe("标签统计（R18）", () => {
  const items: SecretItem[] = [
    item(1, "GitHub", "https://github.com", "k1", ["工作", "开发"]),
    item(2, "GitLab", "https://gitlab.com", "k2", ["工作"]),
    item(3, "个人邮箱", "https://mail.example", "k3", []),
    brokenItem(4),
  ];

  it("collectTags 统计各标签出现次数并按名称排序", () => {
    const tags = collectTags(items);
    expect(tags).toEqual([
      { name: "工作", count: 2 },
      { name: "开发", count: 1 },
    ]);
  });

  it("countByTag 返回某标签影响的条目数（删除前提示用）", () => {
    expect(countByTag(items, "工作")).toBe(2);
    expect(countByTag(items, "开发")).toBe(1);
    expect(countByTag(items, "不存在")).toBe(0);
  });

  it("解密失败条目不参与标签统计", () => {
    // brokenItem 的 plain 为 null，collectTags 不应报错也不应计入
    expect(() => collectTags([brokenItem(9)])).not.toThrow();
    expect(collectTags([brokenItem(9)])).toEqual([]);
  });
});

describe("本机搜索过滤（R19，关键词不外发）", () => {
  const items: SecretItem[] = [
    item(1, "GitHub", "https://github.com", "k1", ["工作"]),
    item(2, "GitLab", "https://gitlab.com", "k2", ["工作", "开源"]),
    item(3, "Stripe", "https://dashboard.stripe.com", "k3", ["支付"]),
    brokenItem(4),
  ];

  it("无筛选时返回全部（含解密失败条目）", () => {
    expect(filterItems(items, null, "").map((i) => i.id)).toEqual([1, 2, 3, 4]);
  });

  it("按标签筛选", () => {
    expect(filterItems(items, "工作", "").map((i) => i.id)).toEqual([1, 2]);
    expect(filterItems(items, "支付", "").map((i) => i.id)).toEqual([3]);
  });

  it("关键词匹配站点名（大小写不敏感）", () => {
    expect(filterItems(items, null, "git").map((i) => i.id)).toEqual([1, 2]);
    expect(filterItems(items, null, "STRIPE").map((i) => i.id)).toEqual([3]);
  });

  it("关键词匹配网址", () => {
    expect(filterItems(items, null, "dashboard").map((i) => i.id)).toEqual([3]);
  });

  it("关键词匹配标签", () => {
    expect(filterItems(items, null, "开源").map((i) => i.id)).toEqual([2]);
  });

  it("标签 + 关键词联合筛选", () => {
    expect(filterItems(items, "工作", "lab").map((i) => i.id)).toEqual([2]);
  });

  it("解密失败条目在任何筛选下都不可见（避免误导）", () => {
    expect(filterItems(items, null, "x").some((i) => i.id === 4)).toBe(false);
    expect(filterItems(items, "工作", "").some((i) => i.id === 4)).toBe(false);
  });

  it("纯函数：同一输入两次调用结果一致（无隐藏网络/全局状态）", () => {
    const a = filterItems(items, "工作", "git").map((i) => i.id);
    const b = filterItems(items, "工作", "git").map((i) => i.id);
    expect(a).toEqual(b);
  });
});

describe("标签批量变更（R18，供重命名/删除使用）", () => {
  const items: SecretItem[] = [
    item(1, "A", "", "k1", ["工作", "开发"]),
    item(2, "B", "", "k2", ["工作"]),
    item(3, "C", "", "k3", ["其他"]),
    brokenItem(4),
  ];

  it("删除标签：仅从含该标签的条目移除，其余条目不动", () => {
    const changed = mapTagChange(items, "工作", null);
    expect(changed.map((c) => c.id)).toEqual([1, 2]);
    expect(changed.find((c) => c.id === 1)?.plain.tags).toEqual(["开发"]);
    expect(changed.find((c) => c.id === 2)?.plain.tags).toEqual([]);
  });

  it("重命名标签：整表改名", () => {
    const changed = mapTagChange(items, "工作", "职业");
    expect(changed.find((c) => c.id === 1)?.plain.tags).toEqual(["职业", "开发"]);
    expect(changed.find((c) => c.id === 2)?.plain.tags).toEqual(["职业"]);
  });

  it("重命名到已存在的同名标签：去重（不产生重复标签）", () => {
    const changed = mapTagChange(items, "工作", "开发");
    expect(changed.find((c) => c.id === 1)?.plain.tags).toEqual(["开发"]);
    // id=2 原本只有 ["工作"]，改为 ["开发"]
    expect(changed.find((c) => c.id === 2)?.plain.tags).toEqual(["开发"]);
  });

  it("不存在的标签：无任何变更", () => {
    expect(mapTagChange(items, "不存在", "X")).toEqual([]);
  });

  it("解密失败条目不出现在变更集里", () => {
    const changed = mapTagChange(items, "工作", null);
    expect(changed.some((c) => c.id === 4)).toBe(false);
  });
});
