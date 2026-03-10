export const APP_ACCENT_HEX = '#007eff';
export const SETTINGS_ACCENT_HEX = '#3B82F6';
export const WHITE_HEX = '#ffffff';
export const BLACK_HEX = '#000000';
export const TEXT_LIGHT_HEX = '#e5e7eb';

export const CANVAS_BG_HEX = '#0f1115';
export const CANVAS_TEXT_HEX = '#f8fafc';
export const CANVAS_GRID_HEX = '#1f2937';
export const CANVAS_GRID_ALT_HEX = '#2a2a2a';

export const STORYBOARD_BG_HEX = '#10131a';
export const STORYBOARD_CELL_BG_HEX = '#1f2937';
export const STORYBOARD_NOTE_BG_HEX = '#0b0d12';
export const STORYBOARD_NOTE_TEXT_HEX = '#e5e7eb';

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
    name: { zh: '石板夜色', en: 'Slate Night' },
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
    name: { zh: '石墨专业', en: 'Graphite Pro' },
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
    name: { zh: '暖调胶片', en: 'Warm Film' },
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
