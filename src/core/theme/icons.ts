import {
  AppWindow,
  AudioLines,
  AudioWaveform,
  Blend,
  CheckSquare,
  Clapperboard,
  Code2,
  FileAudio,
  FileText,
  FileVideo,
  Film,
  Gauge,
  Grid2x2,
  Hash,
  Image as ImageIcon,
  ImagePlus,
  ImageUp,
  Images,
  LayoutGrid,
  Layers3,
  Library,
  ListChecks,
  MessageCircle,
  Music,
  MonitorDot,
  Orbit,
  ScanSearch,
  Shapes,
  SlidersHorizontal,
  Sigma,
  Settings,
  SquarePen,
  Star,
  SunMedium,
  ToggleLeft,
  Type,
  Upload,
  Video,
  WandSparkles,
  Wrench,
  createLucideIcon,
  type IconNode,
  type LucideIcon,
} from 'lucide-react'

/**
 * 图标语义登记表。
 *
 * 图标和颜色、字号、动效一样是**视觉令牌**：同一个业务概念在全应用只能有一个图形。
 * 此前没有这层登记，结果是「资产库」在顶部导航是手写的归档盒、在工具栏是 `LibraryBig`、
 * 在侧栏是 `Library`，三处三样；「工具箱」和「设置」还共用了同一个齿轮。
 *
 * 规则：
 * - **跨界面复用的业务概念**（工作区、资产库、媒体类型、设置…）必须引用这里的常量，
 *   不要在业务组件里各自从 lucide 挑图形。改一个概念的图标只改这里一行。
 * - **通用动作图标**（关闭、新增、删除、复制、播放…）直接 `import { X, Plus } from 'lucide-react'`
 *   即可：lucide 的名字本身就是单一真源，再包一层别名只是徒增间接。
 * - 任何情况下都**不要手写 `<svg>`**。真正的图形（波形、缓动曲线、连线预览）不是图标，
 *   不受此表约束，见 `scripts/check-icon-tokens.cjs` 的豁免名单。
 */

/* 工作区与顶层导航 --------------------------------------------------------- */

/** 生成（对话式生成工作区） */
export const ICON_WORKSPACE_GENERATE: LucideIcon = MessageCircle
/** 画布（节点式工作区） */
export const ICON_WORKSPACE_CANVAS: LucideIcon = LayoutGrid
export const ICON_WORKSPACE_VIDEO_EDIT: LucideIcon = Clapperboard
/** 工具箱。刻意不用齿轮：齿轮是「设置」的图形，两者同屏出现过一次撞车。 */
export const ICON_WORKSPACE_TOOLBOX: LucideIcon = Wrench
/** 资产库（顶部入口、加入资产库动作、资产库侧栏共用） */
export const ICON_ASSET_LIBRARY: LucideIcon = Library
export const ICON_ASSET_CODE: LucideIcon = Code2
/** 应用设置 */
export const ICON_SETTINGS: LucideIcon = Settings

/* 工具箱内的各工具 --------------------------------------------------------- */

/** 图片编辑 */
export const ICON_TOOL_IMAGE_EDIT: LucideIcon = SquarePen
/** 3D 镜头参考 */
export const ICON_TOOL_CAMERA_STAGE: LucideIcon = Clapperboard
/** 口播剪辑 */
export const ICON_TOOL_AUDIO_EDIT: LucideIcon = AudioWaveform
/** 屏幕录制与录制会话。 */
export const ICON_TOOL_SCREEN_RECORDING: LucideIcon = MonitorDot
/** 网页应用录制（`.hjweb`）。 */
export const ICON_TOOL_WEB_RECORDING: LucideIcon = AppWindow
/** 图片编辑中的多级 GPU 辉光。 */
export const ICON_IMAGE_GLOW_PRO: LucideIcon = SunMedium

/* 媒体类型 ----------------------------------------------------------------- */

