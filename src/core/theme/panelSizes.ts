/** 可拖动侧栏的共享宽度契约；上下限仍由各宿主按视口夹取。 */
export const UI_PANEL_WIDTH = {
  rail: 52,
  sidebar: { min: 184, default: 232, max: 360 },
  inspector: { min: 248, default: 320, max: 460 },
  // 助手最大宽度取当前工作区剩余宽度，不设脱离宿主的固定上限。
  assistant: { min: 320, default: 420 },
} as const;
