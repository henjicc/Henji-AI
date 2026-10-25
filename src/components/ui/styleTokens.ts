import {
  TEXT_LIGHT_HEX, WHITE_HEX, BLACK_HEX, CAMERA_STAGE_COLOR_HEX,
  IMAGE_EDITOR_GLOW_TINT_HEX, SOCKET_TYPE_COLOR_HEX, CANVAS_GRID_ALT_HEX,
} from '@/core/theme/colorTokens';
import type { UiControlSize, IconButtonSize } from './primitiveInternals';

/** 图标尺寸数值唯一登记在 core/theme/icons；DOM 使用此类表。 */
export const UI_ICON_SIZE_CLASS = {
  xs: 'size-3', sm: 'size-3.5', md: 'size-4', lg: 'size-5', xl: 'size-6', display: 'size-8', hero: 'size-10',
} as const;

/** 仅约束 lucide 图标，波形、曲线等数据 SVG 不参与。 */
export const UI_CONTROL_ICON_CLASS: Record<IconButtonSize, string> = {
  '2xs': '[&_svg.lucide]:size-3',
  xs: '[&_svg.lucide]:size-3.5',
  sm: '[&_svg.lucide]:size-3.5',
  md: '[&_svg.lucide]:size-4',
  lg: '[&_svg.lucide]:size-4',
  xl: '[&_svg.lucide]:size-5',
};

/** Alpha masks only: soften the source edge over an already blurred outpaint preview. */
export const UI_OUTPAINT_FEATHER_MASK = `linear-gradient(to right, transparent, ${WHITE_HEX} 12%, ${WHITE_HEX} 88%, transparent), linear-gradient(to bottom, transparent, ${WHITE_HEX} 12%, ${WHITE_HEX} 88%, transparent)`;
/** 纯色块强调填充（进度条、裁剪手柄等无文字场景）。承载文字的强调实底用 `bg-accent text-on-accent`。 */
export const UI_COLOR_ACCENT_BG_CLASS = 'bg-accent';
/** 强调实底 + 自动黑白文字（对比度由主题引擎保证 ≥ 4.5:1）。 */
/** 强调文字（深浅主题都满足 4.5:1；不要用 `text-accent` 压文字）。 */
export const UI_COLOR_ACCENT_TEXT_CLASS = 'text-accent-text';
export const UI_WHITE_HEX = WHITE_HEX;

/* ---------------------------------------------------------------------------
 * 选中态词汇表（重要记录 001/012，任务 2.2 → 4.3）
 *
 * 注意力优先（重要记录 018/019，修订 012）：强调色只给唯一主动作、播放头与时间码、键盘焦点、当前标签与工作区细线；
 * 选中用中性底 + 主要文字，靠指示条、勾或强调文字区分；悬停只用中性抬升，悬停与选中不得同色。
 * 1. 导航“正在看哪里”：中性选中底 + 主要文字 + 强调色方向指示条（面板标签、工作区导航：只有文字加亮 + 强调色细线）
 * 2. 单选“值是什么”：中性选中底；格子用强调文字，分段用中性抬起底 + 强文字（记录 017），菜单项保持主要文字 + 强调色勾
 * 3. 多选“集合里哪些已选”：强调描边 + 淡强调底 + 强调文字（保留：多选标签必须一眼看出集合）
 * 4. 布尔“是否开启”：复选框中性框 + 主要文字色勾（开关外观相同），不用强调色实底
 *
 * 令牌只负责状态，不和静息态类叠加同一 CSS 属性。调用组件必须用互斥分支，
 * 否则 Tailwind 产物顺序会让选中态静默失效。业务调用点只传 active / checked，不直接拼这些类。
 * ------------------------------------------------------------------------- */

/** 导航选中：中性选中底 + 主要文字。强调色只在导航组件按方向补的指示条上（重要记录 019）。 */
export const UI_NAV_ITEM_ACTIVE_CLASS = 'bg-selected text-text1';

/** 标题栏工作区导航选中：只有文字加亮，底下短指示条由组件补充，不铺底（重要记录 019）。 */
export const UI_NAV_ITEM_ACTIVE_WORKSPACE_CLASS = 'text-text1';

