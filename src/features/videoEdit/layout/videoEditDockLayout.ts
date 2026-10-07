import { Orientation, positionToDirection, type DockviewApi, type DockviewGroupPanel, type IDockviewPanel, type SerializedDockview } from 'dockview-react'
import { createLogger } from '@/core/logging'
import { toggleDockGroupMaximized, type DockDropZone } from '@/components/dockviewDocking'

const logger = createLogger('features.videoEdit.layout')
export const VIDEO_EDIT_LAYOUT_STORAGE_KEY = 'henji.videoEdit.dockLayout.v1'
export const VIDEO_EDIT_PANELS = [
  { id: 'project', title: '素材' },
  { id: 'program', title: '节目画面' },
  { id: 'effects', title: '效果控件' },
  { id: 'timeline', title: '时间线' },
  { id: 'source', title: '源监视器' },
  { id: 'content', title: '字幕与标记' },
  { id: 'tracking', title: '跟踪' },
  { id: 'lumetri', title: 'Lumetri 颜色' },
  // PR“效果”面板：视频／音频过渡与效果的预设库，拖到时间线编辑点或片段上（4.3）。
  { id: 'effects_library', title: '效果' },
  { id: 'title_templates', title: '基本图形' },
] as const
export type VideoEditPanelId = typeof VIDEO_EDIT_PANELS[number]['id']

