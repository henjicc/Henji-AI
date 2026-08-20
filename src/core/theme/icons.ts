import {
  AudioLines,
  CheckSquare,
  Clapperboard,
  FileAudio,
  FileText,
  FileVideo,
  Film,
  Grid2x2,
  Hash,
  Image as ImageIcon,
  ImagePlus,
  ImageUp,
  Images,
  LayoutGrid,
  Library,
  ListChecks,
  MessageCircle,
  Music,
  Sigma,
  Settings,
  SquarePen,
  Star,
  ToggleLeft,
  Type,
  Upload,
  Video,
  WandSparkles,
  Wrench,
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
/** 工具箱。刻意不用齿轮：齿轮是「设置」的图形，两者同屏出现过一次撞车。 */
export const ICON_WORKSPACE_TOOLBOX: LucideIcon = Wrench
/** 资产库（顶部入口、加入资产库动作、资产库侧栏共用） */
export const ICON_ASSET_LIBRARY: LucideIcon = Library
/** 应用设置 */
export const ICON_SETTINGS: LucideIcon = Settings

/* 工具箱内的各工具 --------------------------------------------------------- */

/** 图片编辑 */
export const ICON_TOOL_IMAGE_EDIT: LucideIcon = SquarePen
/** 3D 镜头参考 */
export const ICON_TOOL_CAMERA_STAGE: LucideIcon = Clapperboard

/* 媒体类型 ----------------------------------------------------------------- */

export const ICON_MEDIA_IMAGE: LucideIcon = ImageIcon
export const ICON_MEDIA_VIDEO: LucideIcon = Video
export const ICON_MEDIA_AUDIO: LucideIcon = Music

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
