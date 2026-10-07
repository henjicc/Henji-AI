import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  Ref,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react'

import type { ScopedTextHistoryBinding } from './useScopedTextHistory'
import {
  UI_CONTROL_HEIGHT_CLASS,
  UI_INSET_SURFACE_CLASS,
  UI_LIGHTING_RANGE_CLASS,
  UI_PANEL_SURFACE_CLASS,
  UI_RADIUS_CLASS,
} from './styleTokens'

/**
 * 按钮档位（重要记录 003 / 010）。视觉重量 = 动作的重要性：
 * - `primary`：材质主按钮，**一个表面最多一个**；
 * - `secondary`：无边框填充，弹窗与表单里的普通动作；
 * - `quiet`（默认）：静息无底、悬停出底，工具栏与行内动作；
 * - `danger`：静息同 quiet、悬停显红，删除/清空等破坏性动作；
 * - `dangerSolid`：只用于确认弹窗里的破坏性确认；
 * - `link`：行内跳转/说明链接（强调文字、悬停下划线、行内高度），不计入动作层级；
 * - `media`：压在图片/视频/画布画面上的文字按钮（媒体叠层固定令牌，不随主题）。
 */
export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger' | 'dangerSolid' | 'link' | 'media'

/** 控件高度 sm 28 / md 32（默认）/ lg 36（重要记录 004）。`link` 跟随行内文字，不受尺寸影响。 */
export type ButtonSize = 'sm' | 'md' | 'lg'

/**
 * 外观只由 `variant` / `size` 决定。`className` 只用于布局（宽度、弹性、对齐、定位、间距、显隐），
 * 不得改底色、边框、文字色、圆角、阴影、高度或字号——check:surface 规则 E 会拦截。
 */
export interface UiButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
}

/** 图标按钮尺寸：xs 20 / sm 24 / md 28（默认）/ lg 32 / xl 40（仅全屏查看器、画面中央播放键等大目标）。 */
export type IconButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl'

/**
 * - `default`：静默，静息无底、悬停出底（工具栏、行内）；
 * - `media`：压在图片/视频/画布画面上（半透明深底 + 白色图标，不随主题）；
 * - `accent`：圆形材质主动作（如生成），一个表面最多一个；
 * - `danger`：静息静默、悬停显红（删除、移除）。
 * - `bare`：始终无底无边框，开关与悬停只改变图标颜色。
 */
export type IconButtonTone = 'default' | 'media' | 'accent' | 'danger' | 'bare'

export interface UiIconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 开关开启（选中底 + 强调色图标），同时写出 `aria-pressed`。只表达“功能是否开启”，不是动作层级。 */
  on?: boolean
  tone?: IconButtonTone
  size?: IconButtonSize
  /** 圆形外框；`tone="accent"` 恒为圆形。 */
  shape?: 'square' | 'circle'
}

/** 选项、标签、导航、字段共用的高度档：sm 28 / md 32 / lg 36（重要记录 004）。 */
export type UiControlSize = 'sm' | 'md' | 'lg'

export interface UiChipButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean
  /** `navigation` 表示“正在看哪里”；默认 `toggle` 表示多选/标签开态。 */
  selectionRole?: 'toggle' | 'navigation'
  /**
   * 只对 `selectionRole="navigation"` 生效：
   * - `subtle`：面板标签（设计稿面板头，选中只换主要文字 + 底部细线）；
   * - `workspace`：应用标题栏的工作区导航（设计稿 TitleBar：28 高、13/500、纯文字；选中 = 中性选中底 +
   *   主要文字 + 底部短指示条），尺寸固定，`size` 不参与。
   */
  selectionAppearance?: 'default' | 'subtle' | 'workspace'
  /**
   * 只对 `selectionAppearance="workspace"` 生效：同一条工作区导航里“打开浮层而不切换工作区”的开关项
   * （资产浮动面板）。开启 = 中性选中底 + 主要文字，不带当前页指示条，并写 `aria-pressed`；
   * `aria-current` 仍只属于当前工作区（`active`）。
   */
  on?: boolean
  /** 高度档，默认 md 32（字号 sm 12 / md、lg 13）。外观只由 active / selectionRole / size 决定。 */
  size?: UiControlSize
}

