import { VideoEditAnnotationsPanel } from '../panels/VideoEditAnnotationsPanel'
import { VideoEditStyleKitsPanel } from '../panels/VideoEditStyleKitsPanel'
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { DockviewReact, type DockviewApi, type DockviewReadyEvent, type IWatermarkPanelProps, type IDockviewPanelProps } from 'dockview-react'
import 'dockview-react/dist/styles/dockview.css'
import { UiButton, UiEmpty } from '@/components/ui'
import { createLogger } from '@/core/logging'
import { VIDEO_EDIT_FOCUSABLE_PANELS } from '@/core/videoEdit/panels'
import { focusVideoEditPanel, listVideoEditInstances, subscribeVideoEditView, type VideoEditInstance } from '../application/videoEditService'
import { VideoEditPreview } from '../VideoEditPreview'
import { VideoEditTimeline } from '../VideoEditTimeline'
import { VideoEditProjectPanel } from '../panels/VideoEditProjectPanel'
import { VideoEditTrackingPanel } from '../panels/VideoEditTrackingPanel'
import { VideoEditColorGradePanel } from '../panels/VideoEditColorGradePanel'
import { VideoEditEffectsPanel } from '../panels/VideoEditEffectsPanel'
import { VideoEditSourcePanel } from '../panels/VideoEditSourcePanel'
import { VideoEditTimedContentPanel } from '../panels/VideoEditTimedContentPanel'
import { VideoEditEffectsLibraryPanel } from '../panels/VideoEditEffectsLibraryPanel'
import { VideoEditTitleTemplatesPanel } from '../panels/VideoEditTitleTemplatesPanel'
import { readVideoEditSource, subscribeVideoEditSource } from '../application/videoEditSource'
import { DockviewHost } from '@/components/DockviewHost'
import { dockviewHostTheme } from '@/components/dockviewHostTheme'
import { bindDockDragGestures, dockFloatingGroupsBack, DOCKVIEW_HOST_DND_OPTIONS } from '@/components/dockviewDocking'
import { VideoEditDockHeaderActions, VideoEditDockTab } from './VideoEditDockChrome'
import { dockVideoEditGroup, restoreVideoEditLayout, saveVideoEditLayout, showVideoEditPanel, VIDEO_EDIT_PANELS, type VideoEditPanelId } from './videoEditDockLayout'
import { bindVideoEditPopoutDock, canFloatVideoEditDockSource, floatVideoEditDockSource, focusVideoEditPopoutPanel, isVideoEditPanelPoppedOut, listVideoEditPopouts, resetVideoEditWorkspaceLayout, restoreVideoEditPopouts, trackVideoEditDockPanel } from './popout/videoEditPopouts'
import { VideoEditPopoutPortals } from './popout/VideoEditPopoutPortals'