export const ICON_MEDIA_IMAGE: LucideIcon = ImageIcon
export const ICON_MEDIA_VIDEO: LucideIcon = Video
export const ICON_MEDIA_AUDIO: LucideIcon = Music
/** 剪辑中的结构化原生图形。 */
export const ICON_VIDEO_EDIT_GRAPHIC: LucideIcon = Shapes
/** 处理下方画面范围的调整图层。 */
export const ICON_VIDEO_EDIT_ADJUSTMENT: LucideIcon = SlidersHorizontal
/** 剪辑过渡（时间线上的过渡块、效果面板的过渡预设）。 */
export const ICON_VIDEO_EDIT_TRANSITION: LucideIcon = Blend
/** 剪辑代理：两个监视器的切换按钮与素材创建入口共用。 */
export const ICON_VIDEO_EDIT_PROXY: LucideIcon = Gauge
/**
 * 效果控件里每节前的效果开关（对齐 AE 的 fx，重要记录 019）：开着是 fx，关掉是同一个 fx 加一道斜杠。
 * lucide 没有这个字形，按 lucide 的 24 网格与线宽自绘。
 */
const FX_GLYPH: IconNode = [
  ['path', { d: 'M5 21c2 0 2.8-1.5 3.3-4.2l1.8-10C10.6 4.2 11.6 3 13.8 3', key: 'f' }],
  ['path', { d: 'M5 10h8', key: 'bar' }],
  ['path', { d: 'M13 13l7 8M20 13l-7 8', key: 'x' }],
]
export const ICON_EFFECT_ENABLED: LucideIcon = createLucideIcon('effect-enabled', [...FX_GLYPH])
export const ICON_EFFECT_DISABLED: LucideIcon = createLucideIcon('effect-disabled', [...FX_GLYPH, ['path', { d: 'M3 21L21 3', key: 'slash' }]])

/* 其他跨界面概念 ----------------------------------------------------------- */

/** 预设 */
export const ICON_PRESET: LucideIcon = Star
/** 任务 / 生成队列 */
export const ICON_TASK: LucideIcon = ListChecks
/** 分镜（分镜节点、分镜切分结果） */
export const ICON_STORYBOARD: LucideIcon = Grid2x2
/** 多选（工程列表等卡片网格的批量选择入口） */
export const ICON_MULTI_SELECT: LucideIcon = CheckSquare

/* 画布节点概念 ------------------------------------------------------------- */

export const ICON_NODE_UPLOAD: LucideIcon = Upload
export const ICON_NODE_IMAGE_UPLOAD: LucideIcon = ImageUp
export const ICON_NODE_VIDEO_UPLOAD: LucideIcon = FileVideo
export const ICON_NODE_AUDIO_UPLOAD: LucideIcon = FileAudio
export const ICON_NODE_IMAGE_GENERATION: LucideIcon = ImagePlus
export const ICON_NODE_VIDEO_GENERATION: LucideIcon = Film
export const ICON_NODE_AUDIO_GENERATION: LucideIcon = AudioLines
export const ICON_NODE_STORYBOARD: LucideIcon = Grid2x2
export const ICON_NODE_TEXT_PROCESSING: LucideIcon = WandSparkles
export const ICON_NODE_TEXT_ANNOTATION: LucideIcon = FileText
export const ICON_NODE_CAMERA_STAGE: LucideIcon = Clapperboard
export const ICON_NODE_IMAGE_MODEL: LucideIcon = Images
export const ICON_NODE_VIDEO_MODEL: LucideIcon = Video
export const ICON_NODE_AUDIO_MODEL: LucideIcon = Music
export const ICON_NODE_INTEGER: LucideIcon = Hash
export const ICON_NODE_FLOAT: LucideIcon = Sigma
export const ICON_NODE_TEXT: LucideIcon = Type
export const ICON_NODE_BOOLEAN: LucideIcon = ToggleLeft
/** 素材组 / 参考素材包 */
export const ICON_NODE_ASSET_GROUP: LucideIcon = Layers3
/** 完整球面全景（工具入口、结果标识与查看模式共用） */
export const ICON_PANORAMA: LucideIcon = Orbit
/** 忠实高清放大（能力工具条与节点共用） */
export const ICON_UPSCALE: LucideIcon = ScanSearch

/** 界面图标：普通尺寸 12/14/16/20/24，状态插图 32/40；描边沿用 lucide 默认 2。 */
export const UI_ICON_SIZE = { xs: 12, sm: 14, md: 16, lg: 20, xl: 24, display: 32, hero: 40 } as const
export const UI_ICON_STROKE_WIDTH = 2
/** 标题栏交通灯：系统窗口惯例的唯一紧凑图标例外。 */
export const UI_WINDOW_ICON_SIZE = 8
export const UI_WINDOW_ICON_STROKE_WIDTH = 1.5
