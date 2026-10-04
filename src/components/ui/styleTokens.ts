import {
  APP_ACCENT_HEX, TEXT_LIGHT_HEX, WHITE_HEX, CAMERA_STAGE_COLOR_HEX,
  IMAGE_EDITOR_GLOW_TINT_HEX, SOCKET_TYPE_COLOR_HEX, CANVAS_GRID_ALT_HEX,
} from '@/core/theme/colorTokens';

/** Alpha masks only: soften the source edge over an already blurred outpaint preview. */
export const UI_OUTPAINT_FEATHER_MASK = `linear-gradient(to right, transparent, ${WHITE_HEX} 12%, ${WHITE_HEX} 88%, transparent), linear-gradient(to bottom, transparent, ${WHITE_HEX} 12%, ${WHITE_HEX} 88%, transparent)`;
/** 纯色块强调填充（进度条、裁剪手柄等无文字场景）。承载文字的强调实底用 `bg-accent text-on-accent`。 */
export const UI_COLOR_ACCENT_BG_CLASS = 'bg-accent';
/** 强调实底 + 自动黑白文字（对比度由主题引擎保证 ≥ 4.5:1）。 */
export const UI_COLOR_ACCENT_FILL_TEXT_CLASS = 'bg-accent text-on-accent';
/** 强调文字（深浅主题都满足 4.5:1；不要用 `text-accent` 压文字）。 */
export const UI_COLOR_ACCENT_TEXT_CLASS = 'text-accent-text';
export const UI_ACCENT_HEX = APP_ACCENT_HEX;
export const UI_WHITE_HEX = WHITE_HEX;
export const UI_TEXT_LIGHT_HEX = TEXT_LIGHT_HEX;

/* ---------------------------------------------------------------------------
 * 选中态词汇表（重要记录 001/012，任务 2.2 → 4.3）
 *
 * 选中必须一眼可辨：淡强调底（`selected-accent`，强调色低透明度）+ 强调文字/勾/指示条；
 * 强调色实底只给唯一主动作；悬停只用中性抬升，悬停与选中不得同色（012 修订 003 的中性抬升）。
 * 1. 导航“正在看哪里”：淡强调底 + 主要文字（图标强调色）+ 强调色方向指示条（面板标签：主要文字 + 强调色底部细线）
 * 2. 单选“值是什么”：淡强调底；分段/格子用强调文字，菜单项保持主要文字 + 强调色勾
 * 3. 多选“集合里哪些已选”：强调描边 + 淡强调底 + 强调文字
 * 4. 布尔“是否开启”：强调色只进入开关轨道或复选框本体，整行保持静息
 *
 * 令牌只负责状态，不和静息态类叠加同一 CSS 属性。调用组件必须用互斥分支，
 * 否则 Tailwind 产物顺序会让选中态静默失效。业务调用点只传 active / checked，不直接拼这些类。
 * ------------------------------------------------------------------------- */

/** 导航选中：淡强调底 + 主要文字，图标取强调文字色。指示条由导航组件按方向补充（重要记录 012）。 */
export const UI_NAV_ITEM_ACTIVE_CLASS = 'bg-selected-accent text-text1 [&_svg]:text-accent-text';

/** 面板标签（设计稿面板头）：选中只换成主要文字 + 底部细线，背景保持透明。 */
export const UI_NAV_ITEM_ACTIVE_SUBTLE_CLASS = 'text-text1';

/** 纵向导航的末端指示条。 */
export const UI_NAV_INDICATOR_END_CLASS =
  "after:absolute after:right-0 after:top-1.5 after:bottom-1.5 after:w-0.5 after:rounded-full after:bg-accent after:content-['']";

/** 横向导航的底部指示条。 */
export const UI_NAV_INDICATOR_BOTTOM_CLASS =
  "after:absolute after:bottom-0 after:left-2 after:right-2 after:h-0.5 after:bg-accent after:content-['']";

/** 标题栏工作区导航的底部短指示条（居中 12px，强调色）。 */
export const UI_NAV_INDICATOR_BOTTOM_SHORT_CLASS =
  "after:absolute after:bottom-0.5 after:left-1/2 after:h-0.5 after:w-3 after:-translate-x-1/2 after:rounded-full after:bg-accent after:content-['']";

