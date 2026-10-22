import React, { useCallback, useEffect, useRef, useState } from 'react'
import { DockviewReact, type DockviewApi, type DockviewReadyEvent, type IDockviewPanelHeaderProps, type IDockviewPanelProps } from 'dockview-react'
import 'dockview-react/dist/styles/dockview.css'
import { DockviewHost } from '@/components/DockviewHost'
import { dockviewHostTheme } from '@/components/dockviewHostTheme'
import { bindDockDragGestures, dockFloatingGroupsBack, DOCKVIEW_HOST_DND_OPTIONS } from '@/components/dockviewDocking'
import { AudioWaveWorkspace } from '../spectral/AudioWaveWorkspace'
import { AudioEditDeliveryPanel, AudioEditEffectsPanel, AudioEditHistoryPanel, AudioEditProcessPanel, AudioEditSelectionPanel, AudioEditTranscriptPanel } from './AudioEditPanels'
import { restoreAudioEditLayout, saveAudioEditLayout } from './audioEditDockLayout'

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

export function AudioEditDock({ onReady }: { onReady?: (api: DockviewApi) => void }): React.ReactElement {
  const host = useRef<HTMLDivElement | null>(null)
  const unbind = useRef<() => void>(() => {})
  const ready = useRef(onReady)
  ready.current = onReady
  const handleReady = useCallback((event: DockviewReadyEvent) => {
    restoreAudioEditLayout(event.api)
    dockFloatingGroupsBack(event.api, (group) => group.api.moveTo({ position: 'right' }))
    unbind.current()
    unbind.current = host.current ? bindDockDragGestures(event.api, { root: host.current }) : () => {}
    event.api.onDidLayoutChange(() => saveAudioEditLayout(event.api))
    ready.current?.(event.api)
  }, [])
  useEffect(() => () => unbind.current(), [])
  return <DockviewHost ref={host} className="h-full w-full">
    <DockviewReact className="henji-cameraStage-dock dockview-theme-abyss" theme={AUDIO_EDIT_DOCK_THEME} components={COMPONENTS} defaultTabComponent={DockTab} {...DOCKVIEW_HOST_DND_OPTIONS} onReady={handleReady} />
  </DockviewHost>
}
