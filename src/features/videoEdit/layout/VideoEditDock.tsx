import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { DockviewReact, type DockviewApi, type DockviewReadyEvent, type IWatermarkPanelProps, type IDockviewPanelProps } from 'dockview-react'
import 'dockview-react/dist/styles/dockview.css'
import { UiButton, UiEmpty } from '@/components/ui'
import { createLogger } from '@/core/logging'
import { focusVideoEditPanel, listVideoEditInstances, subscribeVideoEditView, type VideoEditInstance } from '../application/videoEditService'
import { VideoEditPreview } from '../VideoEditPreview'
import { VideoEditTimeline } from '../VideoEditTimeline'
import { VideoEditProjectPanel } from '../panels/VideoEditProjectPanel'
import { VideoEditEffectsPanel } from '../panels/VideoEditEffectsPanel'
import { VideoEditSourcePanel } from '../panels/VideoEditSourcePanel'
import { VideoEditTimedContentPanel } from '../panels/VideoEditTimedContentPanel'
import { readVideoEditSource, subscribeVideoEditSource } from '../application/videoEditSource'
import { VideoEditDockHeaderActions, VideoEditDockTab } from './VideoEditDockChrome'
import { restoreVideoEditLayout, saveVideoEditLayout, showVideoEditPanel, VIDEO_EDIT_PANELS, type VideoEditPanelId } from './videoEditDockLayout'
import { bindVideoEditPopoutDock, isVideoEditPanelPoppedOut, listVideoEditPopouts, resetVideoEditWorkspaceLayout, restoreVideoEditPopouts, trackVideoEditDockPanel } from './popout/videoEditPopouts'
import { VideoEditPopoutPortals } from './popout/VideoEditPopoutPortals'

const logger = createLogger('features.videoEdit.layout')
interface DockContext { instance: VideoEditInstance; onError: (reason: unknown) => void }
const Context = createContext<DockContext | null>(null)
function useDock(): DockContext { const value = useContext(Context); if (!value) throw new Error('剪辑面板宿主尚未就绪'); return value }
type PanelBody = (props: { visible: boolean }) => React.ReactElement
/** 面板内容只有这一份：Dock 与系统浮窗共用，浮窗只是换挂载点。 */
function ProjectBody({ visible }: { visible: boolean }): React.ReactElement { return <div className="h-full min-h-0" data-video-edit-panel="project"><VideoEditProjectPanel {...useDock()} visible={visible} /></div> }
function EffectsBody({ visible }: { visible: boolean }): React.ReactElement { return <div className="h-full min-h-0" data-video-edit-panel="effects"><VideoEditEffectsPanel {...useDock()} visible={visible} /></div> }
function ProgramBody({ visible }: { visible: boolean }): React.ReactElement { return <div className="flex h-full min-h-0 flex-col" data-video-edit-panel="program"><VideoEditPreview {...useDock()} visible={visible} /></div> }
function TimelineBody({ visible }: { visible: boolean }): React.ReactElement { return <div className="flex h-full min-h-0 flex-col" data-video-edit-panel="timeline"><VideoEditTimeline {...useDock()} visible={visible} /></div> }
function ContentBody({ visible }: { visible: boolean }): React.ReactElement { return <div className="h-full min-h-0" data-video-edit-panel="content"><VideoEditTimedContentPanel {...useDock()} visible={visible} /></div> }
function SourceBody({ visible }: { visible: boolean }): React.ReactElement { return <div className="h-full min-h-0" data-video-edit-panel="source"><VideoEditSourcePanel {...useDock()} visible={visible} /></div> }
const BODIES: Record<VideoEditPanelId, PanelBody> = { project: ProjectBody, effects: EffectsBody, program: ProgramBody, timeline: TimelineBody, content: ContentBody, source: SourceBody }
function dockPanel(id: VideoEditPanelId, Body: PanelBody): (props: IDockviewPanelProps) => React.ReactElement {
  return function DockPanel({ api }: IDockviewPanelProps): React.ReactElement {
    const [visible, setVisible] = useState(api.isVisible)
    useEffect(() => trackVideoEditDockPanel(id), [])
    useEffect(() => { const event = api.onDidVisibilityChange(value => setVisible(value.isVisible)); return () => event.dispose() }, [api])
    return <Body visible={visible} />
  }
}
const COMPONENTS = Object.fromEntries(VIDEO_EDIT_PANELS.map(({ id }) => [id, dockPanel(id, BODIES[id])])) as Record<VideoEditPanelId, (props: IDockviewPanelProps) => React.ReactElement>
function EmptyLayout({ containerApi }: IWatermarkPanelProps): React.ReactElement {
  return <UiEmpty className="h-full" title="选择需要的面板" description="在顶部面板菜单中恢复视图。" action={<UiButton variant="secondary" onClick={() => resetVideoEditWorkspaceLayout(containerApi)}>重置布局</UiButton>} />
}

