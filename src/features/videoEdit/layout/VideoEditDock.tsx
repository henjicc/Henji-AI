import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { DockviewReact, type DockviewApi, type DockviewReadyEvent, type IWatermarkPanelProps, type IDockviewPanelProps } from 'dockview-react'
import 'dockview-react/dist/styles/dockview.css'
import { UiButton, UiEmpty } from '@/components/ui'
import { createLogger } from '@/core/logging'
import { listVideoEditInstances, type VideoEditInstance } from '../application/videoEditService'
import { VideoEditPreview } from '../VideoEditPreview'
import { VideoEditTimeline } from '../VideoEditTimeline'
import { VideoEditProjectPanel } from '../panels/VideoEditProjectPanel'
import { VideoEditEffectsPanel } from '../panels/VideoEditEffectsPanel'
import { VideoEditSourcePanel } from '../panels/VideoEditSourcePanel'
import { VideoEditSequenceTabs } from '../panels/VideoEditSequenceTabs'
import { readVideoEditSource, subscribeVideoEditSource } from '../application/videoEditSource'
import { VideoEditDockHeaderActions, VideoEditDockTab } from './VideoEditDockChrome'
import { resetVideoEditLayout, restoreVideoEditLayout, saveVideoEditLayout, showVideoEditPanel } from './videoEditDockLayout'

const logger = createLogger('features.videoEdit.layout')
interface DockContext { instance: VideoEditInstance; onError: (reason: unknown) => void }
const Context = createContext<DockContext | null>(null)
function useDock(): DockContext { const value = useContext(Context); if (!value) throw new Error('剪辑面板宿主尚未就绪'); return value }
function Project({ api }: IDockviewPanelProps): React.ReactElement {
  const [visible, setVisible] = useState(api.isVisible)
  useEffect(() => { const event = api.onDidVisibilityChange(value => setVisible(value.isVisible)); return () => event.dispose() }, [api])
  return <VideoEditProjectPanel {...useDock()} visible={visible} />
}
function Effects(): React.ReactElement { return <VideoEditEffectsPanel {...useDock()} /> }
function Program(): React.ReactElement { return <div className="flex h-full min-h-0 flex-col" data-video-edit-panel="program"><VideoEditPreview {...useDock()} /></div> }
function Timeline(): React.ReactElement { const context = useDock(); return <div className="flex h-full min-h-0 flex-col" data-video-edit-panel="timeline"><VideoEditSequenceTabs {...context} /><VideoEditTimeline {...context} /></div> }
function Source({ api }: IDockviewPanelProps): React.ReactElement {
  const [visible, setVisible] = useState(api.isVisible)
  useEffect(() => { const event = api.onDidVisibilityChange(value => setVisible(value.isVisible)); return () => event.dispose() }, [api])
  return <VideoEditSourcePanel {...useDock()} visible={visible} />
}
const COMPONENTS = { project: Project, program: Program, effects: Effects, timeline: Timeline, source: Source }
function EmptyLayout({ containerApi }: IWatermarkPanelProps): React.ReactElement {
  return <UiEmpty className="h-full" title="选择需要的面板" description="在顶部面板菜单中恢复视图。" action={<UiButton variant="ghost" onClick={() => resetVideoEditLayout(containerApi)}>重置布局</UiButton>} />
}

export function VideoEditDock({ instance, onError, onApiChange }: DockContext & { onApiChange: (api: DockviewApi | null) => void }): React.ReactElement {
  const apiRef = useRef<DockviewApi | null>(null)
  const disposeRef = useRef<() => void>(() => {})
  useEffect(() => subscribeVideoEditSource(() => {
    if (!listVideoEditInstances().some(value => value.document.id === instance.document.id)) return
    const source = readVideoEditSource(instance.document.id)
    if (source.status === 'loading' && source.itemId && apiRef.current) showVideoEditPanel(apiRef.current, 'source')
  }), [instance.document.id])
  const onReady = useCallback(({ api }: DockviewReadyEvent): void => {
    disposeRef.current()
    apiRef.current = api
    restoreVideoEditLayout(api)
    onApiChange(api)
    let timer: ReturnType<typeof setTimeout> | undefined
    let failed = false
    const save = (): void => {
      clearTimeout(timer); timer = undefined
      try { saveVideoEditLayout(api); failed = false } catch (error) {
        if (!failed) { logger.warn('剪辑面板布局保存失败', { event: 'video_edit.layout.save.failed', error }); onError(new Error('面板布局未能保存，下次打开时将恢复原布局。')) }
        failed = true
      }
    }
    const event = api.onDidLayoutChange(() => { clearTimeout(timer); timer = setTimeout(save, 200) })
    disposeRef.current = () => { event.dispose(); if (timer !== undefined) save() }
  }, [onApiChange, onError])
  useEffect(() => () => { disposeRef.current(); apiRef.current = null; onApiChange(null) }, [onApiChange])
  return <Context.Provider value={{ instance, onError }}>
    <DockviewReact className="henji-cameraStage-dock dockview-theme-abyss h-full min-h-0 w-full" components={COMPONENTS}
      defaultTabComponent={VideoEditDockTab} rightHeaderActionsComponent={VideoEditDockHeaderActions} watermarkComponent={EmptyLayout}
      dndStrategy="pointer" floatingGroupBounds="boundedWithinViewport" floatingGroupDragHandle="tabbar" defaultRenderer="always" onReady={onReady} />
  </Context.Provider>
}