/** 标题栏导航里的浮层开关开着（如助手面板）：不铺底，文字与图标取强调文字色。 */
export const UI_NAV_TOGGLE_ON_CLASS = 'text-accent-text';

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

/**
 * 布尔控件之一：复选框（以及停靠面板里的开关，重要记录 018/019/022）：16px 中性方框，勾选只多一枚主要文字色的勾，
 * 不铺强调色。方框画在 24px 命中区里；悬停整个命中区时方框描边加亮（`group/boolean`）。
 */
export const UI_BOOLEAN_BOX_CLASS = 'pointer-events-none inline-flex h-4 w-4 items-center justify-center rounded-check border transition-colors duration-120';
export const UI_BOOLEAN_BOX_STATE_CLASS = {
  on: 'border-text3 text-text1',
  off: 'border-text3/60 text-transparent group-hover/boolean:border-text3',
} as const;

/**
 * 布尔控件之二：滑块开关（重要记录 022）。36 × 20 的轨道画在 24 高的命中区里；开着轨道铺强调色、滑块取
 * on-accent（与强调色对比 ≥ 4.5），关着轨道取 control-pressed、滑块取主要文字色，悬停轨道加深一档。扁平，不加投影。
 */
export const UI_SWITCH_TRACK_CLASS = {
  on: 'bg-accent',
  off: 'bg-control-pressed group-hover/switch:bg-line-strong',
} as const;
export const UI_SWITCH_THUMB_CLASS = {
  on: 'translate-x-4 bg-on-accent',
  off: 'translate-x-0 bg-text1',
} as const;

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

/** 纵横共用刻度（px）；0 表示清除间距，不是视觉档位。Tailwind key = px / 4。 */
export const UI_SPACING_SCALE = [2, 4, 6, 8, 12, 16, 20, 24, 32] as const;

/** 行内关系从紧到松；行与列使用相同刻度。 */
export const UI_INLINE_GAP_CLASS = {
  micro: 'gap-0.5', tight: 'gap-1', control: 'gap-1.5', group: 'gap-2', row: 'gap-3', section: 'gap-4',
} as const;
export type UiInlineGap = keyof typeof UI_INLINE_GAP_CLASS;

export const UI_STACK_CLASS = {
  tight: 'space-y-1', control: 'space-y-1.5', group: 'space-y-2', row: 'space-y-3',
  section: 'space-y-4', form: 'space-y-5', stack: 'space-y-6', region: 'space-y-8',
} as const;

/** 命令带和其从属带共享左右 12px，不能分别定留白。 */
export const UI_BAND_PADDING_CLASS = 'px-3';
/** 条带中的行控件居中：row 28、tab 32、header 36、title 40、command 44。 */
export const UI_BAND_HEIGHT_CLASS = {
  row: 'h-band-row', tab: 'h-band-tab', header: 'h-band-header', title: 'h-band-title', command: 'h-band-command',
} as const;
export const UI_BAND_MIN_HEIGHT_CLASS = {
  row: 'min-h-band-row', tab: 'min-h-band-tab', header: 'min-h-band-header', title: 'min-h-band-title', command: 'min-h-band-command',
} as const;
/** 表单行只设下限，长标签和多行输入可继续撑高；默认行对齐 md 控件。 */
export const UI_FORM_ROW_MIN_HEIGHT_CLASS: Record<UiControlSize, string> = {
  sm: 'min-h-control-sm', md: 'min-h-control-md', lg: 'min-h-control-lg',
};

/**
 * 属性面板（重要记录 019）：一行四列（`grid-cols-property-row`），行左右各留 4px 给悬停底的圆角，悬停只铺中性底。
 * 名称从 48px 处起笔；行以外的内容（按钮组、列表、说明）用 `UI_PROPERTY_INSET_CLASS` 对齐到名称列。
 * 默认藏着、悬停或聚焦本行才出现的东西（没开动画的秒表、关键帧导航、整块重置）用 `UI_PROPERTY_REVEAL_CLASS`。
 */
