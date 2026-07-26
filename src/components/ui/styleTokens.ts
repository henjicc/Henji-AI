import { APP_ACCENT_HEX, TEXT_LIGHT_HEX, WHITE_HEX } from '@/core/theme/colorTokens';

export const UI_COLOR_ACCENT_BORDER_CLASS = 'border-brand-500';
export const UI_COLOR_ACCENT_BG_CLASS = 'bg-accent';
export const UI_COLOR_ACCENT_TEXT_CLASS = 'text-brand-300';
export const UI_COLOR_ACCENT_SOFT_BORDER_CLASS = 'border-accent';
export const UI_COLOR_ACCENT_SOFT_BG_CLASS = 'bg-brand-600';
export const UI_COLOR_ACCENT_SOFT_BG_WEAK_CLASS = 'bg-layer';
export const UI_COLOR_ACCENT_RING_CLASS = 'ring-brand-300';
// 注：曾有过 UI_CHIP_ACTIVE_STRONG_CLASS，但它在 UiChipButton 上从未生效——
// 变体自带的 `bg-layer` 在 Tailwind 产物里排在 `bg-brand-600` 之后，永远赢。
// 需要"选中态实底"的选项集合请直接用 UiOptionButton，选中态走 UI_OPTION_ITEM_ACTIVE_CLASS。
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
export const UI_TEXT_LABEL_CLASS = 'text-sm font-medium text-text-soft';

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

/**
 * 元信息徽标（类型/尺寸/时长/时间这类只读标签）。
 * 之前在 TaskCard 里同一串类名抄了 5 遍，收敛到这里；强调态用下面的 accent 变体。
 */
export const UI_META_BADGE_CLASS = 'bg-veil-faint border border-veil-subtle px-2 py-0.5 rounded';

export const UI_META_BADGE_ACCENT_CLASS =
  'bg-accent/10 border border-accent/40 text-brand-300 px-2 py-0.5 rounded';

/*
 * 这里曾经有过 UI_LIST_ITEM_SKIP_TALL_CLASS
 * （`content-visibility:auto` + `contain-intrinsic-size:auto 420px`），用于跳过
 * 生成历史中视口外卡片的布局。实际使用中它会造成明显的滚动闪烁，已移除。
 *
 * 原因：`contain-intrinsic-size` 是一个**固定**的占位高度，而任务卡高度差异极大
 * （排队态约 120px，多图结果可到 800px）。往回滚时占位高度被换成真实高度，
 * 视口上方的内容尺寸突变，滚动锚定晚一帧补偿，表现就是"闪一下又跳回原位"。
 *
 * 结论：`content-visibility:auto` 只适合**行高基本一致**的长列表
 * （如 AssistantRunHistory 的 60px 行、AssistantMemoryPanel 的 92px 行，
 * 它们各自内联声明自己的估值，也不需要共享常量）。
 * 高度差异大的列表要么老老实实虚拟化，要么什么都不做。
 */

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
