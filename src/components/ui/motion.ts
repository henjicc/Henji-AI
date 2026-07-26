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
  /** 300ms：大面积位移、侧栏模式切换 */
  slow: 300,
} as const;

/** 与 UI_DURATION 一一对应的 Tailwind 类，必须是字面量 */
export const UI_DURATION_CLASS = {
  fast: 'duration-150',
  base: 'duration-200',
  slow: 'duration-300',
} as const;

/**
 * 缓动统一用 `ease-out`：元素进场/退场应该减速落位。
 * Tailwind 不写 `ease-*` 时默认是 `ease-in-out`，起步和收尾都慢，
 * 在小尺度 UI 上显得拖沓——所以要显式写。
 */
export const UI_EASE_CLASS = 'ease-out';

/** 弹窗（UiModal / AlertDialog / 设置）的进出场时长 */
export const UI_DIALOG_TRANSITION_MS = UI_DURATION.base;

/** 浮层（下拉、右键菜单、节点菜单）的进出场时长 */
export const UI_POPOVER_TRANSITION_MS = UI_DURATION.fast;

// Keep custom overlays below the app title bar (h-10 = 40px).
export const UI_CONTENT_OVERLAY_INSET_CLASS = 'inset-x-0 bottom-0 top-10';
