/**
 * StatusBar.tsx —— 底部状态条（架构 §5.1）。
 * 明示“已解锁 / 本机解密 / 密钥不出本机”，并显示同步状态与待上传条数。
 */
interface StatusBarProps {
  unlocked: boolean;
  online: boolean;
  pending: number;
}

export default function StatusBar({ unlocked, online, pending }: StatusBarProps): JSX.Element {
  const syncText = !unlocked
    ? "未解锁"
    : online
      ? pending > 0
        ? `在线 · ${pending} 条待上传`
        : "在线 · 已同步"
      : `离线 · ${pending} 条待上传（恢复后自动重放）`;

  return (
    <footer className="flex items-center justify-center gap-3 border-t border-kb-border px-6 py-2 text-xs text-kb-muted dark:border-kb-border">
      <span>{unlocked ? "已解锁 · 本机解密 · 密钥不出本机" : "未解锁 · 输入主密码后才能查看密钥"}</span>
      <span aria-hidden>·</span>
      <span>{syncText}</span>
    </footer>
  );
}
