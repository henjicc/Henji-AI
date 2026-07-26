/**
 * 动效档位。
 *
 * 收敛前散落 8 种时长（200/150/300/250/220/100/75/500）与两种缓动，
 * 且 JS 侧的卸载计时与 CSS 侧的过渡时长对不上——`UI_DIALOG_TRANSITION_MS` 是
 * 180ms 而 `UiModal` 的 className 写的是 `duration-200`，组件在淡出还剩 20ms 时
 * 就被卸载，收尾被硬切。这类问题不报错，只表现为"关闭时有点生硬"。
 *
 * ⚠️ **`UI_DURATION` 的数值必须与 `UI_DURATION_CLASS` 的同名档完全一致。**
 * 不能写成 `` `duration-${UI_DURATION.fast}` `` —— Tailwind 静态扫描看不到
 * 运行时拼接的类名，那样不会生成任何 CSS。两处都写字面量，由
 * `motion.test.ts` 保证它们不漂移。
 */
export const UI_DURATION = {
  /** 150ms：hover、颜色、开关、小控件 */
  fast: 150,
  /** 200ms：弹窗、浮层、下拉、面板开合 —— 默认档 */
  base: 200,
  /** 300ms：大面积位移、侧栏模式切换、悬浮输入面板折叠 */
  slow: 300,
  /**
   * 500ms：全屏媒体查看器的沉浸式淡入淡出。
   * 不是随手加的档——位移/覆盖面积越大，时长就该越长（标准动效原则），
   * 且收敛前已有 7 处查看器在用 500ms，属于有真实理由的聚类。
   */
  viewer: 500,
} as const;

/** 与 UI_DURATION 一一对应的 Tailwind 类，必须是字面量 */
export const UI_DURATION_CLASS = {
  fast: 'duration-150',
  base: 'duration-200',
  slow: 'duration-300',
  viewer: 'duration-500',
} as const;

/**
 * 缓动统一用 `ease-out`：元素进场/退场应该减速落位。
 * Tailwind 不写 `ease-*` 时默认是 `ease-in-out`，起步和收尾都慢，
 * 在小尺度 UI 上显得拖沓——所以要显式写。
 */
export const UI_EASE_CLASS = 'ease-out';

/** `ease-out` 的 timing-function 字面量，供内联 style 使用（与 UI_EASE_CLASS 等价） */
export const UI_EASE = 'cubic-bezier(0, 0, 0.2, 1)';

/**
 * 具名特效缓动：缩略图堆叠"扇形展开"的弹性感。
 *
 * 这是**登记过的例外**，不是可以随手用的第二种缓动——和 `shadow-node-selected`
 * 那类具名阴影同一个逻辑：它有具体的功能语义（表达"卡片被推开"），
 * 用 `ease-out` 会失去那份手感。新代码不要为了"想要点不一样"再发明缓动，
 * 确有必要时在这里登记并写明理由。
 */
export const UI_EASE_STACK = 'cubic-bezier(0.15, 0.75, 0.3, 1)';

/**
 * 内联 `style={{ transition }}` 的唯一出口。
 *
 * 内联过渡绕过了 Tailwind 类，也就绕过了档位约束——收敛前这里散落 9 种时长
 * 与 5 种缓动。确实需要内联时（时长来自运行时数据、或属性无对应 Tailwind 类）
 * 走这个函数，档位和缓动就还在控制之内。
 *
 * 只列举真正会变的属性：**不要传 `['all']`**，那会把 `background-color`、
 * `backdrop-filter` 这些也拖进过渡。
 */
export function uiTransition(
  properties: readonly string[],
  durationMs: number = UI_DURATION.base,
  delayMs = 0
): string {
  const delay = delayMs > 0 ? ` ${delayMs}ms` : '';
  return properties.map((property) => `${property} ${durationMs}ms ${UI_EASE}${delay}`).join(', ');
}

/** 弹窗（UiModal / AlertDialog / 设置）的进出场时长 */
export const UI_DIALOG_TRANSITION_MS = UI_DURATION.base;

/** 浮层（下拉、右键菜单、节点菜单）的进出场时长 */
export const UI_POPOVER_TRANSITION_MS = UI_DURATION.fast;

// Keep custom overlays below the app title bar (h-10 = 40px).
export const UI_CONTENT_OVERLAY_INSET_CLASS = 'inset-x-0 bottom-0 top-10';
