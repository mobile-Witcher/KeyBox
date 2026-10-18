/**
 * AuthForm.tsx —— 账号三页（初始化 / 手机号登录 / 邀请码激活）共用的表单件。
 * 目的：把表单外观与布局收敛到一处，页面只关心业务逻辑，避免三份重复标记。
 * 注意：这里不接触任何密钥；字段值只以受控字符串在各页面内存中短暂停留。
 *
 * 2026-09-29 视觉精修（"精致克制"）：改用 index.css 的组件工具类（.kb-card-lg / .kb-input /
 * .kb-btn-primary / .kb-hint）与语义令牌，替换原先散落的 slate-* 硬编码；补品牌字标、
 * 背景光晕、加载指示与提示条图标。**props 签名保持不变**，三个页面无需改动。
 */
import type { ChangeEvent, ReactNode } from "react";

/** 居中卡片外壳（含品牌区与极淡背景光晕）。 */
export function AuthCard({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}): JSX.Element {
  return (
    <div className="kb-auth-page relative flex min-h-full items-center justify-center overflow-hidden p-6">
      {/* 纯装饰背景光晕：极淡的品牌色，营造层次而不喧闹 */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-[-22%] h-[440px] w-[640px] -translate-x-1/2 rounded-full bg-kb-primary opacity-[0.07] blur-3xl" />
      </div>

      <div className="kb-card-lg relative w-full max-w-md p-8">
        {/*
         * 终末地皮肤专用结构（其它皮肤通过 CSS 全部隐藏，视觉零变化）：
         *   .kb-auth-termbar 终端顶栏 / .kb-auth-hero 左栏英雄区 / .kb-auth-boot 启动日志
         * 展开条件：[data-skin="endfield"]，见 index.css「授权页双栏终端形态」一节。
         */}
        <div className="kb-term-bar kb-auth-termbar" aria-hidden>
          <span className="kb-plate">Field Terminal</span>
          <b>ENDFIELD // ACCESS</b>
          <span className="kb-term-extra">UNIT EN-07</span>
          <span className="kb-term-extra">LINK STABLE</span>
          <span className="kb-term-extra ml-auto">2026-10-18 16:20</span>
        </div>

        <div className="kb-auth-grid">
          {/*
           * 明日方舟皮肤专用：左栏杂志式主视觉（其它皮肤 display:none）。
           * 竖排 ARKNIGHTS + 超大细字标题 + SERIES 编号 + 机密封条。
           */}
          <aside className="kb-ark-hero" aria-hidden>
            <div className="kb-ark-vert">Arknights · Operator Terminal</div>
            <div className="kb-ark-body">
              <div className="kb-ark-kicker">Ark // Operator Access</div>
              <p className="kb-ark-title">
                Keybox
                <span>Terminal</span>
              </p>
              <p className="kb-ark-cn">密钥保管 · 操作员通道</p>
              <p className="kb-ark-note">
                以手机号验证码确认操作员身份。所有访问行为写入审计记录，明文仅在本次会话内存中停留。
              </p>
              <div className="kb-ark-serial">
                <span>Series 07</span>
                <span>//</span>
                <span>Keybox 0.5.2</span>
                <span>//</span>
                <span>Internal</span>
              </div>
              <div className="kb-ark-redact">
                <i />
                <i />
                <i />
              </div>
            </div>
          </aside>

          {/*
           * 莱茵生命皮肤专用：左栏「实验记录本」（其它皮肤 display:none）。
           * 十字准星 + 扫描场 + 样本编号 + CONFIDENTIAL 印章 + DOC/REV/PAGE 页脚。
           */}
          <aside className="kb-rhine-hero" aria-hidden>
            <div className="kb-rhine-top">
              <span className="kb-rhine-cross" />
              <div>
                <div className="kb-rhine-kicker">Rhine Lab // Specimen File</div>
                <p className="kb-rhine-title">
                  Keybox <span>Archive</span>
                </p>
                <p className="kb-rhine-cn">密钥保管 · 样本档案</p>
              </div>
            </div>
            <p className="kb-rhine-note">
              以手机号验证码核验操作员身份。所有访问写入档案；明文仅在本次会话内存中停留，
              会话结束即擦除。
            </p>
            <div className="kb-scan kb-rhine-scan">
              <span className="kb-rhine-scan-cap">Ctrl field · verified</span>
            </div>
            <div className="kb-rhine-meta">
              <div>
                <span>Sample</span>
                <b>KB-OP-0007</b>
              </div>
              <div>
                <span>Rev</span>
                <b>03</b>
              </div>
              <div>
                <span>Cycle</span>
                <b>30 D</b>
              </div>
              <div>
                <span>Control</span>
                <b>Verified</b>
              </div>
            </div>
            <div className="kb-rhine-stamp">Confidential</div>
            <div className="kb-rhine-foot">
              <span>DOC KB-AC-07</span>
              <span>REV 3</span>
              <span>PAGE 1/1</span>
            </div>
          </aside>

          {/*
           * 众生行记皮肤专用：左栏「旅行手账」（其它皮肤 display:none）。
           * 邮戳编号 + 衬线标题 + 行程三步 + 票根存根 + ARCHIVE 页脚。
           */}
          <aside className="kb-mass-hero" aria-hidden>
            <div className="kb-mass-head">
              <span className="kb-mass-stamp">Travel Log</span>
              <span className="kb-mass-no">No.0042 / 2026</span>
            </div>
            <p className="kb-mass-title">
              The Masses’
              <span>Travels</span>
            </p>
            <p className="kb-mass-cn">众生行记 · 密钥保管</p>
            <p className="kb-mass-note">
              以验证码核验旅人身份；随身密钥仅在本次行记内展开，离册即封存。
            </p>
            <ol className="kb-mass-steps">
              <li>
                <b>01</b>身份核验
              </li>
              <li>
                <b>02</b>密文交接
              </li>
              <li>
                <b>03</b>归档留存
              </li>
            </ol>
            <div className="kb-mass-stub">
              <span>Keybox · Travel Permit</span>
              <span>Admit One</span>
            </div>
            <div className="kb-mass-foot">
              <span>Archive</span>
              <span>Rev 3</span>
              <span>Page 1/1</span>
            </div>
          </aside>

          {/*
           * 众生行记·套印图录 皮肤专用左栏（其它皮肤 display:none）。
           * 参考「众生行记」平面设计图录：钴蓝圆盘 + 细圆环 + 坐标刻度 + 小窗框 + 条码。
           */}
          <aside className="kb-atlas-hero" aria-hidden>
            <div className="kb-atlas-coord">
              <span>Y2</span>
              <span>Y3</span>
              <span>Y4</span>
              <span>Y5</span>
            </div>
            <div className="kb-atlas-body">
              <div className="kb-atlas-caps">Arknights / 6th Anniversary</div>
              <p className="kb-atlas-title">
                The Masses’
                <span>Travels</span>
              </p>
              <p className="kb-atlas-cn">众生行记 · 密钥保管</p>
              <p className="kb-atlas-quote">
                若祈祷无用，
                <br />
                那我们因何祈祷？
              </p>
              <div className="kb-atlas-disc" />
              <div className="kb-atlas-win">
                <span className="kb-atlas-win-bar">
                  <i />
                  <i />
                  <i />
                </span>
                <b>Record · 06</b>
                <span>Laterano / Sanctum</span>
              </div>
              <div className="kb-atlas-bars">
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
              </div>
              <div className="kb-atlas-foot">
                <span>sidestory 06</span>
                <span>interactive edition</span>
              </div>
            </div>
          </aside>

          <aside className="kb-auth-hero" aria-hidden>
            <div>
              <div className="kb-eyebrow">Access protocol / 001</div>
              <p className="kb-display kb-display-outline mt-3 text-4xl text-kb-text">
                Field
                <br />
                Terminal
              </p>
              <p className="mt-3 text-sm font-semibold text-kb-text">现场终端 · 密钥舱授权</p>
              <p className="mt-1 text-xs leading-relaxed text-kb-muted">
                接入后所有操作写入现场记录；密钥舱仅在授权会话中可读。
              </p>
            </div>

            <div className="grid grid-cols-2 gap-px border border-kb-border-strong bg-kb-border-strong">
              <Unit k="Operator" v="07 / KB-OP-0007" />
              <Unit k="Clearance" v="CLASS III" />
              <Unit k="Power cell" v="97% · CHARGED" />
              <Unit k="Radio link" v="STABLE · 12 ms" />
            </div>

            <div className="kb-scan h-32">
              <span className="kb-scan-cap">Palm field · sensor ok</span>
            </div>

            <div className="kb-manual">
              <div className="kb-manual-h">
                <span>Operator manual · p.07</span>
                <span>Rev 3</span>
              </div>
              <h4>Authorization notes</h4>
              <p>每次接入需重新校验操作员身份；明文仅在授权期间停留于内存，会话结束自动擦除。</p>
              <div className="kb-manual-sign">
                <span>Signed · ENDFIELD IND.</span>
                <span className="kb-manual-bc" />
              </div>
            </div>
          </aside>

          <div className="kb-auth-main">
            {/* 品牌区 */}
            <div className="flex items-center gap-2.5">
              <span
                aria-hidden
                className="grid h-9 w-9 place-items-center rounded-xl bg-kb-primary text-base font-bold text-kb-primary-contrast"
              >
                K
              </span>
              <span className="text-lg font-semibold tracking-tight text-kb-text">KeyBox</span>
            </div>

            <h1 className="mt-7 text-lg font-semibold tracking-tight text-kb-text">{title}</h1>
            {subtitle ? (
              <p className="mt-1.5 text-sm leading-relaxed text-kb-muted">{subtitle}</p>
            ) : null}

            <div className="mt-6 space-y-4">{children}</div>

            {footer ? (
              <div className="mt-6 border-t border-kb-border pt-4 text-sm text-kb-muted">
                {footer}
              </div>
            ) : null}

            <div className="kb-auth-boot" aria-hidden>
              <div className="kb-eyebrow">Boot log / 现场记录</div>
              <div className="kb-boot-lines">
                <span>16:20:11 · SENSOR PALM … OK</span>
                <span>16:20:12 · VAULT HANDSHAKE … OK</span>
                <span>16:20:13 · OPERATOR 07 … PENDING AUTH</span>
              </div>
              <div className="kb-hazard mt-2" />
              <p className="kb-boot-warn">Unauthorized access will be logged · 非授权访问将被记录</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** 终端英雄区里的「键 / 值」单元（仅终末地皮肤可见其父容器）。 */
function Unit({ k, v }: { k: string; v: string }): JSX.Element {
  return (
    <div className="bg-kb-surface px-2.5 py-2">
      <div className="font-mono text-[0.58rem] uppercase tracking-[0.18em] text-kb-muted">
        {k}
      </div>
      <div className="mt-1 font-mono text-[0.7rem] font-semibold tracking-[0.06em] text-kb-text">
        {v}
      </div>
    </div>
  );
}

/** 受控文本字段。 */
export function Field({
  label,
  value,
  onChange,
  type = "text",
  autoComplete,
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "password" | "email";
  autoComplete?: string;
  placeholder?: string;
  hint?: string;
}): JSX.Element {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-kb-text">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        autoComplete={autoComplete}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        className="kb-input"
      />
      {hint ? <span className="kb-hint mt-1.5 block">{hint}</span> : null}
    </label>
  );
}

/** 主按钮（含加载指示）。 */
export function PrimaryButton({
  children,
  disabled,
  loading,
}: {
  children: ReactNode;
  disabled?: boolean;
  loading?: boolean;
}): JSX.Element {
  return (
    <button
      type="submit"
      disabled={disabled || loading}
      className="kb-btn-primary w-full py-2.5"
    >
      {loading ? (
        <>
          <span
            aria-hidden
            className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent opacity-70"
          />
          处理中…
        </>
      ) : (
        children
      )}
    </button>
  );
}

/** 错误提示条。message 为 null 时不渲染。 */
export function ErrorBanner({ message }: { message: string | null }): JSX.Element | null {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm leading-relaxed text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300"
    >
      <span aria-hidden className="mt-px shrink-0 font-semibold">
        !
      </span>
      <span>{message}</span>
    </div>
  );
}

/** 中性提示条（如“已初始化，请直接登录”）。 */
export function InfoBanner({ message }: { message: string | null }): JSX.Element | null {
  if (!message) return null;
  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm leading-relaxed text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
      <span aria-hidden className="mt-px shrink-0 font-semibold">
        i
      </span>
      <span>{message}</span>
    </div>
  );
}
