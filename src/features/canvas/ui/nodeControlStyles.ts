export const NODE_CONTROL_CHIP_CLASS = '!h-7 !rounded-md !px-2.5 !text-xs !font-normal !gap-1.5';

export const NODE_CONTROL_MODEL_CHIP_CLASS = '!w-full !min-w-0 !max-w-[260px] !justify-start';

export const NODE_CONTROL_PARAMS_CHIP_CLASS = '!max-w-[120px] !justify-start';

export const NODE_CONTROL_PRIMARY_BUTTON_CLASS =
  '!h-7 !rounded-lg !px-2.5 !text-2xs !gap-1.5 border border-transparent';

export const NODE_CONTROL_ICON_CLASS = 'h-3 w-3';

export const NODE_PORT_BASE_CLASS =
  '!h-2.5 !w-2.5 !border !border-surface-dark !opacity-0 transition-opacity duration-150';

export const NODE_PORT_VISIBLE_CLASS = '!opacity-100';

export const NODE_PORT_ROW_CLASS = `${NODE_PORT_BASE_CLASS} group-hover/row:!opacity-100`;

export const NODE_PORT_NODE_CLASS = `${NODE_PORT_BASE_CLASS} group-hover:!opacity-100`;

/**
 * 节点逐行输入的统一卡片外壳（媒体/参数/模型/提示词行共用）。
 * 圆角、边框、背景固定不变，行内具体控件（下拉/开关/数值）各自保持自身样式，
 * 避免"不同控件类型各自圆角"导致的不统一感。
 */
export const NODE_ROW_CARD_CLASS =
  'rounded-lg border border-[rgba(255,255,255,0.1)] bg-bg-dark/45 transition-colors';

export const NODE_ROW_CLASS =
  `group/row relative flex min-h-10 items-center gap-3 px-3 py-1.5 ${NODE_ROW_CARD_CLASS}`;

export const NODE_ROW_LABEL_CLASS = 'w-[64px] shrink-0 text-left text-xs text-text-muted';

export const NODE_ROW_CONTROL_SLOT_CLASS = 'ml-auto flex min-w-0 items-center justify-end';

/** 未连线行的悬停提示（连线行改用插槽色底色，不叠加该 hover） */
export const NODE_ROW_HOVER_CLASS = 'hover:bg-white/[0.06]';

/** 行与行之间的间隙（替代旧版贴边 divide-y），让每行读成独立卡片 */
export const NODE_ROW_GAP_CLASS = 'gap-1.5';

/** 结果节点生成失败时的红色描边（配合 NodeGenerationError 覆盖层使用） */
export const NODE_GENERATION_ERROR_BORDER_CLASS =
  'border-red-500/70 shadow-[0_0_0_1px_rgba(239,68,68,0.28)]';

