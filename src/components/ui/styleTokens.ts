import { APP_ACCENT_HEX, TEXT_LIGHT_HEX, WHITE_HEX } from '@/core/theme/colorTokens';

export const UI_COLOR_ACCENT_BORDER_CLASS = 'border-brand-500';
export const UI_COLOR_ACCENT_BG_CLASS = 'bg-accent';
/**
 * 承载白字的实心强调底。
 *
 * 不能直接用 `bg-accent`：白字压在 accent(#3b82f6) 上实测只有 **3.68:1**，
 * 未达 WCAG AA 的 4.5；`brand-500`（accent 压暗 15%）是 4.85:1，观感上仍是同一支亮蓝。
 * 纯色块填充（进度条、裁剪手柄等无文字场景）继续用 UI_COLOR_ACCENT_BG_CLASS。
 */
export const UI_COLOR_ACCENT_FILL_TEXT_CLASS = 'bg-brand-500';
export const UI_COLOR_ACCENT_TEXT_CLASS = 'text-brand-300';
export const UI_COLOR_ACCENT_SOFT_BORDER_CLASS = 'border-accent';
export const UI_COLOR_ACCENT_SOFT_BG_CLASS = 'bg-brand-600';
export const UI_COLOR_ACCENT_SOFT_BG_WEAK_CLASS = 'bg-layer';
export const UI_COLOR_ACCENT_RING_CLASS = 'ring-brand-300';
export const UI_HIGHLIGHT_RING_INSET_CLASS = `ring-2 ${UI_COLOR_ACCENT_RING_CLASS} ring-inset`;
export const UI_ACCENT_HEX = APP_ACCENT_HEX;
export const UI_WHITE_HEX = WHITE_HEX;
export const UI_TEXT_LIGHT_HEX = TEXT_LIGHT_HEX;

/* ---------------------------------------------------------------------------
 * 选中态词汇表
 *
 * 1. 导航：弱强调，表示“正在看哪里”
 * 2. 选项：强强调，表示“值是什么”
 * 3. 多选：中强调，表示“集合里哪些已选”
 * 4. 布尔：强调色只收在开关/复选框控件本身，不铺满整行
 *
 * 令牌只负责状态，不和静息态类叠加同一 CSS 属性。调用组件必须用互斥分支，
 * 否则 Tailwind 产物顺序会让选中态静默失效。
 * ------------------------------------------------------------------------- */

/** 导航选中：中性底 + 强调文字。指示条由导航组件按方向补充。 */
export const UI_NAV_ITEM_ACTIVE_CLASS =
  `${UI_COLOR_ACCENT_SOFT_BG_WEAK_CLASS} ${UI_COLOR_ACCENT_TEXT_CLASS}`;

/** 纵向导航的末端指示条。 */
export const UI_NAV_INDICATOR_END_CLASS =
  "after:absolute after:right-0 after:top-0 after:h-full after:w-[3px] after:bg-accent after:content-['']";

/** 横向导航的底部指示条。 */
export const UI_NAV_INDICATOR_BOTTOM_CLASS =
  "after:absolute after:bottom-0 after:left-2 after:right-2 after:h-0.5 after:bg-accent after:content-['']";

/** 多选/标签选中：描边 + 中性底 + 强调文字。 */
export const UI_MULTISELECT_ITEM_ACTIVE_CLASS =
  `${UI_COLOR_ACCENT_BORDER_CLASS} ${UI_COLOR_ACCENT_SOFT_BG_WEAK_CLASS} ${UI_COLOR_ACCENT_TEXT_CLASS}`;

/** 布尔控件开态：强调色只用于开关轨道或复选框本体。 */
export const UI_BOOLEAN_CONTROL_ACTIVE_CLASS =
  `${UI_COLOR_ACCENT_BORDER_CLASS} ${UI_COLOR_ACCENT_SOFT_BG_CLASS}`;

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

/* ---------------------------------------------------------------------------
 * 字段控件高度：两档，都不是 Tailwind 刻度（h-9=36 / h-10=40 都不合），
 * 所以登记为具名令牌，不要在调用点各写一遍 `h-[38px]` / `h-[42px]`。
 * 实测收敛前 `h-[38px]` 散落 17 处、`h-[42px]` 散落 4 处，是事实标准但没登记。
 * ------------------------------------------------------------------------- */

