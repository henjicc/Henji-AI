import { Orientation, type SerializedDockview } from 'dockview-react'
import { createLogger } from '@/core/logging'
import { registerWorkspaceLayout } from '@/services/workspaceLayouts/workspaceLayoutService'
import { openAssistant } from '@/features/assistant'

const logger = createLogger('features.audioEdit.layout')
export const AUDIO_EDIT_WORKSPACE_ID = 'audio_edit'
/** 接入共享布局服务之前的本机布局，首次加载时只读迁入。 */
const AUDIO_EDIT_LAYOUT_STORAGE_KEY = 'henji.audioEdit.dockLayout.v1'

/** 面板与最小尺寸（重要记录 020）：三栏布局在 960×640 下放得下（240 + 440 + 240），由尺寸扫描核对；编辑器 440 时播放条连同“更多”放得下。 */
const SIDE_MIN = { minimumWidth: 240, minimumHeight: 120 } as const
export const AUDIO_EDIT_PANELS = [
  { id: 'editor', title: '编辑器', minimumWidth: 440, minimumHeight: 200 },
  { id: 'transcript', title: '文字稿', minimumWidth: 240, minimumHeight: 160 },
  { id: 'process', title: '处理', ...SIDE_MIN },
  { id: 'effects', title: '效果组', ...SIDE_MIN },
  { id: 'selection', title: '选区', ...SIDE_MIN },
  { id: 'history', title: '历史记录', ...SIDE_MIN },
  { id: 'delivery', title: '交付', ...SIDE_MIN },
] as const
export type AudioEditPanelId = typeof AUDIO_EDIT_PANELS[number]['id']
const TITLES = Object.fromEntries(AUDIO_EDIT_PANELS.map(panel => [panel.id, panel.title])) as Record<AudioEditPanelId, string>

type Leaf = { size: number; views: AudioEditPanelId[]; id: string }
type Node = { type: 'leaf'; size: number; data: { id: string; views: string[]; activeView: string } } | { type: 'branch'; size: number; data: Node[] }
const leaf = ({ size, views, id }: Leaf): Node => ({ type: 'leaf', size, data: { id, views, activeView: views[0] } })
const branch = (size: number, ...data: Node[]): Node => ({ type: 'branch', size, data })

function layout(root: Node): SerializedDockview {
  const panels = Object.fromEntries(AUDIO_EDIT_PANELS.map(({ id, title }) => [id, { id, contentComponent: id, title, renderer: 'always' as const }]))
  return { grid: { width: 1440, height: 860, orientation: Orientation.HORIZONTAL, root: root as SerializedDockview['grid']['root'] }, panels, activeGroup: 'editor-group' }
}

/**
 * 内置布局预设（参照 Audition 的“工作区”）：
 * - 经典：左边文字稿与处理，中间编辑器，右边效果组、交付在上，选区、历史在下；
 * - 口播：文字稿占左边一大栏，用文字剪、右边同步看波形；
 * - 专注：编辑器最大，次要面板收进右侧和底部标签页。
 */
export const AUDIO_EDIT_LAYOUT_PRESETS = [
  { id: 'classic', name: '经典', layout: () => layout(branch(1440,
    leaf({ id: 'left-group', size: 280, views: ['transcript', 'process'] }),
    leaf({ id: 'editor-group', size: 880, views: ['editor'] }),
    branch(280,
      leaf({ id: 'effects-group', size: 480, views: ['effects', 'delivery'] }),
      leaf({ id: 'info-group', size: 380, views: ['selection', 'history'] })),
  )) },
  { id: 'voice', name: '口播', layout: () => layout(branch(1440,
    leaf({ id: 'left-group', size: 460, views: ['transcript'] }),
    leaf({ id: 'editor-group', size: 700, views: ['editor'] }),
    leaf({ id: 'right-group', size: 280, views: ['process', 'effects', 'delivery', 'selection', 'history'] }),
  )) },
  { id: 'focus', name: '专注', layout: () => layout(branch(1440,
    branch(1160,
      leaf({ id: 'editor-group', size: 640, views: ['editor'] }),
      leaf({ id: 'bottom-group', size: 220, views: ['transcript', 'history', 'selection'] })),
    leaf({ id: 'right-group', size: 280, views: ['effects', 'process', 'delivery'] }),
  )) },
] as const

/** 校验保存过的布局：只认识本工作区的面板，每个面板恰好出现一次；不对就退回默认。 */
export function parseAudioEditLayout(raw: string): SerializedDockview {
  const value = JSON.parse(raw) as SerializedDockview
  if (!value?.grid?.root || !value.panels || value.popoutGroups?.length || value.floatingGroups?.length) throw new Error('不支持的音频编辑布局')
  const seen = new Set<string>()
  const visit = (node: Node): void => {
    if (node.type === 'leaf') { for (const id of node.data.views) { if (!(id in TITLES) || seen.has(id)) throw new Error('无效的音频编辑面板'); seen.add(id) } return }
    node.data.forEach(visit)
  }
  visit(value.grid.root as Node)
  if (!seen.has('editor')) throw new Error('布局里没有编辑器')
  for (const [id, panel] of Object.entries(value.panels)) {
    if (!(id in TITLES)) throw new Error('无效的音频编辑面板')
    // 面板名以当前定义为准，旧布局里存的名称不再沿用。
    panel.title = TITLES[id as AudioEditPanelId]
    panel.renderer = 'always'
  }
  return value
}

/** 布局预设走共享的工作区布局服务（与剪辑、3D 镜头参考、图片编辑同一套：另存、改名、删除、重置、助手读写）。 */
export const audioEditLayoutPresets = registerWorkspaceLayout({
  workspaceId: AUDIO_EDIT_WORKSPACE_ID,
  panels: AUDIO_EDIT_PANELS,
  builtinPresets: AUDIO_EDIT_LAYOUT_PRESETS.map(preset => ({ id: preset.id, name: preset.name, layout: preset.layout() })),
  validate: (layout) => { parseAudioEditLayout(JSON.stringify(layout)) },
  readLegacy: () => {
    try { const raw = localStorage.getItem(AUDIO_EDIT_LAYOUT_STORAGE_KEY); return raw ? parseAudioEditLayout(raw) : undefined }
    catch (error) { logger.warn('旧的音频编辑布局无效，改用默认布局', { event: 'audio_edit.layout.legacy_invalid', error }); return undefined }
  },
  // 打开音频不再自动开助手（助手开关沿用用户上次的状态）；只有主动切到“口播”布局时，顺带打开助手处理口播。
  onApply: (presetId) => { if (presetId === 'voice') openAssistant() },
})
