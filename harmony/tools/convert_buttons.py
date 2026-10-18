"""把 ArkUI 原生 Button 链批量转成自绘 SkinButton（跳过带 layoutWeight 的行内按钮）。

用法：python convert_buttons.py <file1.ets> [file2.ets ...]
"""
import re
import sys

BUTTON_RE = re.compile(r"^(\s*)Button\('([^']+)'\)\s*$")
CHAIN_RE = re.compile(r"^\s*\.(.+)$")
HEIGHT_RE = re.compile(r"\.height\((\d+)\)")


def convert(path: str) -> tuple[int, int]:
    with open(path, encoding="utf-8") as fh:
        lines = fh.read().split("\n")

    out: list[str] = []
    i = 0
    converted = 0
    skipped = 0

    while i < len(lines):
        line = lines[i]
        m = BUTTON_RE.match(line)
        if not m:
            out.append(line)
            i += 1
            continue

        indent, label = m.group(1), m.group(2)
        j = i + 1
        chain: list[str] = []
        while j < len(lines) and lines[j].strip().startswith("."):
            if lines[j].strip() == ".onClick(() => {":
                break
            chain.append(lines[j])
            j += 1

        if j >= len(lines) or lines[j].strip() != ".onClick(() => {":
            skipped += 1
            out.append(line)
            i += 1
            continue

        body: list[str] = []
        end = -1
        for k in range(j + 1, len(lines)):
            if lines[k].strip() == "})":
                end = k
                break
            body.append(lines[k])

        if end < 0:
            skipped += 1
            out.append(line)
            i += 1
            continue

        chain_text = " ".join(c.strip() for c in chain)
        if "layoutWeight" in chain_text:
            skipped += 1
            out.append(line)
            i += 1
            continue

        kind = "ghost"
        if "this.c().primary" in chain_text:
            kind = "primary"
        elif "this.c().danger" in chain_text:
            kind = "danger"

        hm = HEIGHT_RE.search(chain_text)
        height = int(hm.group(1)) if hm else 44

        disabled = "this.busy" if ".enabled(!this.busy)" in chain_text else ""

        out.append(f"{indent}SkinButton({{")
        out.append(f"{indent}  label: '{label}',")
        out.append(f"{indent}  kind: '{kind}',")
        out.append(f"{indent}  btnHeight: {height},")
        if disabled:
            out.append(f"{indent}  disabled: {disabled},")
        out.append(f"{indent}  onTap: () => {{")
        for raw in body:
            stripped = raw.strip()
            if stripped:
                out.append(f"{indent}    {stripped}")
        out.append(f"{indent}  }}")
        out.append(f"{indent}}})")

        converted += 1
        i = end + 1

    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write("\n".join(out))

    return converted, skipped


if __name__ == "__main__":
    for target in sys.argv[1:]:
        c, s = convert(target)
        print(f"  {target}: converted={c} skipped={s}")
