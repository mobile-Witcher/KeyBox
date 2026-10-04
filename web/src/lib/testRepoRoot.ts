import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 单仓测试用：从当前文件向上寻找"仓库根"（同时含 cloudfunctions/ 与 .github/）。
 *
 * 为什么需要它：四仓合并为单仓后，网页版从"仓库根"变成了"仓库根/web"，
 * 任何写死 `resolve(here, "../..")` 的路径都会少跳一层而 ENOENT。
 * 统一用本助手锚定，之后无论目录怎么搬都不会再坏。
 */
let cached: string | null = null;

export function repoRoot(): string {
  if (cached) return cached;
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i += 1) {
    if (existsSync(dir + "/cloudfunctions") && existsSync(dir + "/.github")) {
      cached = dir;
      return dir;
    }
    dir = resolve(dir, "..");
  }
  throw new Error("testRepoRoot: 找不到仓库根（应同时含 cloudfunctions/ 与 .github/）");
}