// 行悬停不铺底（重要记录 020）：行里的下拉、读数自己有底，整行再铺悬停底就和它们同色（nestedSameBackground）；悬停只用于露出秒表与关键帧导航。
export const UI_PROPERTY_ROW_CLASS = 'group/property mx-1 grid min-h-control-sm grid-cols-property-row items-center gap-x-1 rounded-control pr-2'
export const UI_PROPERTY_INSET_CLASS = 'pl-12 pr-3'
/** 属性面板读数框的宽度：成对读数（位置、锚点、缩放链条）放得进最窄的数值列；值更长时按内容撑宽。 */
export const UI_PROPERTY_NUMBER_WIDTH_CLASS = 'w-12'
export const UI_PROPERTY_REVEAL_CLASS = 'opacity-0 transition-opacity duration-120 focus-within:opacity-100 group-hover/property:opacity-100 group-focus-within/property:opacity-100'

/** 多行文本只约束最小编辑面积，rows 仍作为原生 DOM 属性。 */
export const UI_TEXT_AREA_HEIGHT_CLASS = {
  short: 'min-h-textarea-short', medium: 'min-h-textarea-medium', tall: 'min-h-textarea-tall',
} as const;
export type UiTextAreaHeight = keyof typeof UI_TEXT_AREA_HEIGHT_CLASS;

/** 分区之间的纵向间距 */
export const UI_STACK_GAP_CLASS = UI_STACK_CLASS.stack;

/** 分区内部行之间的纵向间距 */
export const UI_ROW_GAP_CLASS = UI_STACK_CLASS.row;

/**
 * 表单行之间的纵向间距。
 *
 * 单独一档的理由：`UI_ROW_GAP_CLASS`（12px）是给纯控件行用的，一旦行带上说明小字，
 * 12px 会让"上一行的说明"和"下一行的标签"粘在一起，读不出行的边界；
 * 而 `UI_STACK_GAP_CLASS`（24px）是分区级的距离，用在行之间会把一个分区拆散。
 * 设置面板的行全部用这一档，不要在调用点各写各的 `space-y-4/5/6`。
 */
export const UI_FORM_ROW_GAP_CLASS = UI_STACK_CLASS.form;

/** 唯一允许的分隔线写法：一条线，不是一个框 */
export const UI_DIVIDER_CLASS = 'border-t border-line/60';

/**
 * 分区堆叠间距：去掉分区卡片后，靠这个间距 + 组标签建立层级。
 * 比原先卡片时代的 space-y-5 更宽松，用留白换回呼吸感。
 * 若将来需要更强切分，只改这一处（加 `divide-y divide-line/60 [&>*+*]:pt-8`）。
 */
export const UI_SECTION_STACK_CLASS = UI_STACK_CLASS.region;
/** 相邻分组按同一 32px 分区档留白；比父级行间距优先，首组不增空白。 */
export const UI_GROUP_SIBLING_GAP_CLASS = '[&+[data-ui-group]]:mt-8';
/** Narrow docked panels (compact titles): the divider already separates groups, so siblings sit closer. */
export const UI_GROUP_SIBLING_GAP_COMPACT_CLASS = '[&+[data-ui-group]]:mt-3';

export const UI_PANEL_SURFACE_CLASS =
  'bg-panel border border-line text-text1 shadow-panel';

/**
 * 内嵌表面（五级容器词汇表的第 4 级 Surface）。
 *
 * 只用更暗的底色做层次，不画边框不画阴影——内层背景只能比外层更暗，不能更亮。
 * `<UiPanel variant="inset">` 就是它，元素类型不是 div（如 `<details>`/`<section>`）
 * 时可以直接消费这个类串，不要另写一套 `bg-hover`/`bg-raised` 的浅色底。
 */
export const UI_INSET_SURFACE_CLASS = 'bg-window/40 text-text1';

/**
 * 元信息徽标（类型/尺寸/时长/时间这类只读标签）。
 * 之前在 TaskCard 里同一串类名抄了 5 遍，收敛到这里；强调态用下面的 accent 变体。
 */
export const UI_META_BADGE_CLASS = 'bg-hover border border-line px-2 py-0.5 rounded-control';

