/**
 * 把 ArkUI 原生 Button 链批量转成自绘 SkinButton。
 * 跳过带 layoutWeight 的并排按钮（会破坏行内布局）。
 * 用法: node convert_buttons.mjs <file1.ets> [file2.ets ...]
 */
import { readFileSync, writeFileSync } from 'node:fs';

const BUTTON_RE = /^(\s*)Button\('([^']+)'\)\s*$/;

function convert(path) {
  const lines = readFileSync(path, 'utf8').split('\n');
  const out = [];
  let i = 0;
  let converted = 0;
  let skipped = 0;

  while (i < lines.length) {
    const line = lines[i];
    const m = BUTTON_RE.exec(line);
    if (!m) {
      out.push(line);
      i += 1;
      continue;
    }

    const indent = m[1];
    const label = m[2];

    // 收集链式属性行，直到 .onClick(
    let j = i + 1;
    const chain = [];
    while (j < lines.length && lines[j].trim().startsWith('.')) {
      if (lines[j].trim() === '.onClick(() => {') {
        break;
      }
      chain.push(lines[j]);
      j += 1;
    }

    if (j >= lines.length || lines[j].trim() !== '.onClick(() => {') {
      skipped += 1;
      out.push(line);
      i += 1;
      continue;
    }

    // 收集 onClick 主体，直到同缩进的 '})'
    const body = [];
    let end = -1;
    for (let k = j + 1; k < lines.length; k += 1) {
      if (lines[k].trim() === '})') {
        end = k;
        break;
      }
      body.push(lines[k]);
    }

    if (end < 0) {
      skipped += 1;
      out.push(line);
      i += 1;
      continue;
    }

    const chainText = chain.map((c) => c.trim()).join(' ');
    const lw = /\.layoutWeight\((\d+)\)/.exec(chainText);
    const flexWeight = lw ? Number(lw[1]) : 0;

    let kind = 'ghost';
    if (chainText.includes('this.c().primary')) {
      kind = 'primary';
    } else if (chainText.includes('this.c().danger')) {
      kind = 'danger';
    }

    const hm = /\.height\((\d+)\)/.exec(chainText);
    const height = hm ? Number(hm[1]) : 44;
    const disabled = chainText.includes('.enabled(!this.busy)') ? 'this.busy' : '';

    out.push(`${indent}SkinButton({`);
    out.push(`${indent}  label: '${label}',`);
    out.push(`${indent}  kind: '${kind}',`);
    out.push(`${indent}  btnHeight: ${height},`);
    if (disabled) {
      out.push(`${indent}  disabled: ${disabled},`);
    }
    out.push(`${indent}  onTap: () => {`);
    for (const raw of body) {
      const s = raw.trim();
      if (s) {
        out.push(`${indent}    ${s}`);
      }
    }
    out.push(`${indent}  }`);
    out.push(`${indent}})`);

    converted += 1;
    i = end + 1;
  }

  writeFileSync(path, out.join('\n'), 'utf8');
  return { converted, skipped };
}

for (const target of process.argv.slice(2)) {
  const r = convert(target);
  console.log(`  ${target}: converted=${r.converted} skipped=${r.skipped}`);
}