export function VideoEditDock({ instance, onError, onApiChange }: DockContext & { onApiChange: (api: DockviewApi | null) => void }): React.ReactElement {
  const apiRef = useRef<DockviewApi | null>(null)
  const disposeRef = useRef<() => void>(() => {})
  useEffect(() => {
    let previous = instance.panelFocusVersion ?? 0
    return subscribeVideoEditView(() => {
      const current = instance.panelFocusVersion ?? 0
      if (current === previous) return
      previous = current
      if (isVideoEditPanelPoppedOut(instance.activePanel)) listVideoEditPopouts().find(entry => entry.id === instance.activePanel)?.popout.focus()
      else if (apiRef.current) showVideoEditPanel(apiRef.current, instance.activePanel)
    })
  }, [instance])
  useEffect(() => subscribeVideoEditSource(() => {
    if (!listVideoEditInstances().some(value => value.document.id === instance.document.id)) return
    const source = readVideoEditSource(instance.document.id)
    if (source.status === 'loading' && source.itemId && apiRef.current) showVideoEditPanel(apiRef.current, 'source')
  }), [instance.document.id])
  const onReady = useCallback(({ api }: DockviewReadyEvent): void => {
    disposeRef.current()
    apiRef.current = api
    restoreVideoEditLayout(api)
    bindVideoEditPopoutDock(api)
    // Dock 只在工程已打开时挂载：此时恢复上次浮出的面板，没有工程时不会弹窗。
    restoreVideoEditPopouts(api)
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
    const focus = api.onDidActivePanelChange(value => {
      const panel = value.panel?.id
      if (panel && ['project', 'source', 'program', 'timeline', 'effects', 'content'].includes(panel) && instance.activePanel !== panel && listVideoEditInstances().includes(instance)) focusVideoEditPanel(instance.document.id, panel as VideoEditInstance['activePanel'])
    })
    disposeRef.current = () => { event.dispose(); focus.dispose(); if (timer !== undefined) save() }
  }, [onApiChange, onError, instance])
  useEffect(() => () => { bindVideoEditPopoutDock(null); disposeRef.current(); apiRef.current = null; onApiChange(null) }, [onApiChange])
  return <Context.Provider value={{ instance, onError }}>
    {/* isolate：dockview 分隔条自带 z-index 99，不隔离会漏到根层叠上下文、压在 body 下的弹窗（z-modal）之上，窄窗口时挡住弹窗按钮 */}
    <DockviewReact className="henji-cameraStage-dock henji-videoEdit-dock dockview-theme-abyss isolate h-full min-h-0 w-full" components={COMPONENTS}
      defaultTabComponent={VideoEditDockTab} rightHeaderActionsComponent={VideoEditDockHeaderActions} watermarkComponent={EmptyLayout}
      dndStrategy="pointer" floatingGroupBounds="boundedWithinViewport" floatingGroupDragHandle="tabbar" defaultRenderer="always" onReady={onReady} />
    <VideoEditPopoutPortals onFocusPanel={id => { if (instance.activePanel !== id && listVideoEditInstances().includes(instance)) focusVideoEditPanel(instance.document.id, id) }}
      render={(id, visible) => { const Body = BODIES[id]; return <Body visible={visible} /> }} />
  </Context.Provider>
}
