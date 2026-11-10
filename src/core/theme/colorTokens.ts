export const APP_ACCENT_HEX = '#007eff';
/** v1 设置的默认强调色。主题种子里它等价于“跟随预设”（迁移与旧设置读取都按此换成预设强调色）。 */
export const SETTINGS_ACCENT_HEX = '#3B82F6';

/** 主题种子强调色（设计稿原值；预设与强调色选项引用这里，见 themeEngine.ts）。 */
export const THEME_SEED_ACCENT_HEX = {
  blue: '#3A6FDF',
  oceanBlue: '#3D86E8',
  violet: '#7B61FF',
  teal: '#159F8C',
  orange: '#D9822B',
  rose: '#D9467A',
} as const;
export const WHITE_HEX = '#ffffff';
/** 属性取值说明的六位十六进制示例，不用于界面配色或内容默认值。 */
export const HEX_COLOR_EXAMPLE = '#FFCC00';
/** 剪辑内置效果“色度抠像”的默认抠像颜色（画面内容色，纯绿）。 */
export const VIDEO_EDIT_CHROMA_KEY_DEFAULT_HEX = '#00ff00';
/** 剪辑内置效果“录屏画框”的背景预设（画面内容色，不随主题）：[渐变起点, 渐变终点]，左上到右下。 */
export const RECORDING_FRAME_BACKGROUND_HEX = {
  graphite: ['#2b2f36', '#121417'], mist: ['#eef1f5', '#c9d2dd'], ocean: ['#1f6fb2', '#0b2545'], sunset: ['#f6a05a', '#c2416b'],
} as const;
/** “录屏画框”纯色背景的默认颜色（画面内容色）。 */
export const RECORDING_FRAME_SOLID_DEFAULT_HEX = '#1b1d22';
export const BLACK_HEX = '#000000';
/** 剪辑内置效果“渐变映射”中间调颜色的默认值（画面内容色，中灰）。 */
export const MID_GRAY_HEX = '#808080';
/** 生成器默认颜色里的深灰、浅灰（画面内容色，中性不染色）。 */
export const DARK_GRAY_HEX = '#404040';
export const LIGHT_GRAY_HEX = '#c0c0c0';
/** 暗底大面积渐变的色带回归输入（设计第 3.5 节的径向背景）。 */
export const VIDEO_EDIT_DARK_GRADIENT_TEST_COLORS = { from: '#16171a', to: '#0d0e10' } as const;
/** 渐变像素回归的固定色标：三原色定位颜色点，透明黑看透明端。 */
export const VIDEO_EDIT_GRADIENT_TEST_STOPS = { red: '#ff0000', green: '#00ff00', blue: '#0000ff', clear: '#00000000' } as const;
/** 渐变映射三色像素回归的固定输入：深蓝、灰、暖白。 */
export const VIDEO_EDIT_GRADIENT_MAP_TEST_COLORS = { dark: '#14213d', mid: MID_GRAY_HEX, light: '#fff3dc' } as const;
/**
 * 音频编辑频谱图的色表（声音能量的可视化，属于内容色，不随界面主题变化）：从静音到最响依次取色，
 * 与 Audition 的频谱显示同一观感（深紫 → 品红 → 橙 → 亮黄）。
 */
export const SPECTROGRAM_COLORMAP_HEX = ['#000004', '#1b0c41', '#4a0c6b', '#781c6d', '#a52c60', '#cf4446', '#ed6925', '#fb9b06', '#f7d13d', '#fcffa4'] as const;
/**
 * 音频编辑示波区（波形、频谱、导航条）的固定配色，参照 Audition：近黑底、亮绿波形、红色播放头、白色半透明选区。
 * 和画面底色一样属于“看内容”的区域，不随界面主题变化，深浅主题下读数一致。
 */