/** A view-only layout: no project content, selection or transport state is serialized. */
export function defaultVideoEditLayout(): SerializedDockview {
  const panels = Object.fromEntries(VIDEO_EDIT_PANELS.filter(panel => panel.id !== 'source' && panel.id !== 'content' && panel.id !== 'tracking' && panel.id !== 'lumetri').map(({ id, title }) => [id, { id, contentComponent: id, title, renderer: 'always' as const }]))
  return {
    grid: {
      width: 1440, height: 860, orientation: Orientation.HORIZONTAL,
      root: { type: 'branch', data: [
        { type: 'leaf', size: 240, data: { id: 'project-group', views: ['project'], activeView: 'project' } },
        { type: 'branch', size: 920, data: [
          { type: 'leaf', size: 540, data: { id: 'program-group', views: ['program'], activeView: 'program' } },
          { type: 'leaf', size: 320, data: { id: 'timeline-group', views: ['timeline'], activeView: 'timeline' } },
        ] },
        { type: 'leaf', size: 280, data: { id: 'effects-group', views: ['effects', 'effects_library', 'title_templates'], activeView: 'effects' } },
      ] },
    }, panels, activeGroup: 'program-group',
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function finitePositive(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value > 0 }

/** Reject unknown renderers, duplicate program views and system-window state before Dockview sees them. */
export function parseVideoEditLayout(raw: string): SerializedDockview {
  const value: unknown = JSON.parse(raw)
  if (!isRecord(value) || !isRecord(value.grid) || !isRecord(value.panels) || value.popoutGroups !== undefined || value.edgeGroups !== undefined) throw new Error('不支持的剪辑布局')
  const { grid, panels } = value
  if (!finitePositive(grid.width) || !finitePositive(grid.height) || ![Orientation.HORIZONTAL, Orientation.VERTICAL].includes(grid.orientation as Orientation)) throw new Error('无效的布局尺寸')
  const known = new Set<string>(VIDEO_EDIT_PANELS.map(panel => panel.id))
  for (const [id, panel] of Object.entries(panels)) {
    if (!known.has(id) || !isRecord(panel) || panel.id !== id || panel.contentComponent !== id) throw new Error('无效的剪辑面板')
    // Inactive tabs retain a single mounted view, including its preview session.
    panel.renderer = 'always'
    // 面板名以当前定义为准：保存过的布局里可能还是旧名称（如“项目素材”改称“素材”之前保存的）。
    panel.title = VIDEO_EDIT_PANELS.find(definition => definition.id === id)?.title
  }
  const seen = new Set<string>()
  const groups = new Set<string>()
  const checkGroup = (group: unknown): void => {
    if (!isRecord(group) || typeof group.id !== 'string' || groups.has(group.id) || !Array.isArray(group.views)) throw new Error('无效的面板分组')
    groups.add(group.id)
    for (const id of group.views) {
      if (typeof id !== 'string' || !known.has(id) || seen.has(id) || !panels[id]) throw new Error('重复或缺失的剪辑面板')
      seen.add(id)
    }
    if (group.activeView !== undefined && !group.views.includes(group.activeView)) throw new Error('无效的活动面板')
  }
  const checkNode = (node: unknown, depth = 0): void => {
    if (!isRecord(node) || depth > 8 || (node.size !== undefined && !finitePositive(node.size))) throw new Error('无效的布局节点')
    if (node.type === 'leaf') checkGroup(node.data)
    else if (node.type === 'branch' && Array.isArray(node.data)) node.data.forEach(child => checkNode(child, depth + 1))
    else throw new Error('无效的布局节点')
  }
  if (!isRecord(grid.root) || grid.root.type !== 'branch') throw new Error('无效的布局根节点')
  checkNode(grid.root)
  if (value.floatingGroups !== undefined) {
    if (!Array.isArray(value.floatingGroups)) throw new Error('无效的浮动面板')
    for (const floating of value.floatingGroups) {
      if (!isRecord(floating) || !isRecord(floating.position) || !finitePositive(floating.position.width) || !finitePositive(floating.position.height)) throw new Error('无效的浮动面板尺寸')
      const position = floating.position
      if (!['top', 'bottom'].some(key => typeof position[key] === 'number' && Number.isFinite(position[key])) || !['left', 'right'].some(key => typeof position[key] === 'number' && Number.isFinite(position[key]))) throw new Error('无效的浮动面板位置')
      if (floating.grid !== undefined && isRecord(floating.grid)) checkNode(floating.grid.root)
      else checkGroup(floating.data)
    }
  }
  if (seen.size !== Object.keys(panels).length) throw new Error('布局含有未挂载面板')
  return value as unknown as SerializedDockview
}

export function restoreVideoEditLayout(api: DockviewApi, storage: Pick<Storage, 'getItem'> = localStorage): void {
  try {
    const saved = storage.getItem(VIDEO_EDIT_LAYOUT_STORAGE_KEY)
    api.fromJSON(saved ? parseVideoEditLayout(saved) : defaultVideoEditLayout(), { reuseExistingPanels: true })
  } catch (error) {
    logger.warn('剪辑布局恢复失败，恢复默认布局', { event: 'video_edit.layout.restore.failed', error })
    api.fromJSON(defaultVideoEditLayout(), { reuseExistingPanels: true })
  }
}

export function saveVideoEditLayout(api: DockviewApi, storage: Pick<Storage, 'setItem'> = localStorage): void {
  storage.setItem(VIDEO_EDIT_LAYOUT_STORAGE_KEY, JSON.stringify(api.toJSON()))
}

export function resetVideoEditLayout(api: DockviewApi): void {
  // reuseExistingPanels keeps mounted preview and timeline components during reset.
  api.fromJSON(defaultVideoEditLayout(), { reuseExistingPanels: true })
}

export function showVideoEditPanel(api: DockviewApi, id: VideoEditPanelId): IDockviewPanel {
  const existing = api.getPanel(id)
  if (existing) { existing.api.setActive(); return existing }
  const definition = VIDEO_EDIT_PANELS.find(panel => panel.id === id)!
  // 字幕与标记是和效果控件同类的侧栏检查器：作为标签并入效果控件那一组，不再在节目画面右侧另开一列——
  // 960 窗口下另开的一列只剩约 120px，标签与列表都被挤成竖排（界面重设计 5.5 第三批）。
  const inspector = (id === 'content' || id === 'tracking' || id === 'lumetri' || id === 'title_templates') ? api.getPanel('effects') : undefined
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
  const inspector = (id === 'content' || id === 'tracking' || id === 'title_templates') ? api.getPanel('effects')?.group : undefined
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
