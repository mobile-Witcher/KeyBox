/**
 * icons.tsx —— 项目内统一的内联 SVG 图标集。
 *
 * 为什么自己放一份：项目**没有引入任何图标库**（package.json 无 lucide / heroicons 等），
 * 现有图标都是内联 SVG（见 SecretTable / ThemeToggle）。为不新增依赖，这里沿用同一做法，
 * 并把桌面端重设计用到的图标收在一处，避免各组件各写一份 strokeWidth 不一致。
 *
 * 约定：
 *   - 全部 `stroke="currentColor"`，因此图标颜色**由父级的 text-* 决定**，
 *     天然跟随 9 套皮肤与深色模式（--kb-* 令牌），**图标内不出现任何硬编码色值**。
 *   - 全部 `aria-hidden`，语义由父级按钮的 title / aria-label 承担。
 *   - 只做展示，无状态、无副作用。
 */

export interface IconProps {
  /** 边长（px）；默认 18。 */
  size?: number;
  className?: string;
}

/** 统一的 SVG 属性（24×24 网格、线性描边）。 */
function base(size: number): {
  width: number;
  height: number;
  viewBox: string;
  fill: string;
  stroke: string;
  strokeWidth: number;
  strokeLinecap: "round";
  strokeLinejoin: "round";
  "aria-hidden": boolean;
} {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
  };
}

/** 全部密钥：立方体 / 盒子。 */
export function BoxIcon({ size = 18, className }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} className={className}>
      <path d="M21 8.5 12 3 3 8.5v7L12 21l9-5.5v-7Z" />
      <path d="M3 8.5 12 14l9-5.5" />
      <path d="M12 14v7" />
    </svg>
  );
}

/** 常用：星。 */
export function StarIcon({ size = 18, className }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} className={className}>
      <path d="m12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8L3.6 9.7l5.8-.8L12 3.6Z" />
    </svg>
  );
}

/** 进入验证输入：盾（门禁 / 校验）。 */
export function ShieldIcon({ size = 18, className }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} className={className}>
      <path d="M12 3 5 6v5.5c0 4.3 2.9 8.1 7 9.5 4.1-1.4 7-5.2 7-9.5V6l-7-3Z" />
      <path d="m9.2 12 2 2 3.6-3.8" />
    </svg>
  );
}

/** 云平台：云。 */
export function CloudIcon({ size = 18, className }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} className={className}>
      <path d="M17.5 18H7a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 9.5a4.25 4.25 0 0 1-.5 8.5Z" />
    </svg>
  );
}

/** aiport / 端口：柱状图。 */
export function BarChartIcon({ size = 18, className }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} className={className}>
      <path d="M4 20V10" />
      <path d="M10 20V4" />
      <path d="M16 20v-7" />
      <path d="M22 20H2" />
    </svg>
  );
}

/** 兜底分类：标签。 */
export function TagIcon({ size = 18, className }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} className={className}>
      <path d="M20.6 13.4 12 22l-9-9 8.6-8.6a2 2 0 0 1 1.4-.6H20a2 2 0 0 1 2 2v6.2a2 2 0 0 1-.6 1.4Z" />
      <circle cx="16.5" cy="7.5" r="1.3" />
    </svg>
  );
}

/** 设置（安全操作的入口）。 */
export function SettingsIcon({ size = 18, className }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.94 19.3a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.7 8.94a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15 4.7a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9V9a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1.03Z" />
    </svg>
  );
}

/** 品牌 / 密钥：钥匙。 */
export function KeyIcon({ size = 18, className }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="8" cy="15" r="4" />
      <path d="m10.9 12.1 8.1-8.1" />
      <path d="m16.5 6.5 2 2" />
      <path d="m19 4 2 2" />
    </svg>
  );
}

export function SearchIcon({ size = 18, className }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.6-3.6" />
    </svg>
  );
}

export function CopyIcon({ size = 18, className }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} className={className}>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
  );
}

/** 同步：循环箭头。 */
export function SyncIcon({ size = 18, className }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} className={className}>
      <path d="M20 11A8 8 0 0 0 6.3 6.3L4 8.5" />
      <path d="M4 4v4.5h4.5" />
      <path d="M4 13a8 8 0 0 0 13.7 4.7L20 15.5" />
      <path d="M20 20v-4.5h-4.5" />
    </svg>
  );
}

export function PencilIcon({ size = 18, className }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} className={className}>
      <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3Z" />
      <path d="m14.5 6.5 3 3" />
    </svg>
  );
}

export function TrashIcon({ size = 18, className }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} className={className}>
      <path d="M4 7h16" />
      <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

export function EditIcon({ size = 18, className }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} className={className}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" />
    </svg>
  );
}

/** 网格视图。 */
export function GridIcon({ size = 18, className }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} className={className}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}

/** 列表视图。 */
export function ListIcon({ size = 18, className }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} className={className}>
      <path d="M8 6h13M8 12h13M8 18h13" />
      <circle cx="3.6" cy="6" r="1.2" />
      <circle cx="3.6" cy="12" r="1.2" />
      <circle cx="3.6" cy="18" r="1.2" />
    </svg>
  );
}

export function EyeIcon({ size = 18, className }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} className={className}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function EyeOffIcon({ size = 18, className }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} className={className}>
      <path d="M10.6 6.1A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.4 3.3" />
      <path d="M6.3 7.8A16.6 16.6 0 0 0 2.5 12S6 18.5 12 18.5c1.6 0 3-.4 4.2-1" />
      <path d="m3.5 3.5 17 17" />
    </svg>
  );
}

export function PlusIcon({ size = 18, className }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} className={className}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

/** 用户组（管理后台入口）。 */
export function UsersIcon({ size = 18, className }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} className={className}>
      <path d="M16 20v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V20" />
      <circle cx="9" cy="7" r="3.2" />
      <path d="M22 20v-1.5a4 4 0 0 0-3-3.87" />
      <path d="M16.5 3.9a3.2 3.2 0 0 1 0 6.2" />
    </svg>
  );
}

/** 退出登录。 */
export function LogOutIcon({ size = 18, className }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} className={className}>
      <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
      <path d="M10 17l-5-5 5-5" />
      <path d="M5 12h11" />
    </svg>
  );
}