/** 标准档 42px：独立表单字段（输入框、下拉、主按钮） */
export const UI_FIELD_CONTROL_HEIGHT_CLASS = 'h-[42px]';

/** 紧凑档 38px：参数面板、逐行控件、面板触发器等密集布局 */
export const UI_FIELD_CONTROL_HEIGHT_SM_CLASS = 'h-[38px]';

/** 字段标签（带块级布局与下间距的表单专用变体，视觉继承 UI_TEXT_LABEL_CLASS） */
export const UI_FIELD_LABEL_CLASS = `block ${UI_TEXT_LABEL_CLASS} mb-1.5`;

export const UI_FIELD_FOCUS_CLASS =
  'outline-none focus:outline-none focus-visible:outline-none focus:ring-inset focus:ring-2 focus:ring-accent focus:ring-offset-0 focus:border-brand-500 transition-shadow duration-300 ease-out';

export const UI_FIELD_DISABLED_CLASS = 'disabled:opacity-50 disabled:cursor-not-allowed';

export const UI_BUTTON_RESET_CLASS =
  '!outline-none focus:!outline-none focus-visible:!outline-none !ring-0 focus:!ring-0 focus-visible:!ring-0 shadow-none focus:shadow-none';

export const UI_TRIGGER_BUTTON_CLASS =
  `${UI_FIELD_SURFACE_CLASS} ${UI_FIELD_FOCUS_CLASS} ${UI_BUTTON_RESET_CLASS} flex items-center justify-between whitespace-nowrap`;

/**
 * 下拉菜单与 PanelTrigger 都是临时悬浮在当前内容之上的最外层表面。
 * 统一使用一块完整玻璃，而不是让内部选项各自模糊；同一时刻通常只展开一块，
 * 所以层数固定且会自动跟随“毛玻璃效果”开关退化为近实心面板。
 */
export const UI_TRIGGER_PANEL_CLASS =
  'ui-glass ui-glass-elevated rounded-lg text-text-dark';

export const UI_OPTION_ITEM_CLASS =
  'rounded-lg border border-border-dark bg-surface-dark text-text-dark transition-colors';

export const UI_OPTION_ITEM_HOVER_CLASS =
  'hover:bg-layer hover:border-text-muted/50';

/**
 * 玻璃浮层**内部条目**的交互态（菜单项、工具条按钮）。
 *
 * 玻璃上不能沿用 `UI_OPTION_ITEM_HOVER_CLASS` 的 `hover:bg-layer`——`layer` 是不透明的
 * `rgb(64 64 64)`，压在玻璃上会变成一块实心灰贴片，把底下的图片/画布整块糊掉。
 * 玻璃的层次只能靠加白（veil），加灰会被 tint 直接吃掉。
 *
 * 玻璃元素**自身**可交互时（整块玻璃就是个按钮）用 `.ui-glass-interactive`，
 * 它叠 background-image 而不是替换 background-color，能保住黑 tint。
 */
export const UI_GLASS_ITEM_HOVER_CLASS =
  'hover:!bg-veil-soft hover:!border-veil-subtle hover:!text-white';

export const UI_OPTION_ITEM_ACTIVE_CLASS =
  `${UI_COLOR_ACCENT_SOFT_BORDER_CLASS} ${UI_COLOR_ACCENT_SOFT_BG_CLASS} text-white`;

/** 原语调用点确需覆盖内部表面时使用，避免业务组件重复拼 `!` 类串。 */
export const UI_OPTION_ITEM_ACTIVE_OVERRIDE_CLASS =
  '!border-accent !bg-brand-600 !text-white hover:!bg-brand-600';

export const UI_DROPDOWN_OPTION_ACTIVE_CLASS =
  '!bg-brand-600 !text-white hover:!bg-brand-600';

export const UI_UPLOADER_CARD_BORDER_CLASS = 'border-1.5 border-veil-strong';
export const UI_UPLOADER_CARD_BORDER_OVERRIDE_CLASS = '!border-1.5 !border-veil-strong';