/** 面板标签的底部细线（1.5px 强调色，重要记录 012：选中指示用强调色）。 */
export const UI_NAV_INDICATOR_BOTTOM_SUBTLE_CLASS =
  "after:absolute after:bottom-0 after:left-2 after:right-2 after:h-[1.5px] after:bg-accent after:content-['']";

/** 多选/标签选中：强调描边 + 淡强调底 + 强调文字。 */
export const UI_MULTISELECT_ITEM_ACTIVE_CLASS = 'border-accent bg-selected-accent text-accent-text';

/** 布尔控件开态：强调色只用于开关轨道或复选框本体；其上的勾/滑块用 on-accent。 */
export const UI_BOOLEAN_CONTROL_ACTIVE_CLASS = 'border-accent bg-accent text-on-accent';

/* ---------------------------------------------------------------------------
 * 排版层级令牌（重要记录 004）
 *
 * 项目此前 72% 的字号决策都落在 text-xs 及更小，层级实际上塌缩成"全是小字"，
 * 只能靠边框/背景区分内容——这是过度卡片化的根源之一。
 * 用这几档表达层级，优先靠字号字重建立结构，而不是靠画框：
 *   页面标题 20/600 · 区块标题 16/600 · 面板标题 14/500 · 正文与控件 13/400（基准）
 *   · 次要信息 12/400 · 元信息 11/500。界面文字最小 11px。
 * 字体：拉丁字母与数字 Geist，中文回落系统字体；数值/时间码见 UI_TEXT_NUMERIC/TIMECODE。
 * ------------------------------------------------------------------------- */

/** 页面标题 20/600：页面/弹窗主标题 */
export const UI_TEXT_TITLE_CLASS = 'text-xl font-semibold text-text1';

/** 区块标题 16/600：分区标题（UiGroup 的 title） */
export const UI_TEXT_SECTION_CLASS = 'text-base font-semibold text-text1';

/** 面板标题 14/500：侧栏、检查器、浮层内的面板名 */
export const UI_TEXT_PANEL_TITLE_CLASS = 'text-sm font-medium text-text1';

/** 正文与控件 13/400（基准字号，与 body 默认一致） */
export const UI_TEXT_BODY_CLASS = 'text-13 text-text1';

/** 字段标签 13/500 */
export const UI_TEXT_LABEL_CLASS = 'text-13 font-medium text-text2';

/** 次要信息 12/400：规格、计数等第二层信息 */
export const UI_TEXT_SECONDARY_CLASS = 'text-xs text-text2';

/** 元信息 11/500：时间、状态说明、辅助说明（text3 保证 ≥ 4.5:1） */
export const UI_TEXT_META_CLASS = 'text-2xs font-medium text-text3';

/**
 * 等宽数字：会变化的数值（计数、百分比、尺寸、价格）用它防止数字跳动。
 * Geist 自带等宽数字特性，不需要换字体。
 */
export const UI_TEXT_NUMERIC_CLASS = 'tabular-nums';

/** 时间码与代码式数值：Geist Mono + 等宽数字（如 00:00:01:59、帧号、十六进制） */
export const UI_TEXT_TIMECODE_CLASS = 'font-mono tabular-nums';

/* ---------------------------------------------------------------------------
 * 尺寸令牌（重要记录 004）：控件高度 28/32/36、圆角 控件 6 / 输入与菜单 8 / 浮层 12。
 * 值在 index.css 的 CSS 变量里（圆角随「设置 → 界面 → 圆角」缩放），Tailwind 类见 tailwind.config.js。
 * 按钮（2.1）与字段、选项、触发器（2.2）都用这三档；旧的 42/38 字段高度令牌已删除。
 * ------------------------------------------------------------------------- */

/** 控件高度：sm 28 紧凑 / md 32 默认 / lg 36 醒目 */
export const UI_CONTROL_HEIGHT_CLASS = {
  sm: 'h-control-sm',
  md: 'h-control-md',
  lg: 'h-control-lg',
} as const;

