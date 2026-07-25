import { APP_ACCENT_HEX, TEXT_LIGHT_HEX, WHITE_HEX } from '@/core/theme/colorTokens';

export const UI_COLOR_ACCENT_BORDER_CLASS = 'border-brand-500';
export const UI_COLOR_ACCENT_BG_CLASS = 'bg-accent';
export const UI_COLOR_ACCENT_TEXT_CLASS = 'text-brand-300';
export const UI_COLOR_ACCENT_SOFT_BORDER_CLASS = 'border-accent';
export const UI_COLOR_ACCENT_SOFT_BG_CLASS = 'bg-brand-600';
export const UI_COLOR_ACCENT_SOFT_BG_WEAK_CLASS = 'bg-layer';
export const UI_COLOR_ACCENT_RING_CLASS = 'ring-brand-300';
export const UI_CHIP_ACTIVE_STRONG_CLASS = 'border-brand-500 bg-brand-600 text-white';
export const UI_CARD_ACTIVE_STRONG_CLASS = 'border-brand-500 bg-brand-700 text-white';
export const UI_HIGHLIGHT_RING_INSET_CLASS = `ring-2 ${UI_COLOR_ACCENT_RING_CLASS} ring-inset`;
export const UI_ACCENT_HEX = APP_ACCENT_HEX;
export const UI_WHITE_HEX = WHITE_HEX;
export const UI_TEXT_LIGHT_HEX = TEXT_LIGHT_HEX;

/* ---------------------------------------------------------------------------
 * 排版层级令牌
 *
 * 项目此前 72% 的字号决策都落在 text-xs 及更小，层级实际上塌缩成"全是小字"，
 * 只能靠边框/背景区分内容——这是过度卡片化的根源之一。
 * 用这五档表达层级，优先靠字号字重建立结构，而不是靠画框。
 * ------------------------------------------------------------------------- */

/** 一级标题：页面/弹窗主标题 */
export const UI_TEXT_TITLE_CLASS = 'text-base font-semibold text-text-dark';

/** 二级标题：分区标题（UiGroup 的 title） */
export const UI_TEXT_SECTION_CLASS = 'text-sm font-medium text-text-dark';

/** 正文 */
export const UI_TEXT_BODY_CLASS = 'text-sm text-text-dark';

/** 字段标签 */
export const UI_TEXT_LABEL_CLASS = 'text-sm font-medium text-zinc-300';

/** 辅助说明/元信息 */
export const UI_TEXT_META_CLASS = 'text-xs text-text-muted';

/* ---------------------------------------------------------------------------
 * 间距与分隔令牌
 * ------------------------------------------------------------------------- */

/** 分区之间的纵向间距 */
export const UI_STACK_GAP_CLASS = 'space-y-6';

/** 分区内部行之间的纵向间距 */
export const UI_ROW_GAP_CLASS = 'space-y-3';

/** 唯一允许的分隔线写法：一条线，不是一个框 */
export const UI_DIVIDER_CLASS = 'border-t border-border-dark/60';

/**
 * 分区堆叠间距：去掉分区卡片后，靠这个间距 + 组标签建立层级。
 * 比原先卡片时代的 space-y-5 更宽松，用留白换回呼吸感。
 * 若将来需要更强切分，只改这一处（加 `divide-y divide-border-dark/60 [&>*+*]:pt-8`）。
 */
export const UI_SECTION_STACK_CLASS = 'space-y-8';

export const UI_PANEL_SURFACE_CLASS =
  'bg-panel border border-border-dark text-text-dark shadow-panel';

/**
 * 内嵌表面（五级容器词汇表的第 4 级 Surface）。
 *
 * 只用更暗的底色做层次，不画边框不画阴影——内层背景只能比外层更暗，不能更亮。
 * `<UiPanel variant="inset">` 就是它，元素类型不是 div（如 `<details>`/`<section>`）
 * 时可以直接消费这个类串，不要另写一套 `bg-layer`/`bg-surface-dark` 的浅色底。
 */
export const UI_INSET_SURFACE_CLASS = 'bg-app/40 text-text-dark';

export const UI_FIELD_SURFACE_CLASS =
  'bg-surface-dark border border-border-dark text-text-dark';

export const UI_FIELD_CONTROL_HEIGHT_CLASS = 'h-[42px]';

/** 字段标签（带块级布局与下间距的表单专用变体，视觉继承 UI_TEXT_LABEL_CLASS） */
export const UI_FIELD_LABEL_CLASS = `block ${UI_TEXT_LABEL_CLASS} mb-1.5`;

export const UI_FIELD_FOCUS_CLASS =
  'outline-none focus:outline-none focus-visible:outline-none focus:ring-inset focus:ring-2 focus:ring-accent focus:ring-offset-0 focus:border-brand-500 transition-shadow duration-300 ease-out';

export const UI_FIELD_DISABLED_CLASS = 'disabled:opacity-50 disabled:cursor-not-allowed';

export const UI_BUTTON_RESET_CLASS =
  '!outline-none focus:!outline-none focus-visible:!outline-none !ring-0 focus:!ring-0 focus-visible:!ring-0 shadow-none focus:shadow-none';

export const UI_TRIGGER_BUTTON_CLASS =
  `${UI_FIELD_SURFACE_CLASS} ${UI_FIELD_FOCUS_CLASS} ${UI_BUTTON_RESET_CLASS} flex items-center justify-between whitespace-nowrap`;

export const UI_TRIGGER_PANEL_CLASS =
  `${UI_PANEL_SURFACE_CLASS} rounded-lg`;

export const UI_OPTION_ITEM_CLASS =
  'rounded-lg border border-border-dark bg-surface-dark text-text-dark transition-colors';

export const UI_OPTION_ITEM_HOVER_CLASS =
  'hover:bg-layer hover:border-text-muted/50';

export const UI_OPTION_ITEM_ACTIVE_CLASS =
  `${UI_COLOR_ACCENT_SOFT_BORDER_CLASS} ${UI_COLOR_ACCENT_SOFT_BG_CLASS} text-white`;

export const UI_DROPDOWN_OPTION_ACTIVE_CLASS =
  '!bg-brand-600 !text-white hover:!bg-brand-600';

export const UI_UPLOADER_CARD_BORDER_CLASS = 'border-1.5 border-veil-strong';
export const UI_UPLOADER_CARD_BORDER_OVERRIDE_CLASS = '!border-1.5 !border-veil-strong';
