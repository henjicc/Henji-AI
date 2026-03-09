import { APP_ACCENT_HEX, TEXT_LIGHT_HEX, WHITE_HEX } from '@/core/theme/colorTokens';

export const UI_COLOR_ACCENT_BORDER_CLASS = 'border-brand-500';
export const UI_COLOR_ACCENT_BG_CLASS = 'bg-accent';
export const UI_COLOR_ACCENT_TEXT_CLASS = 'text-brand-300';
export const UI_COLOR_ACCENT_SOFT_BORDER_CLASS = 'border-accent/55';
export const UI_COLOR_ACCENT_SOFT_BG_CLASS = 'bg-accent/20';
export const UI_COLOR_ACCENT_SOFT_BG_WEAK_CLASS = 'bg-accent/10';
export const UI_COLOR_ACCENT_RING_CLASS = 'ring-brand-300/50';
export const UI_CHIP_ACTIVE_STRONG_CLASS = 'border-brand-500/80 bg-brand-600 text-white';
export const UI_CARD_ACTIVE_STRONG_CLASS = 'border-brand-500/75 bg-brand-700 text-white';
export const UI_HIGHLIGHT_RING_INSET_CLASS = `ring-2 ${UI_COLOR_ACCENT_RING_CLASS} ring-inset`;
export const UI_ACCENT_HEX = APP_ACCENT_HEX;
export const UI_WHITE_HEX = WHITE_HEX;
export const UI_TEXT_LIGHT_HEX = TEXT_LIGHT_HEX;

export const UI_PANEL_SURFACE_CLASS =
  'bg-zinc-900/95 backdrop-blur-xl border border-zinc-600/60 text-text-dark shadow-2xl';

export const UI_FIELD_SURFACE_CLASS =
  'bg-zinc-900/70 backdrop-blur-lg border border-zinc-600/60 text-text-dark';

export const UI_FIELD_FOCUS_CLASS =
  'outline-none focus:outline-none focus-visible:outline-none focus:ring-inset focus:ring-2 focus:ring-accent/60 focus:ring-offset-0 focus:ring-offset-transparent focus:border-brand-500 transition-shadow duration-300 ease-out';

export const UI_FIELD_DISABLED_CLASS = 'disabled:opacity-50 disabled:cursor-not-allowed';

export const UI_BUTTON_RESET_CLASS =
  '!outline-none focus:!outline-none focus-visible:!outline-none !ring-0 focus:!ring-0 focus-visible:!ring-0 shadow-none focus:shadow-none';

export const UI_TRIGGER_BUTTON_CLASS =
  `${UI_FIELD_SURFACE_CLASS} ${UI_FIELD_FOCUS_CLASS} ${UI_BUTTON_RESET_CLASS} flex items-center justify-between whitespace-nowrap`;

export const UI_TRIGGER_PANEL_CLASS =
  `${UI_PANEL_SURFACE_CLASS} rounded-lg`;

export const UI_OPTION_ITEM_CLASS =
  'rounded-lg border border-zinc-700/60 bg-zinc-900/45 text-text-dark transition-colors';

export const UI_OPTION_ITEM_HOVER_CLASS =
  'hover:bg-zinc-800/70 hover:border-zinc-500/65';

export const UI_OPTION_ITEM_ACTIVE_CLASS =
  `${UI_COLOR_ACCENT_SOFT_BORDER_CLASS} ${UI_COLOR_ACCENT_SOFT_BG_CLASS} text-white`;