/**
 * 文字记号（逐字稿词块、时间轴字幕块）。它不是动作按钮也不是选项，而是“可点的文字”：
 * 单击定位/选中、双击编辑、右键删除，状态由内容决定（界面重设计 3.4，设计稿 ToolAudioEdit）。
 * - `inline`：行内词块，继承段落字号与行高，静息无底；
 * - `chip`：时间轴上的字幕块，高度填满所在泳道、11 号字，静息铺 raised。
 */
export type UiTextTokenAppearance = 'inline' | 'chip'

export interface UiTextTokenProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  appearance?: UiTextTokenAppearance
  /** 当前播放位置所在的词（中性选中底）。 */
  current?: boolean
  /** 已选中（多选集合：强调浅底 + 强调描边环）。 */
  selected?: boolean
  /** 已删除、不进入成片（划线 + 危险浅底）。 */
  excluded?: boolean
  /** 待留意的标记（如语气词）：警示色点状下划线；与 `excluded` 同时出现时以删除为准。 */
  flagged?: boolean
}

/** 窗口控件动作：`maximize` 与 `restore` 由调用点按窗口当前是否最大化选择。 */
export type UiWindowControlAction = 'minimize' | 'maximize' | 'restore' | 'close'

/**
 * 无边框窗口的窗口控件（应用标题栏、日志窗口标题栏共用）。图标由组件按 `action` 决定，名称放 `title`/`aria-label`。
 * - `windows`：36×28 静默按钮，静息辅助文字、悬停出底；关闭悬停为危险实底（系统惯例）；
 * - `mac`：12px 交通灯圆点（危险/警示/成功实底令牌），悬停整组时显出符号，命中区 24px。
 */
export interface UiWindowControlProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  action: UiWindowControlAction
  platform?: 'windows' | 'mac'
}

export interface UiNavButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean
  /** 高度档：md 32 / lg 36（默认）；`auto` 用于两行内容的导航行（高度随内容）。 */
  size?: 'md' | 'lg' | 'auto'
}

/** 字段触发器（下拉、面板触发器的按钮）。`field` 是 raised 字段表面；`quiet` 是标题栏/工具栏里的弱化入口。 */
export interface UiFieldTriggerProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: UiControlSize
  appearance?: 'field' | 'quiet'
  /** 浮层是否展开（箭头翻转）。 */
  open?: boolean
}

export interface UiCheckboxProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  checked: boolean
  onCheckedChange?: (checked: boolean) => void
}

type UiSwitchBaseProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> & {
  checked: boolean
  onCheckedChange?: (checked: boolean) => void
}

export type UiSwitchProps = UiSwitchBaseProps & (
  | {
      appearance?: 'pill'
      offLabel?: never
      onLabel?: never
      size?: never
    }
  | {
      appearance: 'segmented'
      offLabel: ReactNode
      onLabel: ReactNode
      size?: 'field' | 'compact'
    }
)

export interface UiSelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  /** 高度档，默认 md 32。 */
  size?: UiControlSize
}