export const AUDIO_SCOPE_COLORS = {
  background: '#0b0f0d',
  grid: 'rgba(255,255,255,0.07)',
  wave: '#3ce49a',
  waveCut: '#3a4a43',
  navigator: '#06120c',
  navigatorWave: '#2e9e6c',
  playhead: '#ff4a3d',
  playheadHandle: '#4c9dff',
  /** 口水音标记（选中“去除口水音”时显示）：刻度上的短线与波形、频谱上的竖线；关掉不处理的位置用灰色 */
  mouthClick: '#f5b83d',
  mouthClickLine: 'rgba(245,184,61,0.55)',
  mouthClickOff: 'rgba(255,255,255,0.4)',
  selection: 'rgba(255,255,255,0.2)',
  selectionEdge: 'rgba(255,255,255,0.6)',
  viewWindow: 'rgba(255,255,255,0.1)',
  viewWindowEdge: 'rgba(255,255,255,0.75)',
  hover: 'rgba(255,255,255,0.45)',
  deleted: 'rgba(255,74,61,0.22)',
  // 静音与删除分开显示：删除红色，静音（保留时长、声音清零，如字间气口）蓝色
  muted: 'rgba(76,157,255,0.24)',
  pending: 'rgba(250,199,117,0.22)',
} as const;
/** 剪辑预设样片的暗角与代码渲染验收形状颜色，属于画面内容，不随界面主题变化。 */
export const VIDEO_EDIT_AUTHOR_CONTENT_COLORS = {
  vignetteCenter: 'rgba(0,0,0,0)',
  vignetteEdge: 'rgba(0,0,0,.6)',
  probeRectangle: 'rgba(255,0,0,.5)',
  probeEllipse: 'rgba(0,255,0,.75)',
} as const;
/** 新建风格自带样片的画面配色（作者代码里的内容色，不随界面主题变化）。 */
/** 剪辑批注的命名颜色（画在节目画面与送给助手的截图上，属于内容色，不随主题变化）。 */
export const VIDEO_EDIT_ANNOTATION_COLORS = {
  red: '#F2384A', orange: '#FF8A1F', yellow: '#FFD21F', green: '#22C55E', blue: '#2F80FF', purple: '#9B5CFF', white: '#FFFFFF', black: '#16181D',
} as const;
export const STYLE_SAMPLE_COLORS = { bg: '#F4F2EE', text: '#16181D', muted: '#6B6F78', accent: '#2F5BFF', line: '#D9D6CF' } as const;
export const TEXT_LIGHT_HEX = '#E5E5E5';

export const CANVAS_BG_HEX = '#0A0A0A';
export const CANVAS_TEXT_HEX = '#FAFAFA';
export const CANVAS_GRID_ALT_HEX = '#404040';

/**
 * 画布插槽（端口）类型颜色映射。
 * 仅在此处集中维护 hex；端口组件通过 getSocketColor 取色，不写颜色字面量。
 */
export const SOCKET_TYPE_COLOR_HEX: Record<string, string> = {
  STRING: '#4ADE80',
  TEXT: '#4ADE80',
  NUMBER: '#60A5FA',
  INT: '#60A5FA',
  FLOAT: '#38BDF8',
  BOOLEAN: '#C084FC',
  ENUM: '#FBBF24',
  IMAGE: '#2DD4BF',
  VIDEO: '#F87171',
  AUDIO: '#F472B6',
  MODEL: '#FDE047',
  OBJECT: '#D4D4D4',
};
export const SOCKET_TYPE_COLOR_FALLBACK_HEX = '#D4D4D4';

/**
 * 浅色模式（纸白等 color-scheme: light）的端口色：同色相加深，压在浅色画布、节点面与间隙色
 * （纸白 #E4E6EA，最暗的浅色表面）上都 ≥ 3:1（WCAG 非文字对比度）。深色值在浅底上只有 1.2–2.7:1。
 * 由 getSocketColor 用 CSS light-dark() 与上表组合，随根节点 color-scheme 自动切换（4.1）。
 */
export const SOCKET_TYPE_COLOR_LIGHT_HEX: Record<string, string> = {
  STRING: '#15803D',
  TEXT: '#15803D',
  NUMBER: '#2563EB',
  INT: '#2563EB',
  FLOAT: '#0284C7',
  BOOLEAN: '#9333EA',
  ENUM: '#B45309',
  IMAGE: '#0F766E',
  VIDEO: '#DC2626',
  AUDIO: '#DB2777',
  MODEL: '#A16207',
  OBJECT: '#737373',
};
export const SOCKET_TYPE_COLOR_LIGHT_FALLBACK_HEX = '#737373';

/**
 * 分镜导出（合并导出 / 图片分镜命令）画进导出图片的内容色：序号徽标底、叠加备注条、缺图占位格。
 * 属于产物像素，不随界面主题变化。
 */
export const STORYBOARD_EXPORT_COLOR = {
  frameIndexBadge: 'rgba(0,0,0,0.65)',
  noteOverlay: 'rgba(0,0,0,0.6)',
  emptyCell: 'rgba(255,255,255,0.08)',
} as const;

