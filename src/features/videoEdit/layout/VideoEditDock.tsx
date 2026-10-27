import { bindWorkspaceLayoutDock } from '@/components/dockLayouts/useWorkspaceLayoutPresets'
import { focusVideoEditPanelElement } from './videoEditPanelFocus'
import { VideoEditAnnotationsPanel } from '../panels/VideoEditAnnotationsPanel'
import { VideoEditStylesPanel } from '../panels/VideoEditStylesPanel'
import { VideoEditPresetsPanel } from '../panels/VideoEditPresetsPanel'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createRafScheduler, type RafScheduler } from '@/utils/createRafScheduler'
import { ownerWindowOf } from '@/utils/crossRealmDom'
import { DockviewReact, type DockviewApi, type DockviewReadyEvent, type IWatermarkPanelProps, type IDockviewPanelProps, type IDockviewPanelHeaderProps } from 'dockview-react'
import 'dockview-react/dist/styles/dockview.css'
import { UiButton, UiEmpty } from '@/components/ui'
import { VIDEO_EDIT_FOCUSABLE_PANELS } from '@/core/videoEdit/panels'
import { focusVideoEditPanel, listVideoEditInstances, subscribeVideoEdit, videoEditRevision, subscribeVideoEditView, type VideoEditInstance } from '../application/videoEditService'
import { VideoEditPreview } from '../VideoEditPreview'
import { VideoEditTimeline } from '../VideoEditTimeline'
import { VideoEditProjectPanel } from '../panels/VideoEditProjectPanel'
import { VideoEditTrackingPanel } from '../panels/VideoEditTrackingPanel'
import { VideoEditColorGradePanel } from '../panels/VideoEditColorGradePanel'
import { VideoEditEffectsPanel } from '../panels/VideoEditEffectsPanel'
import { VideoEditSourcePanel } from '../panels/VideoEditSourcePanel'
import { VideoEditTimedContentPanel } from '../panels/VideoEditTimedContentPanel'
import { VideoEditEffectsLibraryPanel } from '../panels/VideoEditEffectsLibraryPanel'
import { VideoEditTemplatesPanel } from '../panels/VideoEditTemplatesPanel'
import { readVideoEditSource, subscribeVideoEditSource } from '../application/videoEditSource'
import { DockviewHost } from '@/components/DockviewHost'
import { dockviewHostTheme } from '@/components/dockviewHostTheme'
import { bindDockDragGestures, dockFloatingGroupsBack, DOCKVIEW_HOST_DND_OPTIONS } from '@/components/dockviewDocking'
import { VideoEditDockHeaderActions, VideoEditDockTab } from './VideoEditDockChrome'
import { VideoEditSequenceTabs } from '../panels/VideoEditSequenceTabs'
import { dockVideoEditGroup, showVideoEditPanel, VIDEO_EDIT_PANELS, type VideoEditPanelId } from './videoEditDockLayout'
import { dockVideoEditPopoutWindow, bindVideoEditPopoutDock, canFloatVideoEditDockSource, floatVideoEditDockSource, focusVideoEditPopoutPanel, isVideoEditPanelPoppedOut, listVideoEditPopouts, resetVideoEditWorkspaceLayout, restoreVideoEditPopouts, trackVideoEditDockPanel } from './popout/videoEditPopouts'
import { VideoEditPopoutPortals } from './popout/VideoEditPopoutPortals'
import { VideoEditAudioMixerPanel } from '../panels/VideoEditAudioMixerPanel'
import { VideoEditCodeProjectPanel } from '../panels/VideoEditCodeProjectPanel'

