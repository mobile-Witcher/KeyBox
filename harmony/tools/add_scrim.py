"""在 Vault 主内容层之后插入一层皮肤遮罩 tint（弹层打开时显示）。

- 找到 `.opacity(this.overlayOpen() ? ...)` 所在行，在其后的 `.animation(...)` 行之后插入；
- 同时把主内容层的压暗改成 1（避免与 tint 双重压暗）。
"""
import sys

PATH = r"F:\project\keybox\KeyBox\harmony\entry\src\main\ets\pages\Vault.ets"

with open(PATH, encoding="utf-8") as fh:
    lines = fh.read().split("\n")

out = []
i = 0
inserted = False
dim_fixed = False

while i < len(lines):
    line = lines[i]

    if ".opacity(this.overlayOpen()" in line:
        indent = line[: len(line) - len(line.lstrip())]
        out.append(f"{indent}.opacity(1)")
        dim_fixed = True
        i += 1
        continue

    out.append(line)

    # 在压暗层的动画行之后插入 tint 层
    if dim_fixed and not inserted and ".animation({ duration: 160" in line:
        indent = line[: len(line) - len(line.lstrip())]
        # 该 indent 属于链式属性，tint 需要与内容 Column 同级（少两格）
        base = indent[:-2] if indent.endswith("  ") else indent
        out.append(f"{base}if (this.overlayOpen()) {{")
        out.append(f"{base}  Text('')")
        out.append(f"{base}    .width('100%')")
        out.append(f"{base}    .height('100%')")
        out.append(f"{base}    .backgroundColor(scrimColor(this.skin))")
        out.append(f"{base}    .hitTestBehavior(HitTestMode.None)")
        out.append(
            f"{base}    .transition(TransitionEffect.OPACITY.animation({{ duration: 160, curve: Curve.EaseOut }}))"
        )
        out.append(f"{base}}}")
        inserted = True

with open(PATH, "w", encoding="utf-8", newline="\n") as fh:
    fh.write("\n".join(out))

print(f"dim_fixed={dim_fixed} tint_inserted={inserted}")