// 3D 镜头参考三维场景纯色渲染基础色（1.1 技术验证引入，第二阶段编辑器继续复用）
export const CAMERA_STAGE_COLOR_HEX = {
  stageBg: '#18181c',
  groundBase: '#24242a',
  gridCell: '#303036',
  gridSection: '#4a4a52',
  sunlightNight: '#8FA8D8',
  sunlightWarm: '#FFD2A6',
  sunlightNoon: '#FFF6E0',
  objectWarm: '#e8734a',
  objectCool: '#4a90e8',
  characterPlaceholder: '#d9a441',
  cameraPlaceholder: '#8f97a3',
  selectionOutline: '#4a90e8',
} as const;

export const CAMERA_STAGE_MOTION_PATH_HEX = {
  path: '#e8c84a',
  tangent: '#8f97a3',
  handle: '#e8c84a',
  handleSelected: '#fff6d0',
  handleOutline: '#3f3920',
} as const;

// 3D 镜头参考新建对象默认颜色轮换盘（按对象序号取模）
export const CAMERA_STAGE_OBJECT_PALETTE_HEX = [
  '#e8734a',
  '#4a90e8',
  '#58c472',
  '#e8c84a',
  '#b06fe8',
  '#e85a7a',
  '#4ac8c2',
  '#9aa3ad',
] as const;

// 3D 镜头参考生成布景的楼体颜色：低饱和的几档灰，构图时退在主体后面
export const CAMERA_STAGE_SET_BUILDING_PALETTE_HEX = [
  '#8d939c',
  '#a3a8b0',
  '#787e88',
  '#b4b0a8',
  '#9a958c',
  '#6f747c',
] as const;

// 3D 镜头参考布景的地面铺装、标线与参照物：接近真实材质的低饱和色，压在楼体与主体后面
export const CAMERA_STAGE_SET_DECOR_HEX = {
  road: '#3b3e44',
  sidewalk: '#8f8b85',
  curb: '#b9b5ad',
  median: '#5d7348',
  lawn: '#667f4e',
  plaza: '#a39c90',
  water: '#4f6f86',
  marking: '#e6e3da',
  centerLine: '#d4ad3c',
  trunk: '#5f4b3b',
  lampPole: '#4d5157',
  lampHead: '#dcd8c8',
  vehicleGlass: '#2b3238',
  vehicleTire: '#1f2124',
} as const;

// 行道树树冠的几档绿，逐棵轮换，避免整排一个颜色
export const CAMERA_STAGE_SET_CANOPY_PALETTE_HEX = [
  '#56763f',
  '#62834a',
  '#4c6a3a',
  '#6c8c52',
] as const;

// 车身颜色：白、黑、银、灰、深蓝、红、米、深绿，序号与布景装饰里的颜色序号一一对应
export const CAMERA_STAGE_SET_VEHICLE_PALETTE_HEX = [
  '#e4e4e0',
  '#25272b',
  '#a9adb2',
  '#6b7077',
  '#2f4466',
  '#9c3434',
  '#c8bba0',
  '#3e5446',
] as const;

export const ANNOTATION_DEFAULT_STROKE_HEX = '#ff4d4f';
export const ANNOTATION_DEFAULT_TEXT_HEX = '#ffffff';

export const IMAGE_EDITOR_PRESET_COLORS = [
  '#ff0000',
  '#ff6b00',
  '#ffd000',
  '#00c853',
  '#00b0ff',
  '#7c4dff',
  '#ff4081',
  '#ffffff',
  '#000000',
] as const;

/** 图片编辑「辉光 Pro」的三种光感预设色；用户仍可在面板中选择任意六位 hex 颜色。 */
export const IMAGE_EDITOR_GLOW_TINT_HEX = {
  natural: '#fff1dc',
  dreamy: '#c7dcff',
  neon: '#72fff0',
} as const;

/** 新建空白图片的背景预设；调用侧只负责文案，不自行写颜色字面量。 */
export const BLANK_IMAGE_BACKGROUND_PRESET_HEX = [
  WHITE_HEX,
  '#f2f2f2',
  BLACK_HEX,
] as const;

const DEFAULT_THEME_COLOR_SCHEME_HEX = {
  bg: '#171717',
  surface: '#262626',
  border: '#404040',
  text: '#FFFFFF',
  textMuted: '#A3A3A3',
  app: '#0A0A0A',
  canvas: '#0A0A0A',
  panel: '#171717',
  layer: '#404040',
} as const;