interface DockContext { instance: VideoEditInstance; onError: (reason: unknown) => void; onEffectsAdded?: (effectIds: readonly string[]) => void }
const Context = createContext<DockContext | null>(null)
const subscribeHidden = (): (() => void) => () => {}
function useDock(visible: boolean): DockContext {
  const value = useContext(Context)
  // Some panels read the mutable domain instance directly. Subscribe while visible instead of
  // invalidating every Context consumer (including hidden panels) on each host publication.
  useSyncExternalStore(visible ? subscribeVideoEdit : subscribeHidden, visible ? videoEditRevision : () => 0)
  if (!value) throw new Error('剪辑面板宿主尚未就绪')
  return value
}
type PanelBody = (props: { visible: boolean }) => React.ReactElement
/** 面板内容只有这一份：Dock 与系统浮窗共用，浮窗只是换挂载点。 */
function ProjectBody({ visible }: { visible: boolean }): React.ReactElement { return <div className="h-full min-h-0" data-video-edit-panel="project"><VideoEditProjectPanel {...useDock(visible)} visible={visible} /></div> }
function EffectsBody({ visible }: { visible: boolean }): React.ReactElement { return <div className="h-full min-h-0"><VideoEditEffectsPanel {...useDock(visible)} visible={visible} /></div> }
function ProgramBody({ visible }: { visible: boolean }): React.ReactElement { return <div className="flex h-full min-h-0 flex-col" data-video-edit-panel="program"><VideoEditPreview {...useDock(visible)} visible={visible} /></div> }
/** 时间线面板的标签直接是已打开序列的名称（PR 的做法）：多开序列时在标签上切换，不再写“时间线”三个字。 */
function TimelineTabTitle(): React.ReactElement {
  const { instance, onError } = useDock(true)
  return instance.activeSequenceId ? <VideoEditSequenceTabs instance={instance} onError={onError} placement="dock" /> : <span>时间线</span>
}
function DockTab(props: IDockviewPanelHeaderProps): React.ReactElement {
  return <VideoEditDockTab {...props} titleSlot={props.api.id === 'timeline' ? <TimelineTabTitle /> : undefined} />
}
function TimelineBody({ visible }: { visible: boolean }): React.ReactElement { return <div className="flex h-full min-h-0 flex-col" data-video-edit-panel="timeline"><VideoEditTimeline {...useDock(visible)} visible={visible} /></div> }
function ContentBody({ visible }: { visible: boolean }): React.ReactElement { return <div className="h-full min-h-0" data-video-edit-panel="content"><VideoEditTimedContentPanel {...useDock(visible)} visible={visible} /></div> }
function EffectsLibraryBody({ visible }: { visible: boolean }): React.ReactElement { return <div className="h-full min-h-0" data-video-edit-panel="effects_library"><VideoEditEffectsLibraryPanel {...useDock(visible)} visible={visible} /></div> }
function SourceBody({ visible }: { visible: boolean }): React.ReactElement { return <div className="h-full min-h-0"><VideoEditSourcePanel {...useDock(visible)} visible={visible} /></div> }
/** 面板之间露 4px 间隙（参照 PR 的深色边），当前面板组描强调色边，见 index.css 剪辑工作区一节。 */
const VIDEO_EDIT_DOCK_THEME = dockviewHostTheme('henji-cameraStage-dock henji-videoEdit-dock', 4)
function TrackingBody({ visible }: { visible: boolean }): React.ReactElement { return <div className="h-full min-h-0" data-video-edit-panel="tracking"><VideoEditTrackingPanel {...useDock(visible)} visible={visible} /></div> }
function ColorGradeBody({ visible }: { visible: boolean }): React.ReactElement { return <div className="h-full min-h-0" data-video-edit-panel="color_grade"><VideoEditColorGradePanel {...useDock(visible)} visible={visible} /></div> }
function TitleTemplatesBody({ visible }: { visible: boolean }): React.ReactElement { return <div className="h-full min-h-0" data-video-edit-panel="title_templates"><VideoEditTemplatesPanel {...useDock(visible)} visible={visible} /></div> }
function AnnotationsBody({ visible }: { visible: boolean }): React.ReactElement { return <div className="h-full min-h-0" data-video-edit-panel="annotations"><VideoEditAnnotationsPanel {...useDock(visible)} visible={visible} /></div> }
function StyleKitsBody({ visible }: { visible: boolean }): React.ReactElement { return <div className="h-full min-h-0" data-video-edit-panel="style_kits"><VideoEditStylesPanel {...useDock(visible)} visible={visible} /></div> }
function PresetsBody({ visible }: { visible: boolean }): React.ReactElement { return <div className="h-full min-h-0" data-video-edit-panel="presets"><VideoEditPresetsPanel {...useDock(visible)} visible={visible} /></div> }
function CodeProjectBody({ visible }: { visible: boolean }): React.ReactElement { return <div className="h-full min-h-0" data-video-edit-panel="code_project"><VideoEditCodeProjectPanel {...useDock(visible)} visible={visible} /></div> }
function AudioMixerBody({ visible }: { visible: boolean }): React.ReactElement { return <div className="h-full min-h-0"><VideoEditAudioMixerPanel {...useDock(visible)} visible={visible} /></div> }
const BODIES: Record<VideoEditPanelId, PanelBody> = { audio_mixer: AudioMixerBody, presets: PresetsBody, style_kits: StyleKitsBody, annotations: AnnotationsBody, title_templates: TitleTemplatesBody, color_grade: ColorGradeBody, tracking: TrackingBody, project: ProjectBody, effects: EffectsBody, program: ProgramBody, timeline: TimelineBody, content: ContentBody, source: SourceBody, effects_library: EffectsLibraryBody, code_project: CodeProjectBody }
function dockPanel(id: VideoEditPanelId, Body: PanelBody): (props: IDockviewPanelProps) => React.ReactElement {
  return function DockPanel({ api }: IDockviewPanelProps): React.ReactElement {
    const [visible, setVisible] = useState(api.isVisible)
    const visited = useRef(false)
    visited.current ||= visible
    useEffect(() => trackVideoEditDockPanel(id), [])
    useEffect(() => { const event = api.onDidVisibilityChange(value => setVisible(value.isVisible)); return () => event.dispose() }, [api])
    // Keep local panel state after its first visit, but do not mount unseen libraries during project opening.
    return visited.current ? <Body visible={visible} /> : <div data-video-edit-panel={id} />
  }
}
const COMPONENTS = Object.fromEntries(VIDEO_EDIT_PANELS.map(({ id }) => [id, dockPanel(id, BODIES[id])])) as Record<VideoEditPanelId, (props: IDockviewPanelProps) => React.ReactElement>
function EmptyLayout({ containerApi }: IWatermarkPanelProps): React.ReactElement {
  return <UiEmpty className="h-full" title="选择需要的面板" description="在“窗口”菜单中打开需要的面板。" action={<UiButton variant="secondary" onClick={() => resetVideoEditWorkspaceLayout(containerApi)}>重置布局</UiButton>} />
}

