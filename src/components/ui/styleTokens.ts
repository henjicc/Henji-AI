export const UI_PANEL_SURFACE_CLASS =
  'bg-zinc-900/95 backdrop-blur-xl border border-zinc-600/60 text-text-dark shadow-2xl';

export const UI_FIELD_SURFACE_CLASS =
  'bg-zinc-900/72 backdrop-blur-lg border border-zinc-600/60 text-text-dark';

export const UI_FIELD_FOCUS_CLASS =
  'outline-none focus:outline-none focus-visible:outline-none focus:ring-inset focus:ring-2 focus:ring-[#007eff]/60 focus:ring-offset-0 focus:ring-offset-transparent focus:border-[#007eff] transition-shadow duration-300 ease-out';

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
  'border-[#007eff]/55 bg-[#007eff]/20 text-white';