/** 圆角：control 6（按钮、开关、分段）/ field 8（输入、菜单、下拉）/ overlay 12（浮层、弹窗、面板） */
export const UI_RADIUS_CLASS = {
  control: 'rounded-control',
  field: 'rounded-field',
  overlay: 'rounded-overlay',
} as const;

/* ---------------------------------------------------------------------------
 * 间距与分隔令牌
 * ------------------------------------------------------------------------- */

/** 分区之间的纵向间距 */
export const UI_STACK_GAP_CLASS = 'space-y-6';

/** 分区内部行之间的纵向间距 */
export const UI_ROW_GAP_CLASS = 'space-y-3';

/**
 * 表单行之间的纵向间距。
 *
 * 单独一档的理由：`UI_ROW_GAP_CLASS`（12px）是给纯控件行用的，一旦行带上说明小字，
 * 12px 会让"上一行的说明"和"下一行的标签"粘在一起，读不出行的边界；
 * 而 `UI_STACK_GAP_CLASS`（24px）是分区级的距离，用在行之间会把一个分区拆散。
 * 设置面板的行全部用这一档，不要在调用点各写各的 `space-y-4/5/6`。
 */
export const UI_FORM_ROW_GAP_CLASS = 'space-y-5';

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
export const UI_META_BADGE_CLASS = 'bg-hover border border-line px-2 py-0.5 rounded';

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

/**
 * 字段表面（输入、文本域、原生选择、字段触发器、数值框）：设计稿“输入 / 浮层”档 `raised`，**无边框**——
 * 层次靠明暗，聚焦时一圈强调色焦点环（`UI_FIELD_FOCUS_CLASS`）。玻璃内由 `ui-glass-adaptive-control` 换成控件纱。
 */
export const UI_FIELD_SURFACE_CLASS = 'bg-raised text-text1 ui-glass-adaptive-control';

/**
 * 字段尺寸档位（重要记录 004）：高度 28/32/36，字号 12/13/13，圆角 sm 用控件档 6、md/lg 用输入档 8。
 * `UiInput`/`UiSelect`/`UiFieldTrigger`/`NumberInput` 的 `size` 共用这张表，调用点不再写高度与字号。
 */
export const UI_FIELD_SIZE_CLASS = {
  sm: `${UI_CONTROL_HEIGHT_CLASS.sm} text-xs ${UI_RADIUS_CLASS.control}`,
  md: `${UI_CONTROL_HEIGHT_CLASS.md} text-13 ${UI_RADIUS_CLASS.field}`,
  lg: `${UI_CONTROL_HEIGHT_CLASS.lg} text-13 ${UI_RADIUS_CLASS.field}`,
} as const;

export type UiFieldSize = keyof typeof UI_FIELD_SIZE_CLASS;

/** 字段内边距（左右），与尺寸档对应；带图标/附件的字段由调用点用 pl-/pr- 预留位置。 */
export const UI_FIELD_PADDING_CLASS: Record<UiFieldSize, string> = {
  sm: 'px-2',
  md: 'px-2.5',
  lg: 'px-3',
};

/** 字段标签（带块级布局与下间距的表单专用变体，视觉继承 UI_TEXT_LABEL_CLASS） */
export const UI_FIELD_LABEL_CLASS = `block ${UI_TEXT_LABEL_CLASS} mb-1.5`;

/**
 * 工具条排布（`UiFieldLayoutContext` = `toolbar`）下的字段标签：标签在控件左侧，辅助文字档 12，
 * 不换行。控件本身保持 32 高，整行读作一条工具条而不是一张表单（界面重设计 3.2）。
 */
export const UI_FIELD_LABEL_INLINE_CLASS = 'shrink-0 whitespace-nowrap text-xs text-text3';

/** 工具条排布下“标签 + 控件”的行内容器。 */
export const UI_FIELD_INLINE_ROW_CLASS = 'inline-flex min-h-control-md min-w-0 items-center gap-1.5';

