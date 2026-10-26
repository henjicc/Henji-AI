import { registerWorkspaceLayout } from '@/services/workspaceLayouts/workspaceLayoutService'
import { parseWorkspaceDockLayout } from '@/core/workspaceLayouts/validation'
import { Orientation, positionToDirection, type DockviewApi, type DockviewGroupPanel, type IDockviewPanel, type SerializedDockview } from 'dockview-react'
import { createLogger } from '@/core/logging'
import { toggleDockGroupMaximized, type DockDropZone } from '@/components/dockviewDocking'
import { workspacePanelConstraints } from '@/core/workspaceLayouts/validation'

const logger = createLogger('features.videoEdit.layout')
export const VIDEO_EDIT_LAYOUT_STORAGE_KEY = 'henji.videoEdit.dockLayout.v1'
/**
 * 面板与它们的最小尺寸（重要记录 020）：右侧检查器一组标签取同一档，切标签时组宽不跳；
 * 默认布局在 960×640 窗口里同时放得下这些最小值（素材 220 + 时间线 400 + 检查器 320 = 940 宽，节目 + 时间线 = 400 高）。
 * 检查器 320：效果控件最宽的一行（缩放：数值 ⛓ 数值 + 单位道）连同名称后的关键帧导航放得下，名称列不被数值盖住；
 * 素材 220：底栏的项目计数（“17 项”）与右侧五个工具按钮同排放得下；“· 已选 N”放不下时先让出。
 * 数值由 ui:tour 的尺寸扫描（scripts/ui-review/layout-sweep.json）核对：拖到这里内容不裁切、不遮挡。
 */
const INSPECTOR_MIN = { minimumWidth: 320, minimumHeight: 180 } as const
export const VIDEO_EDIT_PANELS = [
  { id: 'style_kits', title: '风格', ...INSPECTOR_MIN },
  { id: 'project', title: '素材', minimumWidth: 220, minimumHeight: 180 },
  { id: 'program', title: '节目画面', minimumWidth: 320, minimumHeight: 200 },
  { id: 'effects', title: '效果控件', ...INSPECTOR_MIN },
  { id: 'timeline', title: '时间线', minimumWidth: 400, minimumHeight: 200 },
  { id: 'source', title: '源监视器', minimumWidth: 280, minimumHeight: 200 },
  { id: 'annotations', title: '批注', ...INSPECTOR_MIN },
  { id: 'content', title: '字幕与标记', ...INSPECTOR_MIN },
  { id: 'tracking', title: '跟踪', ...INSPECTOR_MIN },
  { id: 'color_grade', title: '全能调色', ...INSPECTOR_MIN },
  // PR“效果”面板：视频／音频过渡与效果的预设库，拖到时间线编辑点或片段上（4.3）。
  { id: 'effects_library', title: '效果', ...INSPECTOR_MIN },
  { id: 'title_templates', title: '模板', ...INSPECTOR_MIN },
  // 预设：风格、标题、文字、效果、转场预设的动态预览与管理（评分、默认、导入导出）。
  { id: 'presets', title: '预设', ...INSPECTOR_MIN },
  // 音轨混合器（参照 Audition / PR）：每条音频轨道的效果、声像、静音独奏、推子，最右边主轨。音频编辑的“多轨”打开的就是这个布局。
  { id: 'audio_mixer', title: '音轨混合器', minimumWidth: 360, minimumHeight: 260 },
] as const
export type VideoEditPanelId = typeof VIDEO_EDIT_PANELS[number]['id']
const INSPECTOR_PANELS: readonly string[] = ['effects', 'title_templates', 'effects_library', 'presets', 'style_kits', 'annotations', 'content', 'tracking', 'color_grade']

function inspectorReference(api: DockviewApi, id: string, own?: DockviewGroupPanel): IDockviewPanel | undefined {
  if (!INSPECTOR_PANELS.includes(id)) return undefined
  return INSPECTOR_PANELS.map(candidate => api.getPanel(candidate)).find(panel => panel && panel.id !== id && panel.group !== own && panel.api.location.type === 'grid')
}

