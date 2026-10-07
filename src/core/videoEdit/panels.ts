/**
 * 剪辑工作区里能成为“当前面板”的面板（剪辑实例的 activePanel、宿主上下文的 focusedPanel 共用）。
 * 两处曾各写一份枚举，宿主上下文漏了 Lumetri / 标题模板 / 跟踪，聚焦这些面板时助手的全部读取都会参数校验失败。
 */
export const VIDEO_EDIT_FOCUSABLE_PANELS = ['project', 'source', 'program', 'timeline', 'effects', 'content', 'tracking', 'lumetri', 'title_templates'] as const
export type VideoEditFocusablePanel = typeof VIDEO_EDIT_FOCUSABLE_PANELS[number]
