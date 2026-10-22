import React, { useCallback, useEffect, useRef, useState } from 'react'
import { DockviewReact, type DockviewApi, type DockviewReadyEvent, type IDockviewHeaderActionsProps, type IDockviewPanelHeaderProps, type IDockviewPanelProps } from 'dockview-react'
import 'dockview-react/dist/styles/dockview.css'
import { DockviewHost } from '@/components/DockviewHost'
import { dockviewHostTheme } from '@/components/dockviewHostTheme'
import { bindDockDragGestures, dockFloatingGroupsBack, DOCKVIEW_HOST_DND_OPTIONS } from '@/components/dockviewDocking'
import { AudioWaveToolbar, AudioWaveWorkspace } from '../spectral/AudioWaveWorkspace'
import { useAudioEditWorkspace } from './audioEditWorkspaceContext'
import { AudioEditDeliveryPanel, AudioEditEffectsPanel, AudioEditHistoryPanel, AudioEditProcessPanel, AudioEditSelectionPanel, AudioEditTranscriptPanel } from './AudioEditPanels'
import { bindWorkspaceLayoutDock } from '@/components/dockLayouts/useWorkspaceLayoutPresets'
import { createLogger } from '@/core/logging'
import { AUDIO_EDIT_WORKSPACE_ID } from './audioEditDockLayout'

const logger = createLogger('features.audioEdit.layout')

/**
 * 音频编辑停靠工作区：编辑器、文字稿、处理、效果组、选区、历史、交付七个面板，和剪辑、3D 镜头参考共用同一套
 * dockview 宿主（拖拽重排、合并标签、调整大小，布局记住）。面板内容从工作区上下文读写，挪到哪里行为都一样。
 */
const AUDIO_EDIT_DOCK_THEME = dockviewHostTheme('henji-cameraStage-dock henji-videoEdit-dock', 4)
const panel = (Body: () => React.ReactElement): React.FC<IDockviewPanelProps> => function AudioEditDockPanel() { return <div className="h-full min-h-0"><Body /></div> }
const COMPONENTS = {
  editor: panel(AudioWaveWorkspace),
  transcript: panel(AudioEditTranscriptPanel),
  process: panel(AudioEditProcessPanel),
  effects: panel(AudioEditEffectsPanel),
  selection: panel(AudioEditSelectionPanel),
  history: panel(AudioEditHistoryPanel),
  delivery: panel(AudioEditDeliveryPanel),
}

function DockTab(props: IDockviewPanelHeaderProps): React.ReactElement {
  const [title, setTitle] = useState(props.api.title ?? '')
  useEffect(() => { const disposable = props.api.onDidTitleChange((event) => setTitle(event.title)); return () => disposable.dispose() }, [props.api])
  return <span className="px-2 text-xs">{title}</span>
}

/**
 * 编辑器面板的工具（编辑工具、显示方式、选区操作）放在它自己的标签行右侧：顶部命令带只剩一行，
 * 标签行也不再空着；工具随编辑器面板走，叠放时只在编辑器是当前标签时出现。
 */
function DockHeaderActions({ group }: IDockviewHeaderActionsProps): React.ReactElement | null {
  const workspace = useAudioEditWorkspace()
  const [editor, setEditor] = useState(group.activePanel?.id === 'editor')
  useEffect(() => {
    setEditor(group.activePanel?.id === 'editor')
    const disposable = group.api.onDidActivePanelChange(() => setEditor(group.activePanel?.id === 'editor'))
    return () => disposable.dispose()
  }, [group])
  if (!editor) return null
  return <div className="flex h-full min-w-0 items-center pr-1" data-audio-edit-editor-tools>
    <AudioWaveToolbar editor={workspace.wave} selection={workspace.waveSelection} disabled={workspace.disabled} actions={workspace.waveActions} onEditSelection={workspace.editSelection} />
  </div>
}

export function AudioEditDock({ onReady }: { onReady?: (api: DockviewApi) => void }): React.ReactElement {
  const host = useRef<HTMLDivElement | null>(null)
  const unbind = useRef<() => void>(() => {})
  const ready = useRef(onReady)
  ready.current = onReady
  const handleReady = useCallback((event: DockviewReadyEvent) => {
    unbind.current()
    const gestures = host.current ? bindDockDragGestures(event.api, { root: host.current }) : () => {}
    const layout = bindWorkspaceLayoutDock(AUDIO_EDIT_WORKSPACE_ID, event.api, {
      afterApply: () => dockFloatingGroupsBack(event.api, (group) => group.api.moveTo({ position: 'right' })),
      onError: (error) => logger.warn('音频编辑布局恢复或保存失败', { event: 'audio_edit.layout.failed', error }),
    })
    unbind.current = () => { gestures(); layout() }
    ready.current?.(event.api)
  }, [])
  useEffect(() => () => unbind.current(), [])
  return <DockviewHost ref={host} className="h-full w-full">
    <DockviewReact className="henji-cameraStage-dock dockview-theme-abyss" theme={AUDIO_EDIT_DOCK_THEME} components={COMPONENTS} defaultTabComponent={DockTab} rightHeaderActionsComponent={DockHeaderActions} {...DOCKVIEW_HOST_DND_OPTIONS} onReady={handleReady} />
  </DockviewHost>
}
