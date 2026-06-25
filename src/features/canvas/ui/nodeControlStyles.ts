export const NODE_CONTROL_CHIP_CLASS = '!h-7 !rounded-lg !px-2.5 !text-[11px] !gap-1.5';

export const NODE_CONTROL_MODEL_CHIP_CLASS = '!w-[170px] !justify-start';

export const NODE_CONTROL_PARAMS_CHIP_CLASS = '!w-[92px] !justify-start';

export const NODE_CONTROL_PRIMARY_BUTTON_CLASS =
  '!h-7 !rounded-lg !px-2.5 !text-[11px] !gap-1.5 border border-transparent';

export const NODE_CONTROL_ICON_CLASS = 'h-3 w-3';

/**
 * 节点逐行输入的统一卡片外壳（媒体/参数/模型/提示词行共用）。
 * 圆角、边框、背景固定不变，行内具体控件（下拉/开关/数值）各自保持自身样式，
 * 避免"不同控件类型各自圆角"导致的不统一感。
 */
export const NODE_ROW_CARD_CLASS =
  'rounded-lg border border-[rgba(255,255,255,0.1)] bg-bg-dark/45 transition-colors';

/** 未连线行的悬停提示（连线行改用插槽色底色，不叠加该 hover） */
export const NODE_ROW_HOVER_CLASS = 'hover:bg-white/[0.06]';

/** 行与行之间的间隙（替代旧版贴边 divide-y），让每行读成独立卡片 */
export const NODE_ROW_GAP_CLASS = 'gap-1.5';