/**
 * 窗口首帧底色 = 默认主题（石墨）推导出的 `window` 令牌；`themeStaticDefaults.test.ts` 断言二者一致。
 * 主进程创建窗口时用它；用户主题同步到主进程之前，非石墨主题在窗口 ready-to-show 之前的极短时间仍是此色。
 */
export const APP_WINDOW_BACKGROUND_HEX = '#1B1B1B';

export const ACCENT_PRESET_HEX = [
  '#3B82F6',
  '#2563EB',
  '#0EA5E9',
  '#14B8A6',
  '#22C55E',
  '#F59E0B',
  '#EF4444',
  '#A855F7',
] as const;

export const THEME_PALETTE_PRESET_HEX = [
  {
    id: 'default',
    name: { zh: '经典深色', en: 'Classic Dark' },
    colors: DEFAULT_THEME_COLOR_SCHEME_HEX,
  },
  {
    id: 'slate-night',
    name: { zh: '深黑灰阶', en: 'Deep Monochrome' },
    colors: {
      bg: '#0A0A0A',
      surface: '#171717',
      border: '#262626',
      text: '#FAFAFA',
      textMuted: '#737373',
      app: '#000000',
      canvas: '#0A0A0A',
      panel: '#171717',
      layer: '#262626',
    },
  },
  {
    id: 'graphite-pro',
    name: { zh: '石墨灰阶', en: 'Graphite Monochrome' },
    colors: {
      bg: '#171717',
      surface: '#262626',
      border: '#525252',
      text: '#FFFFFF',
      textMuted: '#D4D4D4',
      app: '#0A0A0A',
      canvas: '#171717',
      panel: '#262626',
      layer: '#404040',
    },
  },
  {
    id: 'warm-film',
    name: { zh: '银盐灰阶', en: 'Silver Grain' },
    colors: {
      bg: '#262626',
      surface: '#404040',
      border: '#737373',
      text: '#FFFFFF',
      textMuted: '#E5E5E5',
      app: '#171717',
      canvas: '#262626',
      panel: '#404040',
      layer: '#525252',
    },
  },
] as const;

/**
 * 剪辑素材面板的颜色标签（剪辑对齐 PR 3.2）：沿用 PR 默认标签的 16 种颜色，是用户给素材做记号的内容色，
 * 不随主题变化；键与 `core/videoEdit/labels.ts` 的标签名一致。
 */
export const VIDEO_EDIT_LABEL_COLOR_HEX = {
  violet: '#A990DD', iris: '#9095F2', caribbean: '#1DC09F', lavender: '#E384E3', cerulean: '#1EA7DC', forest: '#5BA33F', rose: '#E86C8F', mango: '#EDA530',
  purple: '#9440DB', blue: '#4253D9', teal: '#2D8C8C', magenta: '#C1269A', tan: '#C2A07B', green: '#2B9D3C', brown: '#8C5A32', yellow: '#E6D84A',
} as const;

/** 内置效果预览素材的固定内容色，不随界面主题变化。 */
export const VIDEO_EDIT_EFFECT_PREVIEW_COLORS = {
  titleAccent: '#4fd1ff',
  signalRed: '#ff3b6b',
  signalYellow: '#ffd25a',
  signalMint: '#8affc1',
  skyTop: '#05070d',
  skyBottom: '#1a1c26',
  moon: '#fff6dc',
  windowWarm: '#ffd9a0',
  windowCool: '#7fd4ff',
  windowPink: '#ff6a6a',
  neonRed: '#ff2d55',
  neonBlue: '#2d8cff',
  mutedText: '#6c707c',
  darkTitle: '#2a2d33',
  badge: '#3a6df0',
} as const;

/** 发光像素回归的固定着色输入，保持已登记画面基线。 */
export const VIDEO_EDIT_GLOW_TEST_COLORS = { inner: '#ff8040', outer: '#4080ff' } as const;

/** 剪辑内置效果“漏光”的默认颜色（画面内容色）：最亮处暖白、边缘橙。 */
export const VIDEO_EDIT_LIGHT_LEAK_DEFAULT_HEX = { hot: '#ffe8c8', edge: '#ff8a4a' } as const;

/** 三维灯光片段的缺省灯色（画面内容色，不是界面色）：白光。 */
export const VIDEO_EDIT_SPACE_LIGHT_DEFAULT_HEX = '#ffffff';