export interface UiOptionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean
  /**
   * `menu`：静息态完全透明，只靠 hover 与选中态表达状态。
   *
   * 用于同质选项的集合；孤立按钮不适用。
   *
   * 以下三档选中都是中性抬升（重要记录 003：单选不用强调色实底），尺寸由变体决定：
   * - `segment`：分段选择的一段（28 高、居中）；放在 `UI_SEGMENTED_TRACK_CLASS` 轨道里；
   * - `tile`：带小样的选项格（44 高，静息有底），如主题预设；
   * - `swatch`：圆形色样（32 外框），颜色由调用点经 `style.backgroundColor`/`backgroundImage` 传入（不要用 `background` 简写，
   *   它会重置 `background-clip`），选中为外圈一环。
   * - `grid`：二维选项网格的格子（比例、分辨率、音色、模型卡）：静息铺一层 raised 撑出格子、不描边，选中中性抬升。
   * - `cover`：封面内容卡（画布项目、3D 工程）：按钮本身无底无框，纵向排列“封面 + 文字”；悬停、键盘焦点与
   *   选中（`active`）只画在子元素 `UI_COVER_FRAME_CLASS` 封面框上（悬停发丝线、焦点环、选中强调描边，界面重设计 3.3）。
   */
  variant?: 'default' | 'card' | 'flat' | 'menu' | 'grid' | 'segment' | 'tile' | 'swatch' | 'cover'
  /**
   * 高度与字号档（default / card / flat / menu / grid）：不传时高度随内容（上下 8px 内边距，字号 13）；
   * sm / md / lg 是最小高度 28 / 32 / 36（字号 12 / 13 / 13），多行内容仍可撑高。segment / tile / swatch 尺寸固定。
   */
  size?: UiControlSize
  /**
   * `grid` 变体的固定格子尺寸（宽 × 高）：同一面板里的格子必须等大才能排成网格，高度不随内容。
   * - `ratio`：画面比例格 78 × 92（32 高的比例小样 + 名称）；
   * - `tier`：档位 / 分辨率格 78 × 42（单行）；`tier-detail`：带说明的档位格 78 × 52；
   * - `preset`：预设分辨率格 120 宽、至少 52 高（名称 + 比例）。
   */
  gridCell?: 'ratio' | 'tier' | 'tier-detail' | 'preset'
  /** 选中语义：默认 `single`（单选，中性抬升）；`multiple` 表示多选集合中已选（强调描边 + 强调文字）。 */
  selection?: 'single' | 'multiple'
  /** 键盘导航当前项（下拉 aria-activedescendant、模型网格方向键指向的项），未选中时显示悬停底。 */
  highlighted?: boolean
}

export interface UiInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  textHistory?: ScopedTextHistoryBinding
  /** 高度档，默认 md 32（字号 sm 12 / md、lg 13）。 */
  size?: UiControlSize
  /**
   * `field`（默认）：raised 字段表面 + 焦点环。
   * `inner`：复合字段（数值框、带按钮的输入）的内层文字框——表面与焦点环由外壳画（UI_FIELD_FOCUS_WITHIN_CLASS），自己透明不画环。
   */
  frame?: 'field' | 'inner'
}

/**
 * 搜索框（任务 5.8，B-35）：前置放大镜 + 可选清除按钮，全仓搜索框只此一种写法。
 * `className` 落在外层（只放宽度、伸缩等布局）；图标尺寸与内边距随 `size`。
 */
export interface UiSearchInputProps extends Omit<UiInputProps, 'type'> {
  /** 传入时，有内容时在右端显示清除按钮 */
  onClear?: () => void
  /** 清除按钮的名称（传了 onClear 时必填） */
  clearLabel?: string
  /** 放大镜图标的引用（筛选面板把它当作展开动画的锚点） */
  iconRef?: Ref<SVGSVGElement>
}

export interface UiTextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  textHistory?: ScopedTextHistoryBinding
  /**
   * `field`（默认）：raised 字段表面 + 焦点环。
   * `none`：无框，直接落在所在表面上编辑（画布文本展示节点的编辑态，与静态正文同字号行高，对齐 `PromptEditor frame="none"`）。
   */
  frame?: 'field' | 'none'
}

export type UiPanelVariant = 'panel' | 'inset' | 'bare' | 'glass'

export interface UiPanelProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * `panel` 用于最外层独立表面；内部分组使用 `inset` 或 `bare`。
   * `glass` 只用于压在图片、视频或画布上的浮层。
   */
  variant?: UiPanelVariant
}

/** 轨道底色。`hue` 铺满色相光谱，供色相选择使用。 */
export type UiRangeTrackTone = 'neutral' | 'hue' | 'lighting'

export interface UiRangeInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  trackTone?: UiRangeTrackTone
}

export function resolveTextHistoryValue(value: string | number | readonly string[] | undefined): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}

/** 各档的皮肤类（定义在 index.css `.ui-btn-*`，颜色全部走主题令牌）。 */
export const UI_BUTTON_VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'ui-btn-primary',
  secondary: 'ui-btn-secondary',
  quiet: 'ui-btn-quiet',
  danger: 'ui-btn-danger',
  dangerSolid: 'ui-btn-danger-solid',
  link: 'ui-btn-link',
  media: 'ui-btn-media',
}

