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
/** 剪辑内置效果“色度抠像”的默认抠像颜色（画面内容色，纯绿）。 */
export const VIDEO_EDIT_CHROMA_KEY_DEFAULT_HEX = '#00ff00';
export const BLACK_HEX = '#000000';
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

// 3D 镜头参考时间轴（第三阶段）配色：播放头 / 关键帧菱形 / 轨道分隔 / 曲线图分量色
export const CAMERA_STAGE_TIMELINE_HEX = {
  playhead: '#e8734a',
  keyframe: '#c9ccd2',
  keyframeSelected: '#4a90e8',
  keyframeEased: '#e8c84a',
  laneBorder: '#2a2a30',
  laneActive: '#202027',
  // 曲线图分量色（对齐 AE：X 红 / Y 绿 / Z 蓝，其余走强调色）
  axisX: '#e0555f',
  axisY: '#5fbf6a',
  axisZ: '#5a8fe0',
  curveOther: '#c9a0e8',
  curveGrid: '#26262c',
  curveHandle: '#e8c84a',
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

/** 马赛克标注在源图像素尚未就绪时的占位填充（中性灰 60%），画进 Konva 画布，不随主题。 */
export const ANNOTATION_MOSAIC_PLACEHOLDER_FILL = 'rgba(127, 127, 127, 0.6)';
export const ANNOTATION_DEFAULT_STROKE_HEX = '#ff4d4f';
export const ANNOTATION_DEFAULT_TEXT_HEX = '#ffffff';
export const ANNOTATION_TRANSFORMER_HEX = '#3b82f6';

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

export const DEFAULT_THEME_COLOR_SCHEME_HEX = {
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

export const LEGACY_DEFAULT_THEME_COLOR_SCHEME_HEX = {
  bg: '#0F0F0F',
  surface: '#1A1A1A',
  border: '#2A2A2A',
  text: '#FFFFFF',
  textMuted: '#888888',
  app: '#0A0B0D',
  canvas: '#0B0C10',
  panel: '#131313',
  layer: '#1B1C21',
} as const;

export const LEGACY_NEUTRAL_THEME_COLOR_SCHEME_HEX = {
  bg: '#0F0F0F',
  surface: '#1A1A1A',
  border: '#2A2A2A',
  text: '#FFFFFF',
  textMuted: '#888888',
  app: '#0A0A0A',
  canvas: '#0B0B0B',
  panel: '#131313',
  layer: '#1B1B1B',
} as const;

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

export const LEGACY_THEME_PALETTE_PRESET_HEX = [
  {
    id: 'default',
    colors: LEGACY_DEFAULT_THEME_COLOR_SCHEME_HEX,
  },
  {
    id: 'default',
    colors: LEGACY_NEUTRAL_THEME_COLOR_SCHEME_HEX,
  },
  {
    id: 'slate-night',
    colors: {
      bg: '#0B1020',
      surface: '#121A2C',
      border: '#22304A',
      text: '#EAF0FF',
      textMuted: '#9BA8C8',
      app: '#090E1A',
      canvas: '#0A1222',
      panel: '#10182A',
      layer: '#1A243A',
    },
  },
  {
    id: 'graphite-pro',
    colors: {
      bg: '#111214',
      surface: '#1C1E22',
      border: '#333842',
      text: '#F5F7FB',
      textMuted: '#A3AAB6',
      app: '#0D0E10',
      canvas: '#101217',
      panel: '#171A1F',
      layer: '#242A33',
    },
  },
  {
    id: 'warm-film',
    colors: {
      bg: '#17120F',
      surface: '#241B16',
      border: '#3C2F25',
      text: '#F5E9DE',
      textMuted: '#C0A893',
      app: '#120F0D',
      canvas: '#17120D',
      panel: '#1F1712',
      layer: '#2C221A',
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
