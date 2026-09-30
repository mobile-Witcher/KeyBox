/**
 * SecurityModal.tsx —— 安全面板的承载弹层（安全区从页面底部上移到顶栏入口后新增）。
 *
 * 响应式形态：
 *   - 移动端（<640px）：**底部抽屉（sheet）**——贴底弹出、上圆角、最大高度 92vh、内部滚动；
 *     拇指容易够到关闭钮，320px 窄屏也不溢出（宽度 100%，内容区自带滚动）。
 *   - 桌面（≥640px）：**居中弹层（modal）**——水平垂直居中、最大宽 32rem、整体圆角。
 *
 * 可访问性（不引入任何新依赖）：
 *   - role="dialog" + aria-modal="true" + aria-label；
 *   - Esc 关闭；点击遮罩关闭；打开时把焦点移入弹层，关闭时焦点还给触发按钮（由上层 ref 记录）；
 *   - 弹层打开期间锁定 body 滚动，关闭后恢复。
 *
 * ⚠️ 本组件只是「壳」：里面的内容（SecurityPanel）由上层原样塞进来，
 *    不接触任何加密 / 会话 / token 逻辑。颜色一律走 --kb-* 主题令牌。
 */
import { useCallback, useEffect, useRef } from "react";
import { CloseIcon } from "./icons";

interface SecurityModalProps {
  open: boolean;
  onClose: () => void;
  /** 弹层内的内容（上层放 <SecurityPanel …/>，props 由上层原样透传）。 */
  children: React.ReactNode;
}

export default function SecurityModal({
  open,
  onClose,
  children,
}: SecurityModalProps): JSX.Element | null {
  /** 弹层面板：打开时把焦点移进来（Esc / Tab 循环都从这里开始）。 */
  const panelRef = useRef<HTMLDivElement | null>(null);
  /** 打开前 document.activeElement（通常是触发按钮），关闭时还焦点给它。 */
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  const close = useCallback((): void => {
    onClose();
  }, [onClose]);

  // 打开/关闭时的副作用：焦点迁移 + body 滚动锁 + Esc 监听
  useEffect(() => {
    if (!open) return;

    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    // 锁 body 滚动（移动端抽屉下方页面不应跟着滚）
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // 焦点移入弹层（等一帧，确保 DOM 已挂载）
    const raf = window.requestAnimationFrame(() => {
      panelRef.current?.focus();
    });

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener("keydown", onKeyDown);

    return () => {
      window.cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
      // 还焦点给触发按钮（若它还在文档里）
      restoreFocusRef.current?.focus();
      restoreFocusRef.current = null;
    };
  }, [open, close]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      {/* 遮罩：点击关闭 */}
      <button
        type="button"
        aria-label="关闭安全面板"
        onClick={close}
        className="absolute inset-0 cursor-default bg-black/40"
      />

      {/* 弹层面板：移动端底部抽屉 / 桌面居中 */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="安全（改主密码 / 加密备份 / 恢复码）"
        tabIndex={-1}
        className="relative flex max-h-[92vh] w-full flex-col rounded-t-2xl border border-kb-border bg-kb-surface shadow-[var(--kb-shadow-lg)] outline-none focus:outline-none sm:max-h-[88vh] sm:w-auto sm:max-w-2xl sm:rounded-2xl"
      >
        {/* 标题栏：移动端拖拽示意条 + 关闭按钮 */}
        <div className="flex shrink-0 items-start justify-between gap-2 border-b border-kb-border px-4 pb-2 pt-2 sm:px-5 sm:pt-4">
          <span
            aria-hidden="true"
            className="mx-auto mt-1 h-1 w-10 rounded-full bg-kb-border-strong sm:hidden"
          />
          <button
            type="button"
            onClick={close}
            title="关闭"
            aria-label="关闭"
            className="shrink-0 rounded-lg p-1.5 text-kb-muted transition hover:bg-kb-surface-2 hover:text-kb-text sm:absolute sm:right-3 sm:top-3"
          >
            <CloseIcon size={18} />
          </button>
        </div>

        {/* 内容区：内部滚动，SecurityPanel 原样呈现（props 由上层透传，此处不碰业务） */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">{children}</div>
      </div>
    </div>
  );
}