/** 字段聚焦：一圈 2px 强调色焦点环（内收，避免被滚动容器或 overflow-hidden 裁掉）。 */
export const UI_FIELD_FOCUS_CLASS =
  'outline-none focus:outline-none focus-visible:outline-none focus:ring-2 focus:ring-inset focus:ring-accent-ring transition-shadow duration-120';

/** 复合字段（数值框、带按钮的输入）把表面画在外壳上时使用，焦点由内部输入框传给整块控件。 */
export const UI_FIELD_FOCUS_WITHIN_CLASS =
  'outline-none focus-within:ring-2 focus-within:ring-inset focus-within:ring-accent-ring transition-shadow duration-120';

/** 占位文字：辅助文字档（保证 ≥ 4.5:1）。 */
export const UI_FIELD_PLACEHOLDER_CLASS = 'placeholder:text-text3';

export const UI_FIELD_DISABLED_CLASS = 'disabled:opacity-50 disabled:cursor-not-allowed';

export const UI_BUTTON_RESET_CLASS =
  '!outline-none focus:!outline-none focus-visible:!outline-none !ring-0 focus:!ring-0 focus-visible:!ring-0 shadow-none focus:shadow-none';

/**
 * 下拉菜单与 PanelTrigger 的浮层表面（设计稿“菜单与浮层：玻璃仅压在媒体上”）。
 *
 * - 默认实底：面板底 + 强分隔发丝线 + 浮层投影。浮层内的字段（raised）、选项格（raised）与悬停/选中底
 *   都比它亮，层次清楚；与“关闭毛玻璃”时玻璃浮层的退化外观一致。
 * - `UI_TRIGGER_PANEL_GLASS_CLASS`：只给压在画布、图片、视频、3D 视口上的浮层（`surface="glass"`）。
 *   一整块玻璃（深浅主题由主题引擎派生 glass 令牌，浅色下是浅底 + 深色纱），内部选项不各自模糊。
 * 圆角取输入与菜单档 8；内容裁到圆角内。
 */
export const UI_TRIGGER_PANEL_CLASS =
  `bg-panel border border-line-strong shadow-panel overflow-hidden ${UI_RADIUS_CLASS.field} text-text1`;

export const UI_TRIGGER_PANEL_GLASS_CLASS =
  `ui-glass ui-glass-elevated overflow-hidden ${UI_RADIUS_CLASS.field} text-text1`;

/** 浮层表面档：`solid`（默认，普通界面上）/ `glass`（压在画布与媒体上）。 */
export const UI_TRIGGER_PANEL_SURFACE_CLASS = {
  solid: UI_TRIGGER_PANEL_CLASS,
  glass: UI_TRIGGER_PANEL_GLASS_CLASS,
} as const;

export type UiTriggerPanelSurface = keyof typeof UI_TRIGGER_PANEL_SURFACE_CLASS;

/** 浮层面板的内边距档位（`Dropdown` / `PanelTrigger` 的 `panelPadding`）。外壳表面不接受调用点覆盖。 */
export const UI_TRIGGER_PANEL_PADDING_CLASS = {
  none: '',
  menu: 'p-1',
  content: 'p-3',
} as const;

export type UiTriggerPanelPadding = keyof typeof UI_TRIGGER_PANEL_PADDING_CLASS;

/** 描边选项（`UiOptionButton` 默认变体）的静息态：纯文字 chip 组靠一圈发丝线保留点击可供性。 */
export const UI_OPTION_ITEM_CLASS =
  'rounded-lg border border-line-strong text-text1 transition-colors';

/**
 * 中性实底控件在 `.ui-glass` 内随毛玻璃开关联动；类本身不添加 blur，
 * 也不影响普通不透明面板中的现有外观。
 */
export const UI_GLASS_ADAPTIVE_CONTROL_CLASS = 'ui-glass-adaptive-control';

/** 一块玻璃内部的连续区域 tint；不新增 backdrop-filter，关闭毛玻璃时恢复实底。 */
export const UI_GLASS_ADAPTIVE_REGION_CLASS = 'ui-glass-adaptive-region';

/** 一块玻璃内部的内容表面 tint；用于侧栏、内容卡等，不新增 backdrop-filter。 */
export const UI_GLASS_ADAPTIVE_SURFACE_CLASS = 'ui-glass-adaptive-surface';

