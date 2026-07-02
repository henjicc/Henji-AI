export const APP_ACCENT_HEX = '#007eff';
export const SETTINGS_ACCENT_HEX = '#3B82F6';
export const WHITE_HEX = '#ffffff';
export const BLACK_HEX = '#000000';
export const TEXT_LIGHT_HEX = '#E5E5E5';

export const CANVAS_BG_HEX = '#0A0A0A';
export const CANVAS_TEXT_HEX = '#FAFAFA';
export const CANVAS_GRID_HEX = '#262626';
export const CANVAS_GRID_ALT_HEX = '#404040';

/**
 * 画布插槽（端口）类型颜色映射。
 * 仅在此处集中维护 hex；端口组件通过 getSocketColor 取色，不写颜色字面量。
 */
export const SOCKET_TYPE_COLOR_HEX: Record<string, string> = {
  STRING: '#22C55E',
  TEXT: '#22C55E',
  NUMBER: '#3B82F6',
  INT: '#3B82F6',
  FLOAT: '#0EA5E9',
  BOOLEAN: '#A855F7',
  ENUM: '#F59E0B',
  IMAGE: '#14B8A6',
  VIDEO: '#EF4444',
  AUDIO: '#EC4899',
  MODEL: '#FACC15',
  OBJECT: '#A3A3A3',
};
export const SOCKET_TYPE_COLOR_FALLBACK_HEX = '#A3A3A3';

export const STORYBOARD_BG_HEX = '#171717';
export const STORYBOARD_CELL_BG_HEX = '#262626';
export const STORYBOARD_NOTE_BG_HEX = '#0A0A0A';
export const STORYBOARD_NOTE_TEXT_HEX = '#E5E5E5';

// 运镜控制三维场景纯色渲染基础色（1.1 技术验证引入，第二阶段编辑器继续复用）
export const CAMERA_STAGE_COLOR_HEX = {
  stageBg: '#18181c',
  gridCell: '#303036',
  gridSection: '#4a4a52',
  objectWarm: '#e8734a',
  objectCool: '#4a90e8',
} as const;

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

export const NANO_BANANA_ICON_COLORS = {
  peelDark: '#F3AD61',
  peelMid: '#F9C23C',
  peelLight: '#FEEFC2',
  peelBright: '#FCD53F',
  peelHighlight: '#FFF478',
} as const;

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

export const APP_WINDOW_BACKGROUND_HEX = DEFAULT_THEME_COLOR_SCHEME_HEX.app;

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