/** A view-only layout: no project content, selection or transport state is serialized. */
export function defaultVideoEditLayout(): SerializedDockview {
  const panels = Object.fromEntries(VIDEO_EDIT_PANELS.filter(panel => panel.id !== 'annotations' && panel.id !== 'source' && panel.id !== 'content' && panel.id !== 'tracking' && panel.id !== 'color_grade' && panel.id !== 'audio_mixer').map(({ id, title }) => [id, { id, contentComponent: id, title, renderer: 'always' as const }]))
  return {
    grid: {
      width: 1440, height: 860, orientation: Orientation.HORIZONTAL,
      root: { type: 'branch', data: [
        { type: 'leaf', size: 240, data: { id: 'project-group', views: ['project'], activeView: 'project' } },
        { type: 'branch', size: 880, data: [
          { type: 'leaf', size: 540, data: { id: 'program-group', views: ['program'], activeView: 'program' } },
          { type: 'leaf', size: 320, data: { id: 'timeline-group', views: ['timeline'], activeView: 'timeline' } },
        ] },
        { type: 'leaf', size: 320, data: { id: 'effects-group', views: ['effects', 'presets', 'effects_library', 'title_templates', 'style_kits'], activeView: 'effects' } },
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
/**
 * 音频（多轨）布局，参照 Audition 的多轨视图：时间线占主区，下方音轨混合器；右侧上面是小节目画面，下面效果控件（片段效果与基本声音）。
 * 素材在左。音频编辑点“多轨”打开序列时用它。
 */
export function audioVideoEditLayout(): SerializedDockview {
  const panel = (id: VideoEditPanelId, title: string) => ({ id, contentComponent: id, title, renderer: 'always' as const })
  return {
    grid: {
      width: 1440, height: 860, orientation: Orientation.HORIZONTAL,
      root: { type: 'branch', data: [
        { type: 'leaf', size: 240, data: { id: 'project-group', views: ['project', 'effects_library'], activeView: 'project' } },
        { type: 'branch', size: 860, data: [
          { type: 'leaf', size: 540, data: { id: 'timeline-group', views: ['timeline'], activeView: 'timeline' } },
          { type: 'leaf', size: 320, data: { id: 'mixer-group', views: ['audio_mixer'], activeView: 'audio_mixer' } },
        ] },
        { type: 'branch', size: 340, data: [
          { type: 'leaf', size: 260, data: { id: 'program-group', views: ['program'], activeView: 'program' } },
          { type: 'leaf', size: 600, data: { id: 'effects-group', views: ['effects', 'presets'], activeView: 'effects' } },
        ] },
      ] },
    },
    panels: Object.fromEntries((['project', 'effects_library', 'timeline', 'audio_mixer', 'program', 'effects', 'presets'] as const).map(id => [id, panel(id, VIDEO_EDIT_PANELS.find(item => item.id === id)!.title)])),
    activeGroup: 'timeline-group',
  }
}
export const VIDEO_EDIT_AUDIO_LAYOUT_PRESET = 'audio'
export const videoEditLayoutPresets = registerWorkspaceLayout({
  workspaceId: 'video_edit', panels: VIDEO_EDIT_PANELS,
  builtinPresets: [{ id: 'editing', name: '编辑', layout: defaultVideoEditLayout() }, { id: 'grading', name: '调色', layout: colorGradeLayout() }, { id: VIDEO_EDIT_AUDIO_LAYOUT_PRESET, name: '音频', layout: audioVideoEditLayout() }],
  readLegacy: () => { const raw = localStorage.getItem(VIDEO_EDIT_LAYOUT_STORAGE_KEY); return raw ? parseVideoEditLayout(raw) : undefined },
})

/** 主区域各组比自己的最小宽度（组内面板最小宽度的最大值）窄了多少，合计 */
function widthShortfall(api: DockviewApi): number {
  return api.groups.filter(group => group.api.location.type === 'grid').reduce((sum, group) => {
    const minimum = Math.max(0, ...group.panels.map(panel => VIDEO_EDIT_PANELS.find(definition => definition.id === panel.id)?.minimumWidth ?? 0))
    return sum + Math.max(0, minimum - group.api.width)
  }, 0)
}

/**
 * 新开的一列（左右方向）让这一排放不下各组的最小宽度时，改为参考组里的一个标签。960 窗口下各列最小宽度之和
 * 已经放不下第四列：源监视器在素材与节目画面之间只剩约 97px，连自己的标签都被挤进溢出（重要记录 020）。
 */
function tabIntoReferenceWhenTooNarrow(api: DockviewApi, panel: IDockviewPanel, referenceGroup: DockviewGroupPanel | undefined, shortfallBefore: number): IDockviewPanel {
  if (!referenceGroup || referenceGroup === panel.group || widthShortfall(api) <= shortfallBefore + 1) return panel
  panel.api.moveTo({ group: referenceGroup, position: 'center' })
  return panel
}

export function showVideoEditPanel(api: DockviewApi, id: VideoEditPanelId): IDockviewPanel {
  const existing = api.getPanel(id)
  if (existing) { existing.api.setActive(); return existing }
  const definition = VIDEO_EDIT_PANELS.find(panel => panel.id === id)!
  const constraints = workspacePanelConstraints(VIDEO_EDIT_PANELS, id)
  // 字幕与标记是和效果控件同类的侧栏检查器：作为标签并入效果控件那一组，不再在节目画面右侧另开一列——
  // 960 窗口下另开的一列只剩约 120px，标签与列表都被挤成竖排（界面重设计 5.5 第三批）。
  const inspector = inspectorReference(api, id)
  if (inspector && inspector.api.location.type === 'grid') {
    return api.addPanel({ id, component: id, title: definition.title, renderer: 'always', ...constraints, position: { referencePanel: inspector, direction: 'within' } })
  }
  // 节目画面（关闭或从独立浮窗贴回）回到时间线上方：原来按“程序面板不存在 → 第一个面板右侧”新开一列，
  // 时间线被挤成整高的窄竖列，标尺只剩不到 300px（5.8 全量回归：性能场景弹出节目浮窗再关闭后，后续剪辑场景全部点不到标尺）。
  // 源监视器默认和节目画面在同一组、同一大小（达芬奇单监视器的做法，2026-10-26 用户要求）：双击素材时切到它，拖出标签可并排
  const program = id === 'source' ? api.getPanel('program') : undefined
  if (program && program.api.location.type === 'grid') {
    return api.addPanel({ id, component: id, title: definition.title, renderer: 'always', ...constraints, position: { referencePanel: program, direction: 'within' } })
  }
  const timeline = id === 'program' ? api.getPanel('timeline') : undefined
  if (timeline && timeline.api.location.type === 'grid') {
    return api.addPanel({ id, component: id, title: definition.title, renderer: 'always', ...constraints, position: { referencePanel: timeline, direction: 'above' } })
  }
  const reference = api.getPanel('program') ?? api.panels.find(panel => panel.api.location.type === 'grid')
  const shortfallBefore = widthShortfall(api)
  const added = api.addPanel({ id, component: id, title: definition.title, renderer: 'always', ...constraints,
    ...(reference ? { position: { referencePanel: reference, direction: id === 'timeline' ? 'below' : id === 'project' || id === 'source' ? 'left' : 'right' } } : {}),
    ...(id === 'timeline' ? { initialHeight: 320 } : id === 'program' ? {} : { initialWidth: 320 }),
  })
  return id === 'timeline' ? added : tabIntoReferenceWhenTooNarrow(api, added, reference?.group, shortfallBefore)
}

/**
 * 浮动面板贴回主区域时落到它的默认方位（与 showVideoEditPanel 一致）：时间线在节目画面下方，项目在左、源监视器并入节目画面那一组，
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
  return { group: reference, position: id === 'timeline' ? 'bottom' : id === 'source' && reference === program ? 'center' : id === 'project' || id === 'source' ? 'left' : 'right' }
}

export function dockVideoEditPanel(api: DockviewApi, panel: IDockviewPanel): void {
  const target = defaultDockTarget(api, panel.id, panel.group)
  if (target) {
    const shortfallBefore = widthShortfall(api)
    panel.api.moveTo(target)
    if (target.position === 'left' || target.position === 'right') tabIntoReferenceWhenTooNarrow(api, panel, target.group, shortfallBefore)
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
  const base = { id, component: id, title: definition.title, renderer: 'always' as const, ...workspacePanelConstraints(VIDEO_EDIT_PANELS, id) }
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
