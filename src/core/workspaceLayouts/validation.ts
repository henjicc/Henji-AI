import { Orientation, type SerializedDockview } from 'dockview-react'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function finitePositive(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value > 0 }

/** 在进入 Dockview 前拒绝未知面板、重复引用和系统浮窗状态。 */
export function parseWorkspaceDockLayout(raw: string, definitions: readonly { id: string; title?: string }[]): SerializedDockview {
  const value: unknown = JSON.parse(raw)
  if (!isRecord(value) || !isRecord(value.grid) || !isRecord(value.panels) || value.popoutGroups !== undefined || value.edgeGroups !== undefined) throw new Error('不支持的工作区布局')
  const { grid, panels } = value
  if (typeof grid.width !== 'number' || !Number.isFinite(grid.width) || grid.width < 0 || typeof grid.height !== 'number' || !Number.isFinite(grid.height) || grid.height < 0 || ![Orientation.HORIZONTAL, Orientation.VERTICAL].includes(grid.orientation as Orientation)) throw new Error('无效的布局尺寸')
  const known = new Set<string>(definitions.map(panel => panel.id))
  for (const [id, panel] of Object.entries(panels)) {
    if (!known.has(id) || !isRecord(panel) || panel.id !== id || panel.contentComponent !== id) throw new Error('无效的工作区面板')
    // 非活动标签仍保留唯一挂载实例，避免重建预览会话。
    panel.renderer = 'always'
    // 面板名以当前定义为准：保存过的布局里可能还是旧名称（如“项目素材”改称“素材”之前保存的）。
    const title = definitions.find(definition => definition.id === id)?.title
    if (title !== undefined) panel.title = title
  }
  const seen = new Set<string>()
  const groups = new Set<string>()
  const checkGroup = (group: unknown): void => {
    if (!isRecord(group) || typeof group.id !== 'string' || groups.has(group.id) || !Array.isArray(group.views)) throw new Error('无效的面板分组')
    groups.add(group.id)
    for (const id of group.views) {
      if (typeof id !== 'string' || !known.has(id) || seen.has(id) || !panels[id]) throw new Error('重复或缺失的工作区面板')
      seen.add(id)
    }
    if (group.activeView !== undefined && !group.views.includes(group.activeView)) throw new Error('无效的活动面板')
  }
  const checkNode = (node: unknown, depth = 0): void => {
    if (!isRecord(node) || depth > 8 || (node.size !== undefined && (typeof node.size !== 'number' || !Number.isFinite(node.size) || node.size < 0))) throw new Error('无效的布局节点')
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
  if (value.activeGroup !== undefined && (typeof value.activeGroup !== 'string' || !groups.has(value.activeGroup))) throw new Error('无效的活动分组')
  if (seen.size !== Object.keys(panels).length) throw new Error('布局含有未挂载面板')
  return value as unknown as SerializedDockview
}