/** 玻璃内部的材质分隔线；关闭毛玻璃时恢复为语义边框色。 */
export const UI_GLASS_ADAPTIVE_DIVIDER_CLASS = 'ui-glass-adaptive-divider';

/**
 * 纵向导航项静息态的 hover 底。由 `UiNavButton` 统一消费，调用点不需要自己判断
 * 当前导航在不在玻璃里——普通面板中是 hover 实底，玻璃里自动换成玻璃纱。
 */
export const UI_GLASS_ADAPTIVE_NAV_CLASS = 'ui-glass-adaptive-nav'

/**
 * 静息态不描边的选项（`UiOptionButton variant="menu"`）的 hover 底。
 *
 * 为什么不能沿用 `UI_GLASS_ADAPTIVE_CONTROL_CLASS`：那个类会给元素一个**静息态的底与边**，
 * 而且 `.ui-glass .ui-glass-adaptive-control`（两个类）的特异性高于工具类 `.border-transparent`
 * （一个类），于是 menu 变体在玻璃里被强行描回了边——「选项集合静息态不描边」这条规则
 * 在玻璃弹窗内会静默失效（实测主题色板就是这么被巡检判为表面叠三层的）。
 */
export const UI_GLASS_ADAPTIVE_OPTION_CLASS = 'ui-glass-adaptive-option';

/**
 * 单选选中底（菜单、网格、分段选择、主题预设格、下拉当前项、双段开关滑块）：淡强调底 `--selected-accent`
 * （选中项悬停再加一档），玻璃里换成 `--ui-glass-selected-accent`。重要记录 012：选中用强调色指示，不用实底。
 */
export const UI_GLASS_ADAPTIVE_SELECTED_CLASS = 'ui-glass-adaptive-selected';

/** 选项格（`UiOptionButton variant="tile" | "grid"`）的静息底：普通面板上是 `raised`，玻璃里是控件纱。 */
export const UI_GLASS_ADAPTIVE_TILE_CLASS = 'ui-glass-adaptive-tile';

/** 分段选择的轨道（容器只是分组，不是按钮）：比所在表面更暗的一条底，段由 `variant="segment"` 填充。 */
export const UI_SEGMENTED_TRACK_CLASS = 'inline-flex w-fit gap-0.5 rounded-lg bg-gap/60 p-0.5';

/**
 * 封面内容卡（画布项目、3D 工程、资产卡；界面重设计 3.3，设计稿 CanvasProjects）：卡片本身不画底与框，
 * 只有封面框有面板底与圆角；悬停一圈强分隔发丝线、键盘焦点一圈焦点环、选中一圈 2px 强调描边，
 * 全部画在封面框的 `::after` 覆盖层上（不会被封面图盖住）。规则在 index.css `.ui-cover-group` / `.ui-cover-frame`。
 *
 * - `UI_COVER_GROUP_CLASS`：放在整张卡的根元素上，选中由根元素的 `data-selected="true"` 表达；
 *   按钮型卡片直接用 `UiOptionButton variant="cover"`（已自带），非按钮根元素（如可拖拽的资产卡）手动加。
 * - `UI_COVER_FRAME_CLASS`：封面框（比例由调用点的 aspect-* 决定）。
 */
export const UI_COVER_GROUP_CLASS = 'ui-cover-group';
export const UI_COVER_FRAME_CLASS = 'ui-cover-frame';

/** 单选选中（菜单项）：淡强调底 + 主要文字（勾用强调色），玻璃内自适应；网格/格子在组件里改强调文字。 */
export const UI_OPTION_ITEM_ACTIVE_CLASS =
  `border-transparent ${UI_GLASS_ADAPTIVE_SELECTED_CLASS} text-text1`;

/**
 * 居中弹窗的统一响应式尺寸。
 *
 * 每档都以当前窗口宽高为基准，并用上下限避免大屏过度铺开、小屏越界：
 * - compact：确认、重命名、短提示
 * - form：普通表单与配置
 * - editor：需要并排编辑或较长内容的悬浮工作窗
 * - settings：带常驻目录的配置面板，宽度＝目录 13rem + 限宽内容列 48rem + 留白
 * - workspace：图片编辑、追踪对比等需要尽量铺开的大工作面
 * - fullscreen：仅 3D 镜头参考等明确需要占满窗口的场景
 */