const logger = createLogger('features.videoEdit.layout')
interface DockContext { instance: VideoEditInstance; onError: (reason: unknown) => void; onEffectsAdded?: (effectIds: readonly string[]) => void }
const Context = createContext<DockContext | null>(null)
function useDock(): DockContext { const value = useContext(Context); if (!value) throw new Error('剪辑面板宿主尚未就绪'); return value }
type PanelBody = (props: { visible: boolean }) => React.ReactElement
/** 面板内容只有这一份：Dock 与系统浮窗共用，浮窗只是换挂载点。 */
function ProjectBody({ visible }: { visible: boolean }): React.ReactElement { return <div className="h-full min-h-0" data-video-edit-panel="project"><VideoEditProjectPanel {...useDock()} visible={visible} /></div> }
function EffectsBody({ visible }: { visible: boolean }): React.ReactElement { return <div className="h-full min-h-0"><VideoEditEffectsPanel {...useDock()} visible={visible} /></div> }
function ProgramBody({ visible }: { visible: boolean }): React.ReactElement { return <div className="flex h-full min-h-0 flex-col" data-video-edit-panel="program"><VideoEditPreview {...useDock()} visible={visible} /></div> }
function TimelineBody({ visible }: { visible: boolean }): React.ReactElement { return <div className="flex h-full min-h-0 flex-col" data-video-edit-panel="timeline"><VideoEditTimeline {...useDock()} visible={visible} /></div> }
function ContentBody({ visible }: { visible: boolean }): React.ReactElement { return <div className="h-full min-h-0" data-video-edit-panel="content"><VideoEditTimedContentPanel {...useDock()} visible={visible} /></div> }
function EffectsLibraryBody({ visible }: { visible: boolean }): React.ReactElement { return <div className="h-full min-h-0" data-video-edit-panel="effects_library"><VideoEditEffectsLibraryPanel {...useDock()} visible={visible} /></div> }
function SourceBody({ visible }: { visible: boolean }): React.ReactElement { return <div className="h-full min-h-0"><VideoEditSourcePanel {...useDock()} visible={visible} /></div> }
/** 面板之间露 4px 间隙（参照 PR 的深色边），当前面板组描强调色边，见 index.css 剪辑工作区一节。 */
const VIDEO_EDIT_DOCK_THEME = dockviewHostTheme('henji-cameraStage-dock henji-videoEdit-dock', 4)
function TrackingBody({ visible }: { visible: boolean }): React.ReactElement { return <div className="h-full min-h-0" data-video-edit-panel="tracking"><VideoEditTrackingPanel {...useDock()} visible={visible} /></div> }
function ColorGradeBody({ visible }: { visible: boolean }): React.ReactElement { return <div className="h-full min-h-0" data-video-edit-panel="color_grade"><VideoEditColorGradePanel {...useDock()} visible={visible} /></div> }
function TitleTemplatesBody({ visible }: { visible: boolean }): React.ReactElement { return <div className="h-full min-h-0" data-video-edit-panel="title_templates"><VideoEditTitleTemplatesPanel {...useDock()} visible={visible} /></div> }
function AnnotationsBody({ visible }: { visible: boolean }): React.ReactElement { return <div className="h-full min-h-0" data-video-edit-panel="annotations"><VideoEditAnnotationsPanel {...useDock()} visible={visible} /></div> }
function StyleKitsBody({ visible }: { visible: boolean }): React.ReactElement { return <div className="h-full min-h-0" data-video-edit-panel="style_kits"><VideoEditStyleKitsPanel {...useDock()} visible={visible} /></div> }
const BODIES: Record<VideoEditPanelId, PanelBody> = { style_kits: StyleKitsBody, annotations: AnnotationsBody, title_templates: TitleTemplatesBody, color_grade: ColorGradeBody, tracking: TrackingBody, project: ProjectBody, effects: EffectsBody, program: ProgramBody, timeline: TimelineBody, content: ContentBody, source: SourceBody, effects_library: EffectsLibraryBody }
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
  const hostRef = useRef<HTMLDivElement | null>(null)
  const disposeRef = useRef<() => void>(() => {})
  const [addedEffects, setAddedEffects] = useState<readonly string[]>([])
  const onEffectsAdded = useCallback((effectIds: readonly string[]): void => {
    const popout = listVideoEditPopouts().find(entry => entry.panels.includes('effects'))
    if (popout) {
      if (!popout.visible || popout.active !== 'effects') focusVideoEditPopoutPanel('effects')
    } else if (apiRef.current && !apiRef.current.getPanel('effects')?.api.isVisible) {
      showVideoEditPanel(apiRef.current, 'effects')
    }
    setAddedEffects(effectIds)
  }, [])
  useEffect(() => {
    if (!addedEffects.length) return
    // 等面板激活与领域更新提交到 DOM；只滚动内容，不改变已可见面板的焦点或停靠位置。
    let frame = requestAnimationFrame(() => {
      const root = listVideoEditPopouts().find(entry => entry.panels.includes('effects'))?.popout.container ?? hostRef.current
      const panel = root?.querySelector('[data-video-edit-panel="effects"]')
      const section = panel?.querySelector('[data-video-edit-effect-section="effects"]')
      const collapsedSection = Array.from(section?.querySelectorAll<HTMLElement>('button[aria-expanded="false"]') ?? []).find(item => !item.closest('[data-video-edit-effect-chain]'))
      collapsedSection?.click()
      frame = requestAnimationFrame(() => {
        const effect = Array.from(panel?.querySelectorAll<HTMLElement>('[data-video-edit-effect]') ?? []).find(item => addedEffects.includes(item.dataset.videoEditEffect ?? ''))
        effect?.scrollIntoView({ block: 'nearest' })
      })
    })
    return () => cancelAnimationFrame(frame)
  }, [addedEffects])
  useEffect(() => {
    let previous = instance.panelFocusVersion ?? 0
    return subscribeVideoEditView(() => {
      const current = instance.panelFocusVersion ?? 0
      if (current === previous) return
      previous = current
      if (isVideoEditPanelPoppedOut(instance.activePanel)) focusVideoEditPopoutPanel(instance.activePanel)
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
    // 应用内浮动组已不是入口（重要记录 001）：旧布局里的浮动组恢复后贴回默认方位。
    dockFloatingGroupsBack(api, group => dockVideoEditGroup(api, group))
    const root = hostRef.current
    bindVideoEditPopoutDock(api, window, root)
    const unbindGestures = root ? bindDockDragGestures(api, { root, canFloat: canFloatVideoEditDockSource, float: (source, at) => floatVideoEditDockSource(api, source, at) }) : () => {}
    // Dock 只在剪辑已打开时挂载：此时恢复上次浮出的面板，没有剪辑时不会弹窗。
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
      if (panel && (VIDEO_EDIT_FOCUSABLE_PANELS as readonly string[]).includes(panel) && listVideoEditInstances().includes(instance)) focusVideoEditPanel(instance.document.id, panel as VideoEditInstance['activePanel'], { reveal: false })
    })
    disposeRef.current = () => { event.dispose(); focus.dispose(); unbindGestures(); if (timer !== undefined) save() }
  }, [onApiChange, onError, instance])
  useEffect(() => () => { bindVideoEditPopoutDock(null); disposeRef.current(); apiRef.current = null; onApiChange(null) }, [onApiChange])
  return <Context.Provider value={{ instance, onError, onEffectsAdded }}>
    {/* 层叠隔离与分隔条拖动保护见 DockviewHost（与 3D 镜头参考共用） */}
    <DockviewHost ref={hostRef} className="h-full min-h-0 w-full">
      <DockviewReact className="henji-cameraStage-dock henji-videoEdit-dock dockview-theme-abyss h-full min-h-0 w-full" theme={VIDEO_EDIT_DOCK_THEME} components={COMPONENTS}
        defaultTabComponent={VideoEditDockTab} rightHeaderActionsComponent={VideoEditDockHeaderActions} watermarkComponent={EmptyLayout}
        {...DOCKVIEW_HOST_DND_OPTIONS} defaultRenderer="always" onReady={onReady} />
    </DockviewHost>
    <VideoEditPopoutPortals onFocusPanel={id => { if (id !== 'effects_library' && listVideoEditInstances().includes(instance)) focusVideoEditPanel(instance.document.id, id, { reveal: false }) }}
      render={(id, visible) => { const Body = BODIES[id]; return <Body visible={visible} /> }} />
  </Context.Provider>
}