export const UI_META_BADGE_ACCENT_CLASS =
  'bg-accent/10 border border-accent/40 text-accent-text px-2 py-0.5 rounded-control';

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
 * 中性实底控件在 `.ui-glass` 内随毛玻璃开关联动；类本身不添加 blur，
 * 也不影响普通不透明面板中的现有外观。
 */
export const UI_GLASS_ADAPTIVE_CONTROL_CLASS = 'ui-glass-adaptive-control';

/**
 * 字段表面（输入、文本域、原生选择、字段触发器、数值框）：设计稿“输入 / 浮层”档 `raised`，外加一道 `--edge`
 * 发丝内描边（`shadow-field`，重要记录 019）让边缘清楚；不用实线边框。聚焦见 `UI_FIELD_FOCUS_CLASS`。
 * 玻璃内由 `ui-glass-adaptive-control` 换成控件纱。
 */
export const UI_FIELD_SURFACE_CLASS = `bg-raised text-text1 shadow-field ${UI_GLASS_ADAPTIVE_CONTROL_CLASS}`;
/** 属性面板里的读数框（重要记录 019）：静息不铺底，悬停或聚焦才显出字段表面，一屏读数不各自成框。 */
export const UI_FIELD_SURFACE_QUIET_CLASS = 'bg-transparent text-text1 transition-colors duration-120 hover:bg-raised hover:shadow-field focus-within:bg-raised';

/**
 * 字段尺寸档位（重要记录 004）：高度 28/32/36，字号 12/13/13，圆角 sm 用控件档 6、md/lg 用输入档 8。
 * `UiInput`/`UiSelect`/`UiFieldTrigger`/`NumberInput` 的 `size` 共用这张表，调用点不再写高度与字号。
 */
export const UI_FIELD_SIZE_CLASS = {
  sm: `${UI_CONTROL_HEIGHT_CLASS.sm} text-xs ${UI_RADIUS_CLASS.control}`,
  md: `${UI_CONTROL_HEIGHT_CLASS.md} text-13 ${UI_RADIUS_CLASS.field}`,
  lg: `${UI_CONTROL_HEIGHT_CLASS.lg} text-13 ${UI_RADIUS_CLASS.field}`,
} as const;

export type UiFieldSize = UiControlSize;