export const UI_MODAL_SIZE_CLASS = {
  compact: 'w-[min(92vw,clamp(22rem,32vw,30rem))]',
  form: 'w-[min(92vw,clamp(30rem,44vw,44rem))]',
  editor: 'h-[min(78vh,48rem)] w-[min(92vw,clamp(42rem,62vw,68rem))]',
  // 66rem 是按内容算出来的，不是随手取的：目录 w-52(13rem) + 内容 max-w-3xl(48rem)
  // + 内容区左右 px-4 + settings-scroll-body 两侧预留的滚动条位。内容列左对齐，
  // 右侧只留一条正常留白。改内容列限宽时要回头调这个值，见 settingsLayout.ts。
  settings: 'h-[min(88vh,64rem)] w-[min(94vw,66rem)]',
  workspace: 'h-[min(88vh,64rem)] w-[min(94vw,clamp(64rem,86vw,96rem))]',
  fullscreen: 'h-full w-full !max-h-none !rounded-none !border-0',
} as const;

export type UiModalSize = keyof typeof UI_MODAL_SIZE_CLASS;

export const UI_UPLOADER_CARD_BORDER_CLASS = 'border-1.5 border-text3/60';
export const UI_UPLOADER_CARD_BORDER_OVERRIDE_CLASS = '!border-1.5 !border-text3/60';
/** 灯光色值是所选光源的内容色，不随界面主题变色。 */
export const UI_LIGHTING_COLORS = {
  amber: SOCKET_TYPE_COLOR_HEX.ENUM, warm: CAMERA_STAGE_COLOR_HEX.sunlightWarm,
  neutral: WHITE_HEX, cool: IMAGE_EDITOR_GLOW_TINT_HEX.dreamy,
  cyan: IMAGE_EDITOR_GLOW_TINT_HEX.neon, blue: SOCKET_TYPE_COLOR_HEX.NUMBER,
  magenta: SOCKET_TYPE_COLOR_HEX.AUDIO, red: SOCKET_TYPE_COLOR_HEX.VIDEO,
} as const

export const UI_LIGHTING_BRIGHTNESS_GRADIENT = `linear-gradient(90deg, ${CANVAS_GRID_ALT_HEX}, ${TEXT_LIGHT_HEX})`
export const UI_LIGHTING_COLOR_GRADIENT = `linear-gradient(90deg, ${Object.values(UI_LIGHTING_COLORS).join(', ')})`

/** 滑块：白边 + 外圈固定深色细线（shadow-thumb-ring），压在任何内容色（含纯白端）上都有可辨轮廓。 */
export const UI_LIGHTING_RANGE_CLASS = `rounded-full focus-visible:ring-2 focus-visible:ring-brand-300
  [&::-webkit-slider-runnable-track]:!h-2.5 [&::-moz-range-track]:!h-2.5
  [&::-webkit-slider-runnable-track]:[background:var(--lighting-track)] [&::-moz-range-track]:[background:var(--lighting-track)]
  [&::-webkit-slider-thumb]:!mt-[-3px] [&::-webkit-slider-thumb]:!h-4 [&::-webkit-slider-thumb]:!w-7
  [&::-moz-range-thumb]:!h-4 [&::-moz-range-thumb]:!w-7
  [&::-webkit-slider-thumb]:!bg-[var(--lighting-color)] [&::-moz-range-thumb]:!bg-[var(--lighting-color)]
  [&::-webkit-slider-thumb]:!border-2 [&::-webkit-slider-thumb]:!border-solid [&::-webkit-slider-thumb]:!border-on-media
  [&::-moz-range-thumb]:!border-2 [&::-moz-range-thumb]:!border-solid [&::-moz-range-thumb]:!border-on-media
  [&::-webkit-slider-thumb]:shadow-thumb-ring [&::-moz-range-thumb]:shadow-thumb-ring`