/** 高度 / 字号 / 圆角 / 间距。静默档（quiet、danger）左右内边距少 2px，与设计稿一致。 */
// 按钮是固定高度的一行控件：文字不换行（任务 5.3：“上传 PDF”在流式浮层里被挤成两行，溢出按钮框）。
// 此前个别调用点自己补 whitespace-nowrap，统一收进尺寸档。
const UI_BUTTON_SIZE_CLASS: Record<ButtonSize, { box: string; padding: string; quietPadding: string }> = {
  sm: { box: `${UI_CONTROL_HEIGHT_CLASS.sm} gap-1.5 whitespace-nowrap text-xs ${UI_RADIUS_CLASS.control}`, padding: 'px-2.5', quietPadding: 'px-2' },
  md: { box: `${UI_CONTROL_HEIGHT_CLASS.md} gap-1.5 whitespace-nowrap text-13 ${UI_RADIUS_CLASS.control}`, padding: 'px-3', quietPadding: 'px-2.5' },
  lg: { box: `${UI_CONTROL_HEIGHT_CLASS.lg} gap-2 whitespace-nowrap text-sm ${UI_RADIUS_CLASS.field}`, padding: 'px-4', quietPadding: 'px-3.5' },
}

export function resolveButtonVariant(variant: ButtonVariant): string {
  return UI_BUTTON_VARIANT_CLASS[variant]
}

export function resolveButtonSize(size: ButtonSize, variant: ButtonVariant = 'quiet'): string {
  if (variant === 'link') {
    // 行内链接：跟随所在文字的字号与行高，只保留一点圆角给键盘焦点环。
    return 'gap-1 rounded-sm'
  }
  const entry = UI_BUTTON_SIZE_CLASS[size]
  const padding = variant === 'quiet' || variant === 'danger' ? entry.quietPadding : entry.padding
  return `${entry.box} ${padding}`
}

const UI_ICON_BUTTON_SIZE_CLASS: Record<IconButtonSize, { box: string; radius: string }> = {
  xs: { box: 'h-5 w-5', radius: 'rounded' },
  sm: { box: 'h-6 w-6', radius: UI_RADIUS_CLASS.control },
  md: { box: `${UI_CONTROL_HEIGHT_CLASS.sm} w-7`, radius: UI_RADIUS_CLASS.control },
  lg: { box: `${UI_CONTROL_HEIGHT_CLASS.md} w-8`, radius: UI_RADIUS_CLASS.field },
  xl: { box: 'h-10 w-10', radius: UI_RADIUS_CLASS.field },
}

export function resolveIconButtonClass({
  tone,
  size,
  shape,
  on,
}: {
  tone: IconButtonTone
  size: IconButtonSize
  shape: 'square' | 'circle'
  on: boolean
}): string {
  const entry = UI_ICON_BUTTON_SIZE_CLASS[size]
  const radius = tone === 'accent' || shape === 'circle' ? 'rounded-full' : entry.radius
  const skin = tone === 'bare'
    ? `border-0 bg-transparent disabled:opacity-50 ${on ? 'text-accent-text hover:text-text1' : 'text-text2 hover:text-text1'}`
    : tone === 'accent'
    ? UI_BUTTON_VARIANT_CLASS.primary
    : tone === 'media'
      ? `${UI_BUTTON_VARIANT_CLASS.media}${on ? ' ui-btn-media-on' : ''}`
      : on
        ? 'ui-btn-on'
        : tone === 'danger'
          ? UI_BUTTON_VARIANT_CLASS.danger
          : UI_BUTTON_VARIANT_CLASS.quiet
  return `${entry.box} ${radius} ${skin}`
}

export function resolveUiPanelSurface(variant: UiPanelVariant): string {
  if (variant === 'inset') {
    return `rounded-lg ${UI_INSET_SURFACE_CLASS}`
  }
  if (variant === 'bare') {
    return 'rounded-lg'
  }
  if (variant === 'glass') {
    return 'ui-glass ui-glass-elevated rounded-xl'
  }
  return `rounded-xl ${UI_PANEL_SURFACE_CLASS}`
}

// 两种轨道底色必须互斥，避免 Tailwind 产物顺序造成静默覆盖。
export const UI_RANGE_TRACK_TONE_CLASS: Record<UiRangeTrackTone, string> = {
  neutral: '[&::-webkit-slider-runnable-track]:bg-control-pressed [&::-moz-range-track]:bg-control-pressed',
  hue: 'ui-range-track-hue',
  lighting: UI_LIGHTING_RANGE_CLASS,
}