/** 字段内边距（左右），与尺寸档对应；带图标/附件的字段由调用点用 pl-/pr- 预留位置。 */
export const UI_FIELD_PADDING_CLASS: Record<UiFieldSize, string> = {
  sm: 'px-2',
  md: 'px-3',
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

/**
 * 字段聚焦（重要记录 019）：一道 1px 内收的强调色细边，外加一圈淡强调光（`shadow-field-focus`）。
 * 细边内收，被滚动容器或 overflow-hidden 裁掉的只会是外圈淡光。
 */
export const UI_FIELD_FOCUS_CLASS =
  'outline-none focus:outline-none focus-visible:outline-none focus:ring-1 focus:ring-inset focus:ring-accent focus:shadow-field-focus transition-shadow duration-120';

/** 复合字段（数值框、带按钮的输入）把表面画在外壳上时使用，焦点由内部输入框传给整块控件。 */
export const UI_FIELD_FOCUS_WITHIN_CLASS =
  'outline-none focus-within:ring-1 focus-within:ring-inset focus-within:ring-accent focus-within:shadow-field-focus transition-shadow duration-120';

/** 占位文字：辅助文字档（保证 ≥ 4.5:1）。 */
export const UI_FIELD_PLACEHOLDER_CLASS = 'placeholder:text-text3';

/**
 * 禁用态：原生 `disabled` 与 `aria-disabled="true"` 同一外观。
 * 菜单项为保留可聚焦与原因说明会只写 `aria-disabled`（画布能力菜单），不能让调用点各自补 opacity（5.8，5.4-14）。
 */
export const UI_FIELD_DISABLED_CLASS = 'disabled:opacity-50 disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:cursor-not-allowed';

export const UI_BUTTON_RESET_CLASS =
  '!outline-none focus:!outline-none focus-visible:!outline-none !ring-0 focus:!ring-0 focus-visible:!ring-0 shadow-none focus:shadow-none';

/**
 * 下拉菜单与 PanelTrigger 的浮层表面。实底档在设置开启毛玻璃时由 index.css 自动换成玻璃（2026-10-22 用户确认），关闭时为 overlay 实底。
 *
 * - 默认实底：面板底 + 强分隔发丝线 + 浮层投影。浮层内的字段（raised）、选项格（raised）与悬停/选中底
 *   都比它亮，层次清楚；与“关闭毛玻璃”时玻璃浮层的退化外观一致。
 * - `UI_TRIGGER_PANEL_GLASS_CLASS`：只给压在画布、图片、视频、3D 视口上的浮层（`surface="glass"`）。
 *   一整块玻璃（深浅主题由主题引擎派生 glass 令牌，浅色下是浅底 + 深色纱），内部选项不各自模糊。
 * 圆角取输入与菜单档 8；内容裁到圆角内。
 */
/**
 * 实底浮层（菜单、下拉、弹出面板、右键菜单、日期选择）：底色用浮层令牌 overlay，比所在面板抬一级，
 * 加强分隔描边与浮层阴影，压在任何面板上都分得出上下两层；里面的菜单项悬停改用 overlay-hover（见 index.css）。
 */
export const UI_TRIGGER_PANEL_CLASS =
  `ui-overlay-surface bg-overlay border border-line-strong shadow-panel overflow-hidden ${UI_RADIUS_CLASS.field} text-text1`;

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

/** 浮层上下内边距与描边合计（px），与上面的档位一一对应：算浮层里内容实际能用的高度 */
export const UI_TRIGGER_PANEL_CHROME_Y_PX: Record<UiTriggerPanelPadding, number> = { none: 2, menu: 10, content: 26 };

/** 锚定浮层按内容选档；定位器进一步收紧到宿主边界和可用高度。 */
export const UI_TRIGGER_PANEL_SIZE_CLASS = {
  // 宽度上限写成 --trigger-panel-max-width：浮层的内联 max-width 还要按窗口与边界夹取，取两者较小值
  //（直接写 max-w 类会被内联样式盖掉，按内容定宽的长说明会把菜单撑到整个窗口宽）。
  // 菜单按选项内容定宽（至少 8rem，上限 22.5rem 再截断），不随窗口宽度变宽
  menu: 'w-max min-w-32 [--trigger-panel-max-width:22.5rem] [--trigger-panel-max-height:min(60vh,24rem)]',
  // 以下三档都按内容定宽（重要记录 021）：档位只给下限与上限，不随窗口宽度按百分比变；上限再不超过窗口宽减 32。
  // 内容没有固有宽度（w-full、minmax(0,1fr) 网格）时取下限；截断的长文字会撑到上限，需要更窄就给内容声明宽度。
  compact: 'w-max min-w-[min(calc(100vw-2rem),18rem)] [--trigger-panel-max-width:24rem] [--trigger-panel-max-height:min(70vh,32rem)]',
  // 宽面板（420–720）：只给预设列表、生成表单这类自带多列内容的浮层；参数表单一律用 compact。
  wide: 'w-max min-w-[min(calc(100vw-2rem),26.25rem)] [--trigger-panel-max-width:45rem] [--trigger-panel-max-height:min(78vh,40rem)]',
  workspace: 'w-max min-w-[min(calc(100vw-2rem),40rem)] [--trigger-panel-max-width:60rem] [--trigger-panel-max-height:min(88vh,52rem)]',
  // 特殊面板（重要记录 021）：宽度量里面最宽的内容，夹在 240–760、不超过窗口宽减 32；高度上限 440。
  // 正文用 UiSpecialPanel，虚拟列表与网格这类没有固有宽度的正文由它的 bodyWidth 给出宽度。
  special: 'w-max min-w-60 [--trigger-panel-max-width:47.5rem] [--trigger-panel-max-height:min(calc(100vh-6rem),27.5rem)]',
} as const;
export type UiTriggerPanelSize = keyof typeof UI_TRIGGER_PANEL_SIZE_CLASS;

/** 特殊面板的宽高预算（px），与 UI_TRIGGER_PANEL_SIZE_CLASS.special 一致；网格据此算能放几列。 */
export const UI_SPECIAL_PANEL_BUDGET = { minWidth: 240, maxWidth: 760, viewportGutter: 16, maxHeight: 440 } as const;

/**
 * 特殊面板的高度档：fit 按内容、不超过上限；fill 直接占满上限，长列表搜索或筛选时面板不跳动。
 * 上限同时封顶到浮层实际能给的高度（--ui-panel-body-max-height），窗口矮时不压住输入框。
 */
export const UI_SPECIAL_PANEL_HEIGHT_CLASS = {
  fit: 'max-h-[min(27.5rem,var(--ui-panel-body-max-height,100vh))]',
  fill: 'h-[min(27.5rem,var(--ui-panel-body-max-height,100vh))]',
} as const;

/** 可拖动面板的宽度预算（px）；宿主仍须按当前工作区可用宽度夹取。 */
export { UI_PANEL_WIDTH } from '@/core/theme/panelSizes';

/** 弹窗内容区留白与滚动分开决策，迁移调用点时使用有限枚举。 */
export const UI_MODAL_CONTENT_PADDING_CLASS = { default: 'p-4', none: 'p-0', spacious: 'px-6 py-5' } as const;
export const UI_MODAL_CONTENT_SCROLL_CLASS = { auto: 'overflow-y-auto', none: 'overflow-hidden' } as const;

/** 描边选项（`UiOptionButton` 默认变体）的静息态：纯文字 chip 组靠一圈发丝线保留点击可供性。 */
export const UI_OPTION_ITEM_CLASS =
  'rounded-lg border border-line-strong text-text1 transition-colors';

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
 * 单选选中底（菜单、网格、主题预设格、下拉当前项、列表行；分段与双段开关用 UI_SEGMENT_SELECTED_CLASS）：中性选中底
 * `--selected`（选中项悬停再抬一档），玻璃里换成 `--ui-glass-selected`。重要记录 019 修订 012：强调色不再铺在选中底上。
 */
export const UI_GLASS_ADAPTIVE_SELECTED_CLASS = 'ui-glass-adaptive-selected';

/** 选项格（`UiOptionButton variant="tile" | "grid"`）的静息底：普通面板上是 `raised`，玻璃里是控件纱。 */
export const UI_GLASS_ADAPTIVE_TILE_CLASS = 'ui-glass-adaptive-tile';

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
export const UI_LIGHTING_RANGE_CLASS = `rounded-full focus-visible:ring-2 focus-visible:ring-accent-text
  [&::-webkit-slider-runnable-track]:!h-2.5 [&::-moz-range-track]:!h-2.5
  [&::-webkit-slider-runnable-track]:[background:var(--lighting-track)] [&::-moz-range-track]:[background:var(--lighting-track)]
  [&::-webkit-slider-thumb]:!mt-[-3px] [&::-webkit-slider-thumb]:!h-4 [&::-webkit-slider-thumb]:!w-7
  [&::-moz-range-thumb]:!h-4 [&::-moz-range-thumb]:!w-7
  [&::-webkit-slider-thumb]:!bg-[var(--lighting-color)] [&::-moz-range-thumb]:!bg-[var(--lighting-color)]
  [&::-webkit-slider-thumb]:!border-2 [&::-webkit-slider-thumb]:!border-solid [&::-webkit-slider-thumb]:!border-on-media
  [&::-moz-range-thumb]:!border-2 [&::-moz-range-thumb]:!border-solid [&::-moz-range-thumb]:!border-on-media
  [&::-webkit-slider-thumb]:shadow-thumb-ring [&::-moz-range-thumb]:shadow-thumb-ring`

/** Parameter editing graphics: semantic chrome, registered content-color spectra. */
export const UI_PARAMETER_SURFACE_CLASS = 'relative w-full touch-none select-none rounded-control bg-control outline-none focus-visible:ring-2 focus-visible:ring-accent-ring aria-disabled:opacity-50'
export const UI_PARAMETER_HANDLE_CLASS = 'fill-text1 stroke-control focus-visible:stroke-accent'
export const UI_PARAMETER_HANDLE_RADIUS: Record<UiControlSize, number> = { sm: 3, md: 4, lg: 4 }
export const UI_PARAMETER_TRACK_BACKGROUND = {
  none: 'var(--control)',
  hue: 'linear-gradient(90deg, hsl(0 100% 50%), hsl(60 100% 50%), hsl(120 100% 50%), hsl(180 100% 50%), hsl(240 100% 50%), hsl(300 100% 50%), hsl(360 100% 50%))',
  luminance: `linear-gradient(90deg, ${BLACK_HEX}, ${WHITE_HEX})`,
  saturation: 'linear-gradient(90deg, hsl(0 0% 50%), hsl(0 100% 50%))',
} as const
export const UI_GRADE_WHEEL_BACKGROUND = 'radial-gradient(circle, rgb(var(--on-media-rgb)), transparent), conic-gradient(from 90deg, hsl(0 100% 50%), hsl(60 100% 50%), hsl(120 100% 50%), hsl(180 100% 50%), hsl(240 100% 50%), hsl(300 100% 50%), hsl(360 100% 50%))'
export const UI_GRADE_LUMINANCE_BACKGROUND = `linear-gradient(0deg, ${BLACK_HEX}, ${WHITE_HEX})`
export const UI_CURVE_CHANNEL_COLOR = { master: 'var(--text1)', red: SOCKET_TYPE_COLOR_HEX.VIDEO, green: SOCKET_TYPE_COLOR_HEX.STRING, blue: SOCKET_TYPE_COLOR_HEX.NUMBER } as const
/** Color scopes draw on a canvas: channel colors reuse the curve channels; neutral/grid name theme variables resolved at draw time. */
export const UI_SCOPE_COLORS = { red: UI_CURVE_CHANNEL_COLOR.red, green: UI_CURVE_CHANNEL_COLOR.green, blue: UI_CURVE_CHANNEL_COLOR.blue, neutralVariable: '--on-media', gridVariable: '--media-line' } as const
/** User RGBA is content, not UI chrome; all color formatting stays at the token boundary. */
export function uiParameterRgba(color: readonly number[]): string {
  return `rgb(${color.slice(0, 3).map(channel => Math.round(Math.max(0, Math.min(1, channel)) * 255)).join(' ')} / ${Math.max(0, Math.min(1, color[3] ?? 1))})`
}
export function uiParameterHex(color: readonly number[]): string {
  return `#${color.slice(0, 3).map(channel => Math.round(Math.max(0, Math.min(1, channel)) * 255).toString(16).padStart(2, '0')).join('')}`
}

/** 分段选中：中性抬起底 + 强文字，与其他单选的淡强调底区分。 */
export const UI_SEGMENT_SELECTED_CLASS = 'bg-segment-selected text-text1';

/**
 * 面板正文占用可用视口的高度；宽度由宿主 panelSize 决定。
 * workspace 取 70vh：从底栏向上弹出时可用高度约为窗口的 75–80%，78vh 会超出浮层上限，
 * 浮层外层与面板自己的滚动区叠成两层滚动（音色克隆面板，重要记录 020）。
 */
/**
 * 定高的面板正文。放在 PanelTrigger 浮层里时再封顶到浮层实际能给的高度（`--ui-panel-body-max-height`，
 * 由 PanelTrigger 按可用空间与档位上限算出）：窗口矮时（960×640）正文比浮层高，浮层外壳与正文自己的滚动区
 * 叠成两层滚动（重要记录 020）。不在浮层里时变量不存在，按原值。
 */
export const UI_PANEL_BODY_HEIGHT_CLASS = {
  compact: 'h-[min(50vh,20rem,var(--ui-panel-body-max-height,100vh))]',
  content: 'h-[min(65vh,30rem,var(--ui-panel-body-max-height,100vh))]',
  workspace: 'h-[min(70vh,48rem,var(--ui-panel-body-max-height,100vh))]',
} as const;

export const UI_INPUT_PANEL_MAX_HEIGHT_CLASS = 'max-h-[min(70vh,40rem)]';
