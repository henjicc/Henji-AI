import { registerWorkspaceLayout } from '@/services/workspaceLayouts/workspaceLayoutService'
import { parseWorkspaceDockLayout } from '@/core/workspaceLayouts/validation'
import { Orientation, positionToDirection, type DockviewApi, type DockviewGroupPanel, type IDockviewPanel, type SerializedDockview } from 'dockview-react'
import { createLogger } from '@/core/logging'
import { toggleDockGroupMaximized, type DockDropZone } from '@/components/dockviewDocking'

const logger = createLogger('features.videoEdit.layout')
export const VIDEO_EDIT_LAYOUT_STORAGE_KEY = 'henji.videoEdit.dockLayout.v1'
export const VIDEO_EDIT_PANELS = [
  { id: 'style_kits', title: '风格' },
  { id: 'project', title: '素材' },
  { id: 'program', title: '节目画面' },
  { id: 'effects', title: '效果控件' },
  { id: 'timeline', title: '时间线' },
  { id: 'source', title: '源监视器' },
  { id: 'annotations', title: '批注' },
  { id: 'content', title: '字幕与标记' },
  { id: 'tracking', title: '跟踪' },
  { id: 'color_grade', title: '全能调色' },
  // PR“效果”面板：视频／音频过渡与效果的预设库，拖到时间线编辑点或片段上（4.3）。
  { id: 'effects_library', title: '效果' },
  { id: 'title_templates', title: '模板' },
  // 预设：风格、标题、文字、效果、转场预设的动态预览与管理（评分、默认、导入导出）。
  { id: 'presets', title: '预设' },
] as const
export type VideoEditPanelId = typeof VIDEO_EDIT_PANELS[number]['id']
const INSPECTOR_PANELS: readonly string[] = ['effects', 'title_templates', 'effects_library', 'presets', 'style_kits', 'annotations', 'content', 'tracking', 'color_grade']

function inspectorReference(api: DockviewApi, id: string, own?: DockviewGroupPanel): IDockviewPanel | undefined {
  if (!INSPECTOR_PANELS.includes(id)) return undefined
  return INSPECTOR_PANELS.map(candidate => api.getPanel(candidate)).find(panel => panel && panel.id !== id && panel.group !== own && panel.api.location.type === 'grid')
}

/** A view-only layout: no project content, selection or transport state is serialized. */
export function defaultVideoEditLayout(): SerializedDockview {
  const panels = Object.fromEntries(VIDEO_EDIT_PANELS.filter(panel => panel.id !== 'annotations' && panel.id !== 'source' && panel.id !== 'content' && panel.id !== 'tracking' && panel.id !== 'color_grade').map(({ id, title }) => [id, { id, contentComponent: id, title, renderer: 'always' as const }]))
  return {
    grid: {
      width: 1440, height: 860, orientation: Orientation.HORIZONTAL,
      root: { type: 'branch', data: [
        { type: 'leaf', size: 240, data: { id: 'project-group', views: ['project'], activeView: 'project' } },
        { type: 'branch', size: 920, data: [
          { type: 'leaf', size: 540, data: { id: 'program-group', views: ['program'], activeView: 'program' } },
          { type: 'leaf', size: 320, data: { id: 'timeline-group', views: ['timeline'], activeView: 'timeline' } },
        ] },
        { type: 'leaf', size: 280, data: { id: 'effects-group', views: ['effects', 'presets', 'effects_library', 'title_templates', 'style_kits'], activeView: 'effects' } },
      ] },
    }, panels, activeGroup: 'program-group',
  }
}

export function parseVideoEditLayout(raw: string): SerializedDockview {
  return parseWorkspaceDockLayout(raw, VIDEO_EDIT_PANELS)
}

/** 原有入口统一委托共享预设服务。 */
export function resetVideoEditLayout(api: DockviewApi): void {
  const controller = videoEditLayoutPresets
  if (controller.getSnapshot().ready) void controller.resetActive().catch(error => logger.warn('剪辑布局重置失败', { error }))
  else api.fromJSON(defaultVideoEditLayout(), { reuseExistingPanels: true })
}

function colorGradeLayout(): SerializedDockview {
  const layout = defaultVideoEditLayout()
  layout.panels.color_grade = { id: 'color_grade', contentComponent: 'color_grade', title: '全能调色', renderer: 'always' }
  if (!Array.isArray(layout.grid.root.data)) throw new Error('默认布局根节点无效')
  const inspector = layout.grid.root.data[2]
  if (inspector.type === 'leaf' && !Array.isArray(inspector.data)) { inspector.size = 480; inspector.data.views.unshift('color_grade'); inspector.data.activeView = 'color_grade' }
  return layout
}
export const videoEditLayoutPresets = registerWorkspaceLayout({
  workspaceId: 'video_edit', panels: VIDEO_EDIT_PANELS,
  builtinPresets: [{ id: 'editing', name: '编辑', layout: defaultVideoEditLayout() }, { id: 'grading', name: '调色', layout: colorGradeLayout() }],
  readLegacy: () => { const raw = localStorage.getItem(VIDEO_EDIT_LAYOUT_STORAGE_KEY); return raw ? parseVideoEditLayout(raw) : undefined },
})