/** 源监视器与节目画面在同一组且源监视器在前时，把节目画面换到前面。 */
function revealProgramOverSource(api: DockviewApi | null | undefined): void {
  const program = api?.getPanel('program'); const source = api?.getPanel('source')
  if (program && source && program.group === source.group && source.api.isVisible) program.api.setActive()
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
    // 面板（含浮窗）、效果分组与新效果都可能晚于前几帧才提交到 DOM（机器繁忙、浮窗刚打开）；
    // 逐帧重新查找：新效果出现时滚动到它，最多约 1 秒（附加效果直接一节一节列出，没有要先展开的大分组）。
    const effectRoot = (): HTMLElement | null => listVideoEditPopouts().find(entry => entry.panels.includes('effects'))?.popout.container ?? hostRef.current
    let ownerWindow = ownerWindowOf(effectRoot())
    let animation: RafScheduler<[number]>
    const schedule = (remaining: number): void => {
      const nextWindow = ownerWindowOf(effectRoot())
      if (nextWindow !== ownerWindow) {
        animation.cancel()
        ownerWindow = nextWindow
        animation = createRafScheduler(scrollToAdded, ownerWindow)
      }
      animation.schedule(remaining)
    }
    const scrollToAdded = (remaining: number): void => {
      const root = effectRoot()
      const panel = root?.querySelector('[data-video-edit-panel="effects"]')
      const effect = Array.from(panel?.querySelectorAll<HTMLElement>('[data-video-edit-effect]') ?? []).find(item => addedEffects.includes(item.dataset.videoEditEffect ?? ''))
      if (effect) effect.scrollIntoView({ block: 'nearest' })
      else if (remaining > 0) schedule(remaining - 1)
    }
    animation = createRafScheduler(scrollToAdded, ownerWindow)
    schedule(60)
    return () => animation.cancel()
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
  // 当前序列一变（拖素材自动新建、双击打开、新建序列、撤销切换）就把键盘焦点交给时间线，接着按空格即可播放。
  // 正在输入文字时不抢焦点（例如外部智能体切换序列时用户正在聊天框打字）；弹窗还开着就等它关掉再聚焦。
  useEffect(() => {
    let previous = instance.activeSequenceId
    return subscribeVideoEditView(() => {
      if (instance.activeSequenceId === previous) return
      previous = instance.activeSequenceId
      if (apiRef.current?.getPanel('timeline')?.api.location.type === 'grid') focusVideoEditPanelElement('timeline')
    })
  }, [instance])
  useEffect(() => subscribeVideoEditSource(() => {
    if (!listVideoEditInstances().some(value => value.document.id === instance.document.id)) return
    const source = readVideoEditSource(instance.document.id)
    if (source.status === 'loading' && source.itemId && apiRef.current) showVideoEditPanel(apiRef.current, 'source')
    // 源监视器与节目画面同组时，关掉源素材就把节目画面换回前面，不留一个空的源监视器挡着
    if (source.status === 'closed') revealProgramOverSource(apiRef.current)
  }), [instance.document.id])
  // 同组时节目一开播就换回节目画面：在源监视器那页按空格播时间线，画面不会被挡住
  useEffect(() => {
    let playing = instance.playing
    return subscribeVideoEditView(() => {
      if (instance.playing && !playing) revealProgramOverSource(apiRef.current)
      playing = instance.playing
    })
  }, [instance])
  const onReady = useCallback(({ api }: DockviewReadyEvent): void => {
    disposeRef.current()
    apiRef.current = api
    const root = hostRef.current
    bindVideoEditPopoutDock(api, window, root)
    const unbindGestures = root ? bindDockDragGestures(api, { root, canFloat: canFloatVideoEditDockSource, float: (source, at) => floatVideoEditDockSource(api, source, at) }) : () => {}
    const unbindLayout = bindWorkspaceLayoutDock('video_edit', api, {
      beforeApply: () => { for (const entry of listVideoEditPopouts()) dockVideoEditPopoutWindow(entry.key) },
      capturePreset: () => { for (const entry of listVideoEditPopouts()) dockVideoEditPopoutWindow(entry.key); return api.toJSON() },
      afterApply: () => dockFloatingGroupsBack(api, group => dockVideoEditGroup(api, group)),
      onRestored: () => {
        restoreVideoEditPopouts(api)
        // Dock 只在剪辑已打开时挂载：此时恢复上次浮出的面板，没有剪辑时不会弹窗。
        // 打开项目时左侧堆叠先显示「素材」：上次停在效果控件等标签时，进来不便找素材。
        // 只切换那一组的可见标签，随后把激活面板交还时间线，空格播放等快捷键照常作用于时间线。
        const project = api.getPanel('project')
        if (project && project.api.location.type === 'grid') {
          project.api.setActive()
          const timeline = api.getPanel('timeline')
          if (timeline && timeline.api.location.type === 'grid' && timeline.group !== project.group) timeline.api.setActive()
        }
        // 激活面板只是高亮；键盘焦点也要真正进入时间线，打开项目后直接按空格就能播放。
        if (api.getPanel('timeline')?.api.location.type === 'grid') focusVideoEditPanelElement('timeline')
      },
      onError,
    })
    onApiChange(api)
    const focus = api.onDidActivePanelChange(value => {
      const panel = value.panel?.id
      if (panel && (VIDEO_EDIT_FOCUSABLE_PANELS as readonly string[]).includes(panel) && listVideoEditInstances().includes(instance)) focusVideoEditPanel(instance.document.id, panel as VideoEditInstance['activePanel'], { reveal: false })
    })
    disposeRef.current = () => { unbindLayout(); focus.dispose(); unbindGestures() }
  }, [onApiChange, onError, instance])
  useEffect(() => () => { bindVideoEditPopoutDock(null); disposeRef.current(); apiRef.current = null; onApiChange(null) }, [onApiChange])
  const context = useMemo(() => ({ instance, onError, onEffectsAdded }), [instance, onError, onEffectsAdded])
  return <Context.Provider value={context}>
    {/* 层叠隔离与分隔条拖动保护见 DockviewHost（与 3D 镜头参考共用） */}
    <DockviewHost ref={hostRef} className="h-full min-h-0 w-full">
      <DockviewReact className="henji-cameraStage-dock henji-videoEdit-dock dockview-theme-abyss h-full min-h-0 w-full" theme={VIDEO_EDIT_DOCK_THEME} components={COMPONENTS}
        defaultTabComponent={DockTab} rightHeaderActionsComponent={VideoEditDockHeaderActions} watermarkComponent={EmptyLayout}
        {...DOCKVIEW_HOST_DND_OPTIONS} defaultRenderer="always" onReady={onReady} />
    </DockviewHost>
    <VideoEditPopoutPortals onFocusPanel={id => { if (id !== 'effects_library' && listVideoEditInstances().includes(instance)) focusVideoEditPanel(instance.document.id, id, { reveal: false }) }}
      render={(id, visible) => { const Body = BODIES[id]; return <Body visible={visible} /> }} />
  </Context.Provider>
}