export function showVideoEditPanel(api: DockviewApi, id: VideoEditPanelId): IDockviewPanel {
  const existing = api.getPanel(id)
  if (existing) { existing.api.setActive(); return existing }
  const definition = VIDEO_EDIT_PANELS.find(panel => panel.id === id)!
  // 字幕与标记是和效果控件同类的侧栏检查器：作为标签并入效果控件那一组，不再在节目画面右侧另开一列——
  // 960 窗口下另开的一列只剩约 120px，标签与列表都被挤成竖排（界面重设计 5.5 第三批）。
  const inspector = inspectorReference(api, id)
  if (inspector && inspector.api.location.type === 'grid') {
    return api.addPanel({ id, component: id, title: definition.title, renderer: 'always', position: { referencePanel: inspector, direction: 'within' } })
  }
  // 节目画面（关闭或从独立浮窗贴回）回到时间线上方：原来按“程序面板不存在 → 第一个面板右侧”新开一列，
  // 时间线被挤成整高的窄竖列，标尺只剩不到 300px（5.8 全量回归：性能场景弹出节目浮窗再关闭后，后续剪辑场景全部点不到标尺）。
  const timeline = id === 'program' ? api.getPanel('timeline') : undefined
  if (timeline && timeline.api.location.type === 'grid') {
    return api.addPanel({ id, component: id, title: definition.title, renderer: 'always', position: { referencePanel: timeline, direction: 'above' } })
  }
  const reference = api.getPanel('program') ?? api.panels.find(panel => panel.api.location.type === 'grid')
  return api.addPanel({ id, component: id, title: definition.title, renderer: 'always',
    ...(reference ? { position: { referencePanel: reference, direction: id === 'timeline' ? 'below' : id === 'project' || id === 'source' ? 'left' : 'right' } } : {}),
    ...(id === 'timeline' ? { initialHeight: 320 } : id === 'program' ? {} : { initialWidth: 280 }),
  })
}

/**
 * 浮动面板贴回主区域时落到它的默认方位（与 showVideoEditPanel 一致）：时间线在节目画面下方，项目与源监视器在左，
 * 其余在右，字幕与标记并入效果控件那一组。此前一律贴到右边，时间线贴回后成了一条窄竖列（960 窗口下只剩约 360px，
 * 标尺可见部分不到 130px），后续剪辑沿用这份布局（5.8 全量回归发现）。
 */
function defaultDockTarget(api: DockviewApi, id: string, own: DockviewGroupPanel): { group: DockviewGroupPanel; position: 'left' | 'right' | 'bottom' | 'center' } | null {
  const isGridGroup = (group: DockviewGroupPanel | undefined): group is DockviewGroupPanel => Boolean(group && group !== own && group.api.location.type === 'grid')
  const inspector = inspectorReference(api, id, own)?.group
  if (isGridGroup(inspector)) return { group: inspector, position: 'center' }
  const program = api.getPanel('program')?.group
  const reference = isGridGroup(program) ? program : api.groups.find(isGridGroup)
  if (!reference) return null
  return { group: reference, position: id === 'timeline' ? 'bottom' : id === 'project' || id === 'source' ? 'left' : 'right' }
}

export function dockVideoEditPanel(api: DockviewApi, panel: IDockviewPanel): void {
  const target = defaultDockTarget(api, panel.id, panel.group)
  if (target) {
    panel.api.moveTo(target)
    return
  }
  const group = api.addGroup({ direction: 'right' })
  panel.api.moveTo({ group, position: 'center' })
}

export function dockVideoEditGroup(api: DockviewApi, group: DockviewGroupPanel): void {
  const target = defaultDockTarget(api, group.activePanel?.id ?? '', group)
  group.api.moveTo(target ?? { position: 'right' })
}

/**
 * 把面板放到拖回时指示的位置（独立窗口拖回主窗口）：窗口边缘 = 贴到整个区域那一边；面板组四边 = 贴在旁边；
 * 中部或标签栏 = 叠成标签。目标组已不存在时回到默认方位。
 */
export function addVideoEditPanelAt(api: DockviewApi, id: VideoEditPanelId, zone: DockDropZone): IDockviewPanel {
  const existing = api.getPanel(id)
  if (existing) { existing.api.setActive(); return existing }
  const definition = VIDEO_EDIT_PANELS.find(panel => panel.id === id)!
  const base = { id, component: id, title: definition.title, renderer: 'always' as const }
  if (zone.kind === 'root') return api.addPanel({ ...base, position: { direction: positionToDirection(zone.side) } })
  if (!api.groups.includes(zone.group)) return showVideoEditPanel(api, id)
  return api.addPanel({ ...base, position: { referenceGroup: zone.group, direction: positionToDirection(zone.position) } })
}

/**
 * 最大化／还原面板组（PR 的 `` ` `` 键）：最大化指针下的面板组，指针不在面板组上时用当前活动组；
 * 已最大化时还原。供快捷键命令调用，返回是否有变化。
 */
export function toggleVideoEditGroupMaximized(api: DockviewApi, point?: { clientX: number; clientY: number }): boolean {
  return toggleDockGroupMaximized(api, point)
}
