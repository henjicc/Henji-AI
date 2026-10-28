import { installVideoEditCodeElements } from './application/videoEditCodeElements'
import { VideoEditGpuDeviceLostError, VideoEditRenderBusyError } from './engine/videoEditGpuFailure'
import { createVideoEditProgramSurface as createProgramSurface, retainVideoEditProgramWarmup, takeVideoEditProgram } from './engine/videoEditProgramPool'
import { recordVideoEditFirstFrame } from './engine/videoEditFirstFrameTiming'
import { UI_ICON_SIZE } from '@/core/theme/icons'
import ContextMenu from '@/components/ContextMenu'
import { useContextMenu } from '@/hooks/useContextMenu'
import { VideoEditAnnotationOverlay } from './VideoEditAnnotationOverlay'
import { VideoEditSafeMarginsOverlay } from './VideoEditSafeMarginsOverlay'
import { VideoEditCodeElementOverlay } from './VideoEditCodeElementOverlay'
import { askAssistantAtVideoEditFrame } from './application/videoEditAnnotations'
import { VideoEditMulticamView } from './panels/VideoEditMulticamView'
import { ICON_VIDEO_EDIT_PROXY } from '@/core/theme/icons'
import { autoSwitchVideoEditMulticam, switchVideoEditMulticam, videoEditProgramMulticam } from './application/videoEditMulticam'
import { getVideoEditProxyPreference, setVideoEditProxyPreference, videoEditProxySignature } from './application/videoEditProxy'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Dropdown, PanelTrigger, UiButton, UiEmpty, UiError, UiIconButton, UiLoading, UiOptionButton, UiOverflowRow, UiPanel } from '@/components/ui'
import { ArrowRightFromLine, ArrowRightToLine, ArrowUpFromLine, BookmarkPlus, Camera, ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Eraser, FastForward, Gauge, FoldHorizontal, ImagePlus, ImageUp, MoreHorizontal, Pause, PenLine, Play, Rewind, RotateCcw, Scan, SkipBack, SkipForward, Square, StepBack, StepForward, type LucideIcon } from 'lucide-react'
import Tooltip from '@/components/ui/Tooltip'
import { Z_LAYERS } from '@/core/theme/zLayers'
import { audibleVideoEditClips, videoEditDuration } from '@/core/videoEdit/document'
import { VideoEditRenderSession } from './engine/videoEditRenderSession'
import { retainExplanationPixels } from './application/videoEditExplanationVisual'
import { videoEditParameterUpdate, videoEditParameterAffectsAudio } from './engine/videoEditParameterUpdate'
import { acceptsVideoEditDrop, dropVideoEditInput, readVideoEditDrop } from './application/videoEditDrop'
import { findVideoEditReplaceTarget, type VideoEditDropMode } from '@/core/videoEdit/dropPlacement'
import { isDomNode } from '@/utils/crossRealmDom'
import { activeVideoEditInstance, getActiveVideoEditSequence, requireVideoEditInstance, listVideoEditInstances, setVideoEditView, subscribeVideoEditDomain, subscribeVideoEditView, videoEditViewRevision, videoEditProgramCommandIdentity, type VideoEditInstance } from './application/videoEditService'
import { yieldVideoEditSource } from './application/videoEditSource'
import { subscribeVideoEditTracking, videoEditTrackResults } from './application/videoEditTracking'
import { subscribeVideoEditSmartRegions, videoEditSmartRegionSegments } from './application/videoEditSmartRegions'
import { createVideoEditAudioMeter, type VideoEditAudioLevel } from './engine/videoEditAudioMeter'
import { finishVideoEditAudioFade, VIDEO_EDIT_AUDIO_BLOCK_SECONDS, VideoEditAudioScheduler } from './engine/videoEditAudioScheduler'
import { subscribeVideoEditScrub, VideoEditAudioScrubber } from './engine/videoEditAudioScrub'
import { alignVideoEditClockToDisplay, followVideoEditAudioClock, measureVideoEditDisplayPeriod, nextVideoEditDisplayFrame, videoEditAudioClockOrigin, videoEditLiveFrame, videoEditPlaybackTarget } from './engine/videoEditDisplayClock'
import { VideoEditLevelMeter } from './panels/VideoEditLevelMeter'
import { VideoEditTrackingOverlay } from './panels/VideoEditTrackingOverlay'
import { VideoEditMaskOverlay } from './panels/VideoEditMaskOverlay'
import { VideoEditTextOverlay } from './panels/VideoEditTextOverlay'
import { useVideoEditPictureGesture } from './panels/useVideoEditPictureGesture'
import { useVideoEditMotionGesture } from './panels/useVideoEditMotionGesture'
import { VideoEditMotionControls, VideoEditMotionOverlay } from './panels/VideoEditMotionControls'
import { VideoEditExplanationControls } from './panels/VideoEditExplanationControls'
import { recordVideoExplanationPresentation, recordVideoExplanationPointer, pauseVideoExplanation, videoExplanationState } from './application/videoEditExplanation'
import { videoMotionComposition, videoMotionState, recordVideoMotionPresentation, setVideoMotionOptions, subscribeVideoMotion, pauseVideoMotion } from './application/videoEditMotionDraft'
import { VideoEditInOutDuration, VideoEditTimecode } from './timeline/VideoEditTimelineTransport'
import { useMonitorZoom } from './panels/useMonitorZoom'
import { timelineCommandPresentation } from './timeline/timelineCommandPresentation'
import { captureVideoEditCommandContext, executeVideoEditCommand } from './application/videoEditCommands'
import { VideoEditMonitorButton, VideoEditMonitorButtonEditor, useVideoEditMonitorButtonIds, type VideoEditMonitorButtonSpec } from './panels/VideoEditMonitorButtons'
import { useSettingsStore } from '@/stores/settingsStore'
import type { VideoEditCommandId } from '@/core/videoEdit/commands'
import type { VideoEditProgramButtonId } from '@/core/videoEdit/monitorButtons'
import { captureVideoEditProgramFrame, clearVideoEditPosterFrame, registerVideoEditProgramCapture, setVideoEditPosterFrame } from './application/videoEditProgramCapture'
import { collectVideoEditOutput } from './application/videoEditOutputs'
import { editVideoEditProgramFrame } from './application/videoEditFrameEdit'
import { VideoEditCanvasSendDialog, type VideoEditCanvasSendRequest } from './panels/VideoEditCanvasSendDialog'
import { ICON_WORKSPACE_CANVAS } from '@/core/theme/icons'
import { useAssetLibraryStore } from '@/features/assets/store/assetLibraryStore'
import { openAssetLibrary } from '@/stores/navigationStore'
import { createLogger } from '@/core/logging'
import type { VideoEditComposition } from '@/core/videoEdit/document'
import { VIDEO_EDIT_PLAYBACK_RESOLUTIONS, VIDEO_EDIT_PLAYBACK_RESOLUTION_LABELS, videoEditPreviewDivisor, type VideoEditPlaybackResolution, type VideoEditRenderDivisor } from '@/core/videoEdit/playbackResolution'
import { getVideoEditPlaybackResolution, setVideoEditPlaybackResolution } from './application/videoEditPlaybackResolution'
import { flushVideoEditRenderPerformance } from './application/videoEditRenderPerformance'
import { recordVideoEditPlaybackFrame } from './application/videoEditPlaybackStats'
import { readyVideoEditRenderWindows, recordVideoEditProgramRender } from './application/videoEditRenderCache'

const logger = createLogger('features.videoEdit.preview')
/** 节目控制条低于这个宽度时不显示时间码：时间码 112 + 默认按钮 ~360 + 显示比例 ~70 + 回放分辨率 ~56 + 更多 28 + 间距 */
const PROGRAM_TOOLBAR_TIMECODE_MIN_WIDTH = 656
/** 收进“更多”时的常用显示比例（完整等级在显示比例下拉里）。 */
const PROGRAM_DISPLAY_OPTIONS = [{ value: 'fit' as const, label: '适合' }, { value: 'actual' as const, label: '100%' }]
/** 节目按钮栏里走剪辑命令的按钮（名称、快捷键与启用状态来自正式命令）。 */
const PROGRAM_COMMAND_BUTTONS = ['add_marker', 'mark_in', 'mark_out', 'clear_in_out', 'go_in', 'go_out', 'go_start', 'step_back_five', 'step_back', 'play_reverse', 'play_stop', 'play_pause', 'play_forward', 'step_forward', 'step_forward_five', 'go_end', 'go_prev_edit', 'go_next_edit', 'lift', 'extract', 'toggle_safe_margins'] as const satisfies readonly (VideoEditProgramButtonId & VideoEditCommandId)[]
const PROGRAM_COMMAND_ICONS: Record<Exclude<typeof PROGRAM_COMMAND_BUTTONS[number], 'play_pause'>, LucideIcon> = {
  add_marker: BookmarkPlus, mark_in: ArrowRightFromLine, mark_out: ArrowRightToLine, clear_in_out: Eraser, go_in: ChevronFirst, go_out: ChevronLast,
  go_start: SkipBack, step_back_five: ChevronsLeft, step_back: ChevronLeft, play_reverse: Rewind, play_stop: Square, play_forward: FastForward,
  step_forward: ChevronRight, step_forward_five: ChevronsRight, go_end: SkipForward, go_prev_edit: StepBack, go_next_edit: StepForward, lift: ArrowUpFromLine, extract: FoldHorizontal, toggle_safe_margins: Scan,
}
/** 窄面板先收起优先级低的：播放、逐帧、入出点留到最后。 */
const PROGRAM_BUTTON_PRIORITY: Partial<Record<VideoEditProgramButtonId, number>> = { play_pause: 100, step_back: 90, step_forward: 90, mark_in: 80, mark_out: 80 }
/** 回放分辨率（PR“回放分辨率”）：控制条上的下拉与“更多”里的同一组选项。 */
const PLAYBACK_RESOLUTION_OPTIONS = VIDEO_EDIT_PLAYBACK_RESOLUTIONS.map(value => ({ value, label: VIDEO_EDIT_PLAYBACK_RESOLUTION_LABELS[value] }))
const PLAYBACK_RESOLUTION_TIP = '回放分辨率：播放卡顿时调低，画面变粗但更流畅；暂停时默认回到完整。导出、选帧和封面始终是完整分辨率。'

/**
 * 拖到节目监视器上的落点区（对齐 Premiere）：上 1/5 放在顶层、下 1/5 添加到末尾，中间一行左 1/4 插入、右 1/4 替换、其余覆盖（默认的大区）。
 * 叠层用同一份网格比例绘制，松手按指针所在区落点，保证所见即所得。
 */
const PROGRAM_DROP_ZONES = [
  { mode: 'top', label: '放在顶层', hint: '放到上方空轨道', cell: 'col-span-4 row-span-1' },
  { mode: 'insert', label: '插入', hint: '在播放头处插入，后面的片段后移', cell: 'col-span-1 row-span-3' },
  { mode: 'overwrite', label: '覆盖', hint: '在播放头处覆盖', cell: 'col-span-2 row-span-3' },
  { mode: 'replace', label: '替换', hint: '替换播放头下的片段，保留其时长', cell: 'col-span-1 row-span-3' },
  { mode: 'end', label: '添加到末尾', hint: '接在序列最后一个片段之后', cell: 'col-span-4 row-span-1' },
] as const satisfies ReadonlyArray<{ mode: VideoEditDropMode; label: string; hint: string; cell: string }>
function programDropZoneAt(event: React.DragEvent<HTMLElement>): VideoEditDropMode {
  const rect = event.currentTarget.getBoundingClientRect()
  const x = (event.clientX - rect.left) / Math.max(1, rect.width); const y = (event.clientY - rect.top) / Math.max(1, rect.height)
  if (y < 0.2) return 'top'
  if (y >= 0.8) return 'end'
  return x < 0.25 ? 'insert' : x >= 0.75 ? 'replace' : 'overwrite'
}

/** 刷新周期每隔这么久才重新量一次（窗口可能被拖到另一块显示器）。 */
const DISPLAY_PERIOD_REFRESH_MS = 5000
/** 拖动时相邻两次请求相差至少这么多帧算快速拖动，允许先显示关键帧近似画面。 */
const VIDEO_EDIT_FAST_SCRUB_FRAMES = 4
/** 近似画面在指针停住这么久后补成精确帧。 */
const VIDEO_EDIT_EXACT_AFTER_REST_MS = 90
/**
 * 暂停时跳转（点击标尺、按时间码、入出点、助手定位）超过这么多帧：先出近似画面（代码层照常精确，长 GOP 视频先给
 * 解码器最近的一幅），紧接着补精确帧。4K 长 GOP 录屏精确定位要解几十到上百帧（每帧约 4.6ms，最深约半秒），只解关键帧约
 * 10–25ms（另加新片段打开解码会话的时间）。
 * 近距离逐帧步进不走近似，避免先闪一下关键帧。
 */
const VIDEO_EDIT_FAST_JUMP_FRAMES = 30
/** 第一块声音已混好时的起播提前量：只够把它排进声音时钟。 */
const PLAY_PREMIXED_LEAD_SECONDS = 0.03
/**
 * 节目循环同时交给渲染会话的画面请求上限。会话一共只排 4 个请求（videoEditRenderTransport），
 * 留一个给文档、回放分辨率与起播预热这类控制请求；Worker 串行执行，排得越多停止与跳转越慢。
 */
const PROGRAM_FRAMES_IN_FLIGHT = 3
/** 正向播放已排进 Worker、还没提交给 GPU 的帧上限：一帧等刷新时，下一帧已排在它后面准备。 */
const PROGRAM_UNSUBMITTED_FRAMES = 2
/** 渲染队列排满（背压）后隔这么久按最新状态再请求。 */
const PROGRAM_BUSY_RETRY_MS = 4
/** 选帧、设封面、编辑当前帧最多等原地暂停落定这么久（毫秒）；在途播放帧回来通常只要一两次刷新。 */
const PAUSE_SETTLE_WAIT_MS = 500
/** The Program GPU surface belongs to the project: a remount (dock ↔ popout window) waits until the previous session actually retired. */
const programReleases = new WeakMap<VideoEditInstance, Promise<unknown>>()
function VideoEditProgramPrewarm(): null {
  useEffect(() => retainVideoEditProgramWarmup(), [])
  return null
}
function VideoEditPreviewContent({ instance, onError, visible = true }: { instance: VideoEditInstance; onError: (error: unknown) => void; visible?: boolean }): React.ReactElement {
  const annotationMenu = useContextMenu()
  const [multicamView, setMulticamView] = useState(false)
  const multicam = videoEditProgramMulticam(instance)
  const [canvasSend, setCanvasSend] = useState<VideoEditCanvasSendRequest | null>(null)
  useSyncExternalStore(subscribeVideoEditView, videoEditViewRevision)
  const host = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const programToolbarRef = useRef<HTMLDivElement>(null)
  const [compactProgramToolbar, setCompactProgramToolbar] = useState(false)
  useEffect(() => {
    const toolbar = programToolbarRef.current
    if (!toolbar || typeof ResizeObserver === 'undefined') return
    const update = (): void => setCompactProgramToolbar(toolbar.clientWidth < PROGRAM_TOOLBAR_TIMECODE_MIN_WIDTH)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(toolbar)
    return () => observer.disconnect()
  }, [])
  const [levels, setLevels] = useState<VideoEditAudioLevel[]>([])
  // 节目画面不再分“选择 / 移动画面”模式（重要记录 019）：命令带选着选择工具时，直接拖画面移动选中的片段。
  const selecting = instance.tool === 'select'
  const picture = useVideoEditPictureGesture(instance, visible && selecting, onError)
  const motionGesture = useVideoEditMotionGesture(instance, onError)
  const temporaryMotionMode = useRef<'navigate' | 'demonstrate'>()
  const motionRecording = useSyncExternalStore(subscribeVideoMotion, () => videoMotionState(instance)?.status === 'recording')
  const explanationError = useRef(onError)
  explanationError.current = onError
  useEffect(() => {
    const monitor = host.current; const target = monitor?.ownerDocument.defaultView
    if (!monitor || !target || !visible) return
    const pointer = (event: globalThis.PointerEvent): void => recordVideoExplanationPointer(instance, event, monitor)
    const pause = (): void => { if (videoExplanationState(instance)?.collector.session.state === 'recording') void pauseVideoExplanation(instance.document.id, true).catch(error => explanationError.current(error)) }
    for (const name of ['pointermove', 'pointerdown', 'pointerup', 'pointercancel'] as const) target.addEventListener(name, pointer, true)
    target.addEventListener('blur', pause)
    return () => { for (const name of ['pointermove', 'pointerdown', 'pointerup', 'pointercancel'] as const) target.removeEventListener(name, pointer, true); target.removeEventListener('blur', pause); pause() }
  }, [instance, visible])
  useEffect(() => {
    const target = host.current?.ownerDocument.defaultView ?? window
    const restore = (): void => { const mode = temporaryMotionMode.current; temporaryMotionMode.current = undefined; if (mode && listVideoEditInstances().includes(instance)) setVideoMotionOptions(instance.document.id, { mode }) }
    const down = (event: KeyboardEvent): void => {
      const state = videoMotionState(instance)
      if (event.key !== 'Alt' || state?.status !== 'recording') return
      if (!temporaryMotionMode.current) { temporaryMotionMode.current = state.mode; setVideoMotionOptions(instance.document.id, { mode: state.mode === 'navigate' ? 'demonstrate' : 'navigate' }) }
      event.preventDefault()
    }
    const up = (event: KeyboardEvent): void => { if (event.key === 'Alt') restore() }
    const blur = (): void => { restore(); if (videoMotionState(instance)?.status === 'recording') pauseVideoMotion(instance.document.id) }
    target.addEventListener('keydown', down, true); target.addEventListener('keyup', up, true); target.addEventListener('blur', blur)
    return () => { target.removeEventListener('keydown', down, true); target.removeEventListener('keyup', up, true); target.removeEventListener('blur', blur); restore() }
  }, [instance])
  const [preparing, setPreparing] = useState(false)
  /** 本次挂载的渲染器是否已有画面上屏；之前显示“正在准备画面”，避免打开工程时只看到一块黑。 */
  const [pictureReady, setPictureReady] = useState(false)
  const [retry, setRetry] = useState(0)
  const gpuRecoveryTimes = useRef<number[]>([])
  const [effectFailure, setEffectFailure] = useState<string | null>(null)
  const [renderFailure, setRenderFailure] = useState<string | null>(null)
  const [collecting, setCollecting] = useState(false)
  /** 正在拖入时指针所在的落点区；替换区在播放头下没有片段时不可用。 */
  const [dropZone, setDropZone] = useState<{ mode: VideoEditDropMode; replaceable: boolean; frame: { left: number; top: number; width: number; height: number } } | null>(null)
  const libraryId = useAssetLibraryStore(state => state.libraryId)
  const session = useRef<VideoEditRenderSession | null>(null)
  const stopPreview = useRef<() => void>(() => {})
  /** 原地暂停落定（播放头落在 Worker 实际最后上屏的一帧）后 resolve；没有正在落定的暂停时立即 resolve。 */
  const pauseSettled = useRef<() => Promise<void>>(() => Promise.resolve())
  const document = getActiveVideoEditSequence(instance)
  // 显示比例与缩放（Premiere：滚轮缩放、中键平移、下拉选等级或“适合”）
  const zoom = useMonitorZoom({ width: document.width, height: document.height, label: '节目显示比例' })
  const display = zoom.display
  // 节目面板整个生命周期只用一个渲染器：切换序列（含尺寸不同的序列、拖素材自动新建的序列）只换文档，
  // Worker 按新尺寸原地调整画布，切过去立刻出第一帧。以前按序列重建，每次切序列节目画面要空白约 1.5 秒。
  useEffect(() => {
    if (!visible) { setVideoEditView(instance.document.id, { playing: false }, true); setPreparing(false); setLevels([]); return }
    const previousRelease = programReleases.get(instance) ?? Promise.resolve()
    setRenderFailure(null); setEffectFailure(null); setPictureReady(false)
    let pictureShown = false
    let stopped = false
    let stopCurrent: () => void = () => {}
    const stop = (): void => { stopped = true; stopCurrent() }
    stopPreview.current = stop
    const initialize = async (): Promise<void> => {
    // 工作区空闲时预建的会话在这里接管。推迟一个微任务再取：开发模式（StrictMode）会把挂载、卸载、再挂载
    // 同步连跑一遍，第一遍若同步取走，紧接着的卸载就会把它释放掉；未接管的池资源有独立退出时限。
    const adopted = await Promise.resolve().then(() => stopped ? undefined : takeVideoEditProgram(instance.document.id, instance.activeSequenceId))
    if (adopted) logger.debug('节目面板接管预热的渲染器', { event: 'video_edit.program.prewarm.adopted', context: { projectId: instance.document.id } })
    // A new renderer waits for the previous GPU/cache owner to be released; an adopted prewarmed one already owns its GPU.
    if (!adopted) await previousRelease
    if (stopped) { void adopted?.renderer.dispose(); return }
    const initialDocument = adopted?.document ?? getActiveVideoEditSequence(instance)
    const surface = adopted?.surface ?? createProgramSurface(initialDocument.width, initialDocument.height)
    host.current?.replaceChildren(surface); canvas.current = surface
    // Explanation presents acknowledged Worker pixels on a stable canvas because a transferred GPU
    // surface can lose its compositor image between frames. Never reconstruct a historical picture.
    let explanationSurface: HTMLCanvasElement | undefined
    const renderer = adopted?.renderer ?? new VideoEditRenderSession(initialDocument, initialDocument.width, active => { if (!stopped) setPreparing(active) }, surface.transferControlToOffscreen(), undefined, instance.document.id); session.current = renderer
    let observedSequence = initialDocument.id
    const unsubscribe = subscribeVideoEditDomain(() => {
      if (stopped) return
      const next = videoMotionComposition(instance)
      // 讲解分页、转写和绑定只更新文档元数据，不撤销同一画面的呈现。
      if (next && next.id !== observedSequence) { observedSequence = next.id; renderer.preopenSequence(next, instance.frame) }
      if (next === appliedDocument) return
      const parameters = next && videoEditParameterUpdate(appliedDocument, next)
      if (!parameters || videoEditParameterAffectsAudio(appliedDocument, parameters)) {
        if (next !== appliedDocument) { stopAudio(); scrubber.stop(); setLevels([]) }
        renderer.invalidateDocument(next?.revision ?? instance.document.revision)
      }
    })
    let observedScrubbing = !!instance.scrubbing
    let observedPlaying = instance.playing
    let observedCommand = videoEditProgramCommandIdentity(instance.document.id)
    let observedAudioFrame = instance.frame
    /** 暂停或拖动时播放头一动就推进一次（见下方 wake 的消息通道唤醒），不等轮询计时器。 */
    let wakeForView = (): void => {}
    const unsubscribeView = subscribeVideoEditView(() => {
      if (stopped) return
      const command = videoEditProgramCommandIdentity(instance.document.id)
      const moved = observedAudioFrame !== instance.frame
      // 停止先于这次改动的画面请求发给 Worker：还没上屏的播放帧当场作废，预热的视频输入先收起，暂停帧不会排在停止前面。
      if (observedPlaying && (!instance.playing || observedCommand !== command)) renderer.stopPlayback(instance.frame)
      // 原地暂停（空格、暂停按钮、停止命令、播到结尾、助手暂停）：暂停画面落在 Worker 实际最后上屏的那一帧（见 advance）；
      // 同时指定了位置（点时间线、跳到标记）的按那个位置跳转。
      if (observedPlaying && !instance.playing && !moved) settlePause = true
      else if (instance.playing || moved) { settlePause = false; releaseSettleWaiters() }
      if (!observedPlaying && instance.playing) playbackShown = -1
      observedPlaying = instance.playing
      observedCommand = command
      const releasedScrub = observedScrubbing && !instance.scrubbing
      observedScrubbing = !!instance.scrubbing
      // A different frame (including a played frame) invalidates the Worker playback plan.
      // Returning to that old paused position must not reuse the main thread's stale armed marker.
      if (instance.playing || instance.frame !== armedFrame) armedFrame = -1
      if (releasedScrub && !instance.playing && performance.now() - firstPresentationAt >= 1100 && captureFull === 0) {
        const document = videoMotionComposition(instance)
        if (document === appliedDocument) void preparePlayback(document, instance.frame)
      }
      if (!instance.playing || instance.playbackDirection !== direction || activeCommand && videoEditProgramCommandIdentity(instance.document.id) !== activeCommand) { stopAudio(); setLevels([]) }
      observedAudioFrame = instance.frame
      if (instance.playing || releasedScrub || moved && !instance.scrubbing) scrubber.stop()
      // 拖动出声跟着指针走：播放头一动就把新位置交给擦洗引擎，不等画面呈现。
      if (moved && instance.scrubbing && !instance.playing) { const document = videoMotionComposition(instance); if (document) scrubAudio(instance.frame / document.fps, 'drag') }
      // 状态都已更新、停止已发出后再推进调度（仍在这次改动的同一个任务里发出画面请求）。
      wakeForView()
    })
    let audioRenderer: VideoEditRenderSession | undefined
    // No available proxy means the session already plays the originals: both read as 'original', so starting paused does not rebuild.
    const proxyState = (signature: string): string => signature === '[]' ? 'original' : signature
    let appliedProxy = proxyState(videoEditProxySignature(instance.document.id))
    let appliedDocument = initialDocument
    let appliedSequence = instance.document.sequences.find(sequence => sequence.id === initialDocument.id)
    const unsubscribeMotion = subscribeVideoMotion(() => {
      if (stopped || videoMotionState(instance)?.status !== 'recording') return
      const next = videoMotionComposition(instance)
      // 取消旧姿态等待未来帧的 deadline；仍由同一个循环和同一个画布呈现最新快照。
      if (next && next !== appliedDocument) renderer.invalidateDocument(next.revision)
    })
    let timer: ReturnType<typeof setTimeout> | undefined
    let audio: AudioContext | undefined
    let meter: ReturnType<typeof createVideoEditAudioMeter> | undefined
    let lastRequested = -1
    let lastFrame = -1
    /** `lastFrame` on screen is a paused picture (exact, not a playback frame): frame capture waits for one. */
    let pausedPicture = false
    let appliedFonts = renderer.fontPresentationRevision
    let lastScrubbing = false
    /** Whether the newest frame request sent was a scrub frame: releasing the playhead on the same frame asks for it exactly once. */
    let lastRequestedScrubbing = false
    /** The newest frame request was a playback frame: the first paused request after it is never a small step back. */
    let lastRequestedPlaying = false
    /**
     * 原地暂停后还没落定暂停画面：等播放中发出的画面回来，按 Worker 实际最后上屏的一帧（`playbackShown`）写回播放头并精确重画。
     * 暂停时流水里已排好的帧（最多两帧）由 Worker 作废，暂停帧取 `instance.frame`（最后一个处理过回执的帧）会先显示排好的帧、
     * 再退回去，正是“暂停时画面跳一下”。
     */
    let settlePause = false
    /** 播放中发出、还没回执的画面请求数（含起播帧）。 */
    let playbackInFlight = 0
    /** 这一轮播放 Worker 实际上屏的最后一帧（以回执为准；不随换文档、换代理重置）。 */
    let playbackShown = -1
    /** 等暂停落定的取图操作（选帧、设封面、编辑当前帧按落定后的播放头取图，见 `pauseSettled`）。 */
    let settleWaiters: Array<() => void> = []
    const releaseSettleWaiters = (): void => { const waiters = settleWaiters; settleWaiters = []; for (const resolve of waiters) resolve() }
    pauseSettled.current = () => settlePause ? Promise.race([new Promise<void>(resolve => { settleWaiters.push(resolve) }), new Promise<void>(resolve => { setTimeout(resolve, PAUSE_SETTLE_WAIT_MS) })]) : Promise.resolve()
    /** 屏幕上是快速拖动时的关键帧近似画面（帧号）；指针停住或松手后按精确方式补这一帧。-1 表示是精确画面。 */
    let approximateFrame = -1
    /** 这幅近似画面来自操作中的小步后退（拖动刚按下、方向键连按）：同拖动一样等指针或按键停住再补精确帧。 */
    let approximateWhileActive = false
    let clockStart = 0
    let clockPerformanceStart = 0
    let startFrame = 0
    let wasPlaying = false
    let direction: 1 | -1 = 1
    let activeCommand: object | undefined
    let armedDocument: VideoEditComposition | undefined
    let armedFrame = -1
    let armedAt = -Infinity
    /** 已提交给 GPU、结果还没回来的正向播放帧（两帧流水，见下方 present）。 */
    let submittedFrame = -1
    /** 节目循环已发出、还没回执的画面请求数（所有方向、暂停与拖动都算），发请求前按它限流。 */
    let framesInFlight = 0
    /** Forward frames already queued in the Worker but not yet submitted (one is prepared while the previous waits for its refresh). */
    let unsubmitted = 0
    let queuedFrame = -1
    /** 本次播放因跟不上时钟而跳过的帧数（播放验收读取）。 */
    let droppedFrames = 0
    /** 已交给渲染器的预渲染窗口（按内容指纹）；节目播放时整帧取自预览文件。 */
    let appliedRenderCache = ''
    let renderCacheCheckedAt = -Infinity
    // 起播预热时提前混好的第一块声音：起播时钟不必再留 100ms 等混音。
    let displayPeriod: number | undefined
    /** A refresh timestamp of this play run and the smoothed audio-clock origin the picture follows. */
    let displayVsync: number | undefined
    let audioOrigin: number | undefined
    let lastParameterUpdate = -Infinity
    let historyEnabled = false
    let displayMeasuredAt = -Infinity
    let firstBlock: { document: VideoEditComposition; from: number; duration: number; buffer: Promise<AudioBuffer>; ready: boolean } | undefined
    // 回放分辨率（4.9）：播放用所选分辨率，暂停默认回到完整；选帧、设封面期间强制完整。
    let appliedDivisor: VideoEditRenderDivisor = 1
    let captureFull = 0
    const audioScheduler = new VideoEditAudioScheduler()
    const scrubber = new VideoEditAudioScrubber()
    const scrubAudio = (seconds: number, mode: 'drag' | 'step'): void => {
      const document = videoMotionComposition(instance)
      if (!document || instance.playing || !audibleVideoEditClips(document).length) return
      scrubber.request({
        seconds, fps: document.fps, endTime: videoEditDuration(document) / document.fps, mode,
        prepare: async () => {
          audio ??= new AudioContext({ sampleRate: document.sampleRate })
          const context = audio
          await context.resume()
          if (stopped || audio !== context) throw new DOMException('擦洗声音已关闭。', 'AbortError')
          meter ??= createVideoEditAudioMeter(context, document.channels)
          return { context, destination: meter.input }
        },
        mix: (from, duration) => (audioRenderer ??= new VideoEditRenderSession(document)).mixAudio(from, duration, true),
        isCurrent: () => !stopped && !instance.playing && videoMotionComposition(instance) === document && appliedDocument === document,
        onError,
      })
    }
    const unsubscribeScrub = subscribeVideoEditScrub(instance.document.id, intent => { if (intent.scope === 'program') scrubAudio(intent.seconds, intent.kind ?? 'step') })
    const stopAudio = (): void => audioScheduler.stop()
    const meterTimer = setInterval(() => { if (!stopped && meter) setLevels(meter.read()) }, 50)
    let lastPresentation = -Infinity
    let firstPresentationAt = Infinity
    let presentedSequenceId = ''
    let lastInteractionAt = -Infinity
    const interaction = (): void => { lastInteractionAt = performance.now() }
    const idleEvents = ['pointerdown', 'pointermove', 'wheel', 'keydown'] as const
    for (const event of idleEvents) window.addEventListener(event, interaction, { passive: true, capture: true })
    // Scrub release starts preparation before the final paused-picture acknowledgement returns.
    // The existing Worker queue keeps document/render ordering and owns all decoder resources.
    const preparePlayback = async (document: VideoEditComposition, frame: number): Promise<void> => {
      if (armedDocument === document && armedFrame === frame) return Promise.resolve()
      armedDocument = document; armedFrame = frame; armedAt = performance.now()
      firstBlock = undefined
      try {
        if (audibleVideoEditClips(document).length && (!audio || audio.sampleRate === document.sampleRate)) {
          audio ??= new AudioContext({ sampleRate: document.sampleRate }); void audio.resume().catch(() => undefined)
          // 与调度器共用采样网格，否则非整数帧率的首块预混会因浮点起点不同而失配。
          const firstSample = Math.round(frame / document.fps * document.sampleRate)
          const from = firstSample / document.sampleRate
          const duration = Math.min(Math.round(VIDEO_EDIT_AUDIO_BLOCK_SECONDS * document.sampleRate), Math.round(videoEditDuration(document) / document.fps * document.sampleRate) - firstSample) / document.sampleRate
          if (duration > 0) { const block = { document, from, duration, buffer: (audioRenderer ??= new VideoEditRenderSession(document)).mixAudio(from, duration), ready: false }; firstBlock = block; block.buffer.then(() => { block.ready = true }, () => undefined) }
        }
        if (!stopped) await renderer.armPlayback(frame)
      } catch (error) {
        if (armedDocument === document && armedFrame === frame) armedFrame = -1
        logger.debug('起播预热未完成', { event: 'video_edit.preview.arm_failed', error, context: { projectId: instance.document.id } })
      }
    }
    // 智能区域（4.7d）：分析完成后重画当前帧。
    let appliedRegions = ''
    const pushRegions = (): void => {
      const regions = videoEditSmartRegionSegments(); const key = JSON.stringify(regions)
      if (key === appliedRegions) return
      appliedRegions = key; renderer.setSmartRegions(regions); lastRequested = -1
    }
    pushRegions()
    const unsubscribeRegions = subscribeVideoEditSmartRegions(() => { if (!stopped) pushRegions() })
    let appliedTracks = ''
    const pushTracks = (): void => { const tracks = videoEditTrackResults(); const key = JSON.stringify(tracks); if (key === appliedTracks) return; appliedTracks = key; renderer.setTracks(tracks); lastRequested = -1 }
    pushTracks()
    const unsubscribeTracks = subscribeVideoEditTracking(() => { if (!stopped) pushTracks() })
    // A failure is retried once the sequence changes (relink, removal, undo) or the user moves the playhead, and by
    // itself after a growing pause (2s up to 10s), so a recovered decoder shows the picture again (task 3.1).
    let failedDocument: VideoEditComposition | undefined
    let failedFrame = -1
    let failedRetryAt = 0
    let failedRetryMs = 2000
    const recordPresentation = (target: number, result: Awaited<ReturnType<VideoEditRenderSession['present']>>, requestedAt: number, scrubbing: boolean, composition: VideoEditComposition): boolean => {
      const revision = composition.revision
      if (stopped || !listVideoEditInstances().includes(instance) || instance.activeSequenceId !== composition.id || session.current !== renderer || canvas.current !== surface || requestedAt < lastPresentation) { result.history?.close(); return false }
      if (result.authorElements && result.presented && !instance.playing && !scrubbing && target === instance.frame) installVideoEditCodeElements(instance, result.authorElements)
      if (result.history) {
        explanationSurface ??= window.document.createElement('canvas')
        explanationSurface.className = 'pointer-events-none absolute inset-0 h-full w-full object-contain'
        explanationSurface.setAttribute('aria-hidden', 'true')
        explanationSurface.width = result.history.width; explanationSurface.height = result.history.height
        const context = explanationSurface.getContext('2d', { alpha: false })
        if (!context) { result.history.close(); throw new Error('讲解画面无法呈现，请重新打开节目面板。') }
        context.drawImage(result.history, 0, 0)
        explanationSurface.dataset.presentedFrame = String(target)
        explanationSurface.dataset.presentedRevision = String(revision)
        if (!explanationSurface.isConnected) surface.parentElement?.append(explanationSurface)
      } else if (explanationSurface && (explanationSurface.dataset.presentedFrame !== String(target) || explanationSurface.dataset.presentedRevision !== String(revision))) {
        explanationSurface.remove(); explanationSurface = undefined
      }
      if (presentedSequenceId !== composition.id) { presentedSequenceId = composition.id; firstPresentationAt = performance.now() }
      retainExplanationPixels(surface, target, result.history)
      if (result.presented === true) {
        recordVideoEditFirstFrame(instance.document.id, composition.id, { frame: target, decodeMs: result.decodeMs, gpuMs: result.gpuMs, sourceTimestamps: result.sourceTimestamps })
        // 只在首帧时改状态：逐帧调用 setState 会让整个节目面板（含工具栏）跟着每帧重渲染。
        if (!pictureShown) { pictureShown = true; setPictureReady(true) }
      }
      lastPresentation = requestedAt
      surface.dataset.requestedAt = String(requestedAt); surface.dataset.renderMs = String(performance.now() - requestedAt)
      surface.dataset.decodeMs = String(result.decodeMs ?? 0); surface.dataset.gpuMs = String(result.gpuMs ?? 0)
      surface.dataset.sourceTimestamps = (result.sourceTimestamps ?? []).join(','); surface.dataset.cacheHits = String(result.cacheHits ?? 0); surface.dataset.cacheBytes = String(result.cacheBytes ?? 0)
      surface.dataset.proxyPreparationMs = String(renderer.previewPreparationMs); surface.dataset.proxyBytes = String(renderer.previewBytes)
      surface.dataset.scrubbing = String(scrubbing); surface.dataset.approximate = String(!!result.approximate); surface.dataset.presentedFrame = String(target)
      surface.dataset.presentedRevision = String(revision); surface.dataset.renderDivisor = String(appliedDivisor)
      if (result.presented !== false) recordVideoMotionPresentation(instance, { frame: target, revision, sequenceId: composition.id, at: performance.now(), scrubbing })
      if (result.presented === true) recordVideoExplanationPresentation(instance, { frame: target, revision: composition.revision, sequenceId: composition.id, composition, at: performance.now(), scrubbing })
      if (failedDocument === undefined) { setRenderFailure(null); failedRetryMs = 2000 }
      recordVideoEditPlaybackFrame(instance, composition, target, result, requestedAt, scrubbing)
      return true
    }
    const unregisterCapture = registerVideoEditProgramCapture(instance, () => appliedDocument.id, async (request, signal) => {
      const picture = videoMotionComposition(instance)
      const current = (): void => {
        signal?.throwIfAborted(); request.assertCurrent()
        if (stopped || session.current !== renderer || canvas.current !== surface || !surface.isConnected) throw new Error('节目面板已关闭，请重新打开后选帧。')
        if (videoMotionComposition(instance) !== picture) throw new Error('示范或候选画面已改变，请重新选帧。')
      }
      const start = performance.now()
      // 选帧与封面始终是完整分辨率：降低了回放分辨率时，先按完整尺寸重画这一帧再取图。
      captureFull++
      try {
        while (appliedProxy !== 'original' || appliedDocument !== picture || lastFrame !== request.frame || !pausedPicture || surface.dataset.presentedRevision !== String(picture?.revision) || surface.dataset.scrubbing === 'true' || surface.dataset.approximate === 'true' || surface.dataset.renderDivisor !== '1' || surface.width !== request.document.width || surface.height !== request.document.height) {
          current()
          if (performance.now() - start > 10000) throw new Error('节目画面尚未就绪，请等待画面更新后重试选帧。')
          await new Promise(resolve => setTimeout(resolve, 5))
        }
        current()
        const blob = await new Promise<Blob>((resolve, reject) => surface.toBlob(value => value ? resolve(value) : reject(new Error('节目图片保存失败，请重试。')), 'image/png'))
        current()
        return blob
      } finally { captureFull-- }
    })
    // 节目画面只有一个调度入口 wake：任何时刻最多一个推进步骤在跑、最多一个待触发的计时器。
    // 起播、定位、画面回执、出错恢复都只是请求“再推进一次”，合并进同一条调度，不会多出第二条循环
    // （以前各处各自 setTimeout(loop)：流水提前调度与提交回执各起一条、出错后再起一条，链只增不减，
    // 暂停时空转成倍增加，播放时把渲染队列排满被拒、强制停播）。
    let timerAt = Infinity
    let stepping = false
    /** 推进步骤执行期间收到的唤醒：这一步交出调度后按其中最早的一个再排。 */
    let wakeAfterStep: number | undefined
    // 暂停与拖动时的立即唤醒走消息通道：调度链里的 setTimeout(0) 嵌套几层后被钳到至少 4ms，Windows 上又按约 15.6ms 的
    // 系统计时器粒度触发，拖动时每次指针移动、每帧提交回执都要平均多等约 10ms 才开始下一帧（实测指针到发出请求 13–15ms）。
    // 播放循环照旧用计时器：它持续自我唤醒，不能变成忙等。
    const immediate = new MessageChannel()
    let immediatePending = false
    immediate.port1.onmessage = () => { immediatePending = false; if (!stopped) void step() }
    const wake = (delay: number): void => {
      if (stopped) return
      if (stepping) { wakeAfterStep = Math.min(wakeAfterStep ?? delay, delay); return }
      if (immediatePending) return
      if (delay === 0 && !instance.playing) {
        if (timer !== undefined) { clearTimeout(timer); timer = undefined; timerAt = Infinity }
        immediatePending = true; immediate.port2.postMessage(null); return
      }
      const at = performance.now() + delay
      if (timer !== undefined) { if (timerAt <= at) return; clearTimeout(timer) }
      timerAt = at
      timer = setTimeout(() => { timer = undefined; timerAt = Infinity; void step() }, delay)
    }
    // 暂停或拖动时播放头一动，就在这次改动里直接推进：请求在指针事件的同一个任务里发出，Worker 与这次界面更新（开发版 React
    // 重绘约 5ms）并行画这一帧；经消息通道再唤醒要排在界面更新与绘制之后（实测播放头变化到发出请求约 12ms）。
    wakeForView = () => { if (instance.playing) return; if (stepping || immediatePending || stopped) wake(0); else { if (timer !== undefined) { clearTimeout(timer); timer = undefined; timerAt = Infinity } void step() } }
    const step = async (): Promise<void> => {
      if (stopped) return
      if (stepping) { wake(0); return }
      stepping = true; wakeAfterStep = undefined
      const turn = {
        released: false,
        /** 这一步不再推进（只收尾自己已发出的那一帧）：调度交还 wake，下一步可以开始。 */
        handOff: (): void => {
          if (turn.released) return
          turn.released = true; stepping = false
          const delay = wakeAfterStep; wakeAfterStep = undefined
          if (delay !== undefined) wake(delay)
        },
      }
      try { await advance(turn) } finally { turn.handOff() }
    }
    const requestFrame = (playback: boolean, ...args: Parameters<VideoEditRenderSession['present']>): ReturnType<VideoEditRenderSession['present']> => {
      framesInFlight++; if (playback) playbackInFlight++
      return renderer.present(...args).finally(() => { framesInFlight--; if (playback) playbackInFlight-- })
    }
    const advance = async (turn: { readonly released: boolean; handOff: () => void }): Promise<void> => {
      let requestCommand: object | undefined
      let requestDocument = appliedDocument
      try {
        const current = requireVideoEditInstance(instance.document.id)
        const command = videoEditProgramCommandIdentity(instance.document.id)
        const document = videoMotionComposition(current)
        if (!document) { stopAudio(); return }
        const explanation = videoExplanationState(current)?.collector.session
        const captureHistory = !!explanation && ['recording', 'paused'].includes(explanation.state)
        if (captureHistory !== historyEnabled) { historyEnabled = captureHistory; if (historyEnabled) lastRequested = -1; else retainExplanationPixels(surface, -1) }
        if (appliedFonts !== renderer.fontPresentationRevision) { appliedFonts = renderer.fontPresentationRevision; lastRequested = -1 }
        requestCommand = command; requestDocument = document
        // 代理只在播放与拖动播放头时使用；停下（暂停、拖动松手）后节目换回原片实时合成的完整画质，
        // 取帧观察与导出始终用原片。没有可用代理时不切换，避免每次起停都重建解码会话。
        const availableProxies = videoEditProxySignature(instance.document.id)
        const useOriginal = captureFull > 0 || !(current.playing || current.scrubbing) || availableProxies === '[]'
        if (failedDocument) {
          if (failedDocument === document && failedFrame === current.frame && Date.now() < failedRetryAt) { wake(250); return }
          failedDocument = undefined
        }
        if (appliedDocument !== document) {
          scrubber.stop()
          const sequence = current.document.sequences.find(sequence => sequence.id === document.id)
          const liveProjection = videoMotionState(current)?.status === 'recording' && sequence === appliedSequence && document.media === appliedDocument.media && document.items === appliedDocument.items
          const parameterUpdate = captureFull === 0 && videoEditParameterUpdate(appliedDocument, document)
          // One latest parameter snapshot per display period. Intermediate moves never enter the Worker queue.
          const parameterPeriod = displayPeriod ?? 1000 / 60
          const parameterTick = Math.floor(performance.now() / parameterPeriod) * parameterPeriod
          if (parameterUpdate && parameterTick <= lastParameterUpdate) {
            wake(Math.max(1, lastParameterUpdate + parameterPeriod - performance.now())); return
          }
          if ((!parameterUpdate && !liveProjection) || parameterUpdate && videoEditParameterAffectsAudio(appliedDocument, parameterUpdate)) { stopAudio(); wasPlaying = false }
          if (parameterUpdate) renderer.invalidateDocument(document.revision)
          if (appliedDocument.sampleRate !== document.sampleRate || appliedDocument.channels !== document.channels) { await finishVideoEditAudioFade(); meter?.dispose(); meter = undefined; await audio?.close(); audio = undefined; if (!stopped) setLevels([]) }
          // 固定刷新周期合流最新快照，避免计时器误差及 Worker 往返耗时逐帧累加。
          if (parameterUpdate) lastParameterUpdate = parameterTick
          // 内容或位置改变必须立即撤下旧映射，不能等下一次 250ms 缓存轮询才更新。
          if (appliedRenderCache) { renderer.setRenderCache([]); appliedRenderCache = '' }
          renderCacheCheckedAt = -Infinity
          await renderer.updateDocument(document, useOriginal); await audioRenderer?.updateDocument(document); appliedDocument = document; appliedSequence = sequence; appliedProxy = useOriginal ? 'original' : proxyState(availableProxies); lastRequested = -1
          if (!parameterUpdate && !liveProjection) lastFrame = -1
          if (stopped) return
        }
        const proxySignature = useOriginal ? 'original' : proxyState(availableProxies)
        if (appliedProxy !== proxySignature) {
          stopAudio(); wasPlaying = false; await renderer.updateDocument(document, useOriginal); appliedProxy = proxySignature; lastFrame = -1; lastRequested = -1
          if (stopped) return
        }
        if (performance.now() - renderCacheCheckedAt > 250) {
          renderCacheCheckedAt = performance.now()
          const ready = readyVideoEditRenderWindows(instance.document.id, document)
          const signature = ready.length ? JSON.stringify(ready) : ''
          if (signature !== appliedRenderCache) { appliedRenderCache = signature; renderer.setRenderCache(ready) }
        }
        const divisor = captureFull > 0 ? 1 : videoEditPreviewDivisor(getVideoEditPlaybackResolution(instance.document.id), current.playing)
        if (divisor !== appliedDivisor) {
          await renderer.setRenderDivisor(divisor)
          if (stopped) return
          appliedDivisor = divisor; lastRequested = -1
        }
        if (current.playing && (!wasPlaying || direction !== current.playbackDirection || activeCommand !== command)) {
          // 上一轮（定位前）的帧还占着渲染队列：等它们回执再起播（回执会唤醒调度），起播帧不排到满队列后面被拒。
          if (framesInFlight >= PROGRAM_FRAMES_IN_FLIGHT) return
          stopAudio(); direction = current.playbackDirection
          const phaseStart = performance.now()
          await yieldVideoEditSource(instance.document.id)
          const phaseYield = performance.now()
          if (stopped || !current.playing || videoEditProgramCommandIdentity(instance.document.id) !== command) { wake(0); return }
          const initialFrame = current.frame
          const requestedAt = performance.now()
          // 声音设备与第一帧并行准备：AudioContext 启动（Windows 首次可达上百毫秒）不再排在第一帧之后。
          const audioReady = direction === 1 && (current.playbackRate ?? 1) === 1 && audibleVideoEditClips(document).length ? (async (): Promise<void> => {
            audio ??= new AudioContext({ sampleRate: document.sampleRate }); await audio.resume()
            const before = audio.currentTime; const waiting = performance.now()
            while (audio.currentTime === before && performance.now() - waiting < 1000 && !stopped) await new Promise(resolve => setTimeout(resolve, 2))
          })() : undefined
          audioReady?.catch(() => undefined)
          playbackShown = -1
          const initialResult = await requestFrame(true, initialFrame, direction === 1, false, undefined, undefined, undefined, 'interactive', historyEnabled)
          if (!stopped) setEffectFailure(initialResult.effectErrors?.join('\n') ?? null)
          if (stopped) { initialResult.history?.close(); return }
          recordVideoEditProgramRender(instance.document.id, document, initialFrame, initialResult, direction === 1)
          if (initialResult.presented === true && recordPresentation(initialFrame, initialResult, requestedAt, false, document)) playbackShown = initialFrame
          if (!current.playing || !listVideoEditInstances().includes(instance) || videoMotionComposition(instance) !== document || videoEditProgramCommandIdentity(instance.document.id) !== command) { wasPlaying = false; wake(0); return }
          if (initialResult.presented === false) { lastFrame = -1; lastRequested = -1; wasPlaying = false; wake(0); return }
          if (initialResult.presented !== true) recordPresentation(initialFrame, initialResult, requestedAt, false, document)
          const phaseFirst = performance.now()
          lastFrame = initialFrame; lastScrubbing = false; pausedPicture = false; submittedFrame = -1; queuedFrame = -1
          lastRequested = initialFrame; lastRequestedPlaying = true; activeCommand = command
          if (audioReady) {
            await audioReady
            if (stopped) return
            if (!current.playing || !listVideoEditInstances().includes(instance) || videoMotionComposition(instance) !== document || videoEditProgramCommandIdentity(instance.document.id) !== command) { wasPlaying = false; wake(0); return }
            if (audio) meter ??= createVideoEditAudioMeter(audio, document.channels)
          }
          if (stopped) return
          // 预热还没混完（刚定位就按空格）不等它：照常留 100ms，晚到的那块由声音排程从中途接上。
          const premixed = firstBlock?.document === document && firstBlock.from === initialFrame / document.fps && firstBlock.ready
          const lead = premixed ? PLAY_PREMIXED_LEAD_SECONDS : 0.1
          // 起点放在两次刷新正中间，避免每帧呈现时刻贴着刷新边界来回跳（见 videoEditDisplayClock）。
          const vsync = displayPeriod ? await nextVideoEditDisplayFrame() : undefined
          displayVsync = vsync; audioOrigin = undefined
          if (stopped) return
          const clockNow = performance.now(); const audioNow = audio?.currentTime ?? 0
          const clockAt = vsync !== undefined && displayPeriod ? alignVideoEditClockToDisplay(clockNow + lead * 1000, vsync, displayPeriod) : clockNow + lead * 1000
          clockStart = audioNow + (clockAt - clockNow) / 1000; startFrame = initialFrame; audioScheduler.start(initialFrame / document.fps)
          if (!current.playing || videoMotionComposition(instance) !== document || videoEditProgramCommandIdentity(instance.document.id) !== command) { wasPlaying = false; wake(0); return }
          clockPerformanceStart = clockAt
          const phases = { at: phaseStart, yieldMs: phaseYield - phaseStart, firstFrameMs: phaseFirst - phaseYield, audioMs: clockNow - phaseFirst, armAheadMs: Number.isFinite(armedAt) ? phaseStart - armedAt : undefined, premixed: !!premixed, cacheHits: initialResult.cacheHits, leadMs: clockAt - clockNow }
          surface.dataset.playStartPhases = JSON.stringify(phases)
          logger.info('节目起播准备完成', { event: 'video_edit.program.play_start', context: { projectId: instance.document.id, sequenceId: document.id, frame: initialFrame, ...phases } })
          surface.dataset.playClockStartAt = String(clockPerformanceStart)
          surface.dataset.playStartFrame = String(startFrame)
          droppedFrames = 0; surface.dataset.droppedFrames = '0'
        }
        if (!current.playing && wasPlaying) { stopAudio(); void flushVideoEditRenderPerformance() }
        wasPlaying = current.playing
        if (current.playing) {
          // 声音为主时钟：正常速度正放有声音时，画面按扬声器实际输出的时刻呈现，长时间播放不因两套时钟的频差漂移。
          if (direction === 1 && (current.playbackRate ?? 1) === 1 && audio && meter && typeof audio.getOutputTimestamp === 'function' && audibleVideoEditClips(document).length) {
            const origin = videoEditAudioClockOrigin(audio.getOutputTimestamp(), clockStart, performance.now())
            if (origin !== undefined) {
              // A slow average of the output timestamps: their jitter must not move individual frames.
              audioOrigin = audioOrigin === undefined ? origin : audioOrigin + (origin - audioOrigin) * 0.02
              clockPerformanceStart = followVideoEditAudioClock(clockPerformanceStart, audioOrigin, displayPeriod ?? 1000 / document.fps, displayVsync)
            }
          }
          const timelineTime = startFrame / document.fps + direction * (current.playbackRate ?? 1) * (performance.now() - clockPerformanceStart) / 1000
          if (direction === 1 ? timelineTime >= videoEditDuration(document) / document.fps && lastFrame >= videoEditDuration(document) - 1 : timelineTime <= 0 && lastFrame <= 0) { setVideoEditView(instance.document.id, { playing: false }, true); stopAudio() }
          if (direction === 1 && (current.playbackRate ?? 1) === 1 && audio && meter && audibleVideoEditClips(document).length) {
            audioScheduler.pump({
              context: audio, destination: meter.input, origin: clockStart - startFrame / document.fps, timelineTime, endTime: videoEditDuration(document) / document.fps,
              mix: (from, duration) => {
                const block = firstBlock; firstBlock = undefined
                return block?.document === document && block.from === from && block.duration === duration ? block.buffer : (audioRenderer ??= new VideoEditRenderSession(document)).mixAudio(from, duration)
              },
              isCurrent: () => !stopped && listVideoEditInstances().includes(instance) && videoMotionComposition(instance) === document && videoEditProgramCommandIdentity(instance.document.id) === command,
              onError: error => { setVideoEditView(instance.document.id, { playing: false }, true); onError(error) },
            })
          }
        }
        // 原地暂停：等播放中发出的画面都回来（还没上屏的已被 Worker 作废，它们的回执会唤醒调度），把播放头落在实际最后上屏的
        // 那一帧，再按精确方式重画它——屏幕最多从预渲染画面换成同一帧的实时画面，不退回、不先闪别的画面。
        if (!current.playing && settlePause) {
          if (playbackInFlight > 0) return
          settlePause = false
          const shown = playbackShown; playbackShown = -1
          if (shown >= 0 && shown !== current.frame && !current.scrubbing) setVideoEditView(instance.document.id, { frame: shown }, true)
          releaseSettleWaiters()
          lastRequested = -1
        }
        const playing = current.playing
        const liveRecording = playing && videoMotionState(current)?.status === 'recording'
        const due = playing ? videoEditLiveFrame(startFrame, performance.now() - clockPerformanceStart, document.fps, current.playbackRate ?? 1, direction, videoEditDuration(document)) : current.frame
        const next = Math.max(lastFrame, submittedFrame, queuedFrame) + 1
        const target = liveRecording ? due : playing ? direction === 1 ? videoEditPlaybackTarget(next, due, startFrame, videoEditDuration(document)) : Math.min(startFrame, Math.max(0, lastFrame - 1)) : current.frame
        // 近似画面停留：指针停住 VIDEO_EDIT_EXACT_AFTER_REST_MS 或已松手，就按精确方式重取这一帧。
        if (!playing && approximateFrame >= 0 && approximateFrame === target && target === lastRequested && (!current.scrubbing && !approximateWhileActive || performance.now() - lastInteractionAt >= VIDEO_EDIT_EXACT_AFTER_REST_MS)) { lastRequested = -1; approximateFrame = -1 }
        const scrubbing = !!current.scrubbing
        // 正向播放与拖动一样两帧流水：这一帧一提交给 GPU 就去准备下一帧，不等它画完再往返一趟，
        // 否则每帧都赶不上下一次刷新，画面成对出现（一帧晚、下一帧紧跟着补上，前一帧根本没显示）。
        // A history bitmap must finish before another draw can overwrite its surface.
        const pipelined = playing && direction === 1 && !liveRecording && !historyEnabled
        if (target !== lastRequested || (lastRequestedScrubbing && !scrubbing)) {
          // 在途画面到了预算就先不发（背压，不是错误）：已发出的帧提交或回执时会唤醒调度，按那时的最新目标再请求。
          if (framesInFlight >= PROGRAM_FRAMES_IN_FLIGHT || pipelined && unsubmitted >= PROGRAM_UNSUBMITTED_FRAMES) return
          if (playing && direction === 1 && !liveRecording && target > Math.max(next, startFrame)) { droppedFrames += target - Math.max(next, startFrame); surface.dataset.droppedFrames = String(droppedFrames) }
          // 快速拖动（相邻两次请求相差至少 VIDEO_EDIT_FAST_SCRUB_FRAMES 帧）与暂停时远距离跳转：要重新定位才到得了的视频先给
          // 解码器最近的一幅，画面跟手，停住或松手后补精确帧；慢速向前拖动与近距离向前步进直接出精确帧，逐帧找点不受影响。
          const fastScrub = scrubbing && lastRequested >= 0 && Math.abs(target - lastRequested) >= VIDEO_EDIT_FAST_SCRUB_FRAMES
          const fastJump = !scrubbing && captureFull === 0 && lastFrame >= 0 && lastRequested >= 0 && Math.abs(target - lastRequested) >= VIDEO_EDIT_FAST_JUMP_FRAMES
          // 操作中的小步后退（拖动刚按下还没移出 3 像素、方向键连按）：长 GOP 视频退一帧要从关键帧重解（4K 录屏可达半秒），
          // 按慢速拖动处理——先沿用当前画面、后台解精确帧，停住后补精确帧，不让这一步堵住后面的画面。
          // 上一个请求是播放帧（流水排在前面）时不算：从播放切到暂停（含暂停时指定位置）不是小步后退。
          const steppingBack = !scrubbing && !fastJump && captureFull === 0 && lastFrame >= 0 && lastRequested >= 0 && !lastRequestedPlaying && target < lastRequested && performance.now() - lastInteractionAt < VIDEO_EDIT_EXACT_AFTER_REST_MS
          const scrubMode: boolean | 'fast' = playing ? scrubbing : fastScrub || fastJump ? 'fast' : steppingBack || scrubbing
          const requestedAt = performance.now()
          const deadline = playing && !liveRecording ? performance.timeOrigin + clockPerformanceStart + Math.abs(target - startFrame) / document.fps / (current.playbackRate ?? 1) * 1000 : undefined
          lastRequested = target; lastRequestedScrubbing = scrubbing; lastRequestedPlaying = playing
          if (pipelined) { unsubmitted++; queuedFrame = Math.max(queuedFrame, target) }
          let submitted = false
          const presentation = requestFrame(playing, target, pipelined, scrubMode, deadline, scrubbing || pipelined ? () => {
            if (pipelined) { submitted = true; unsubmitted--; submittedFrame = Math.max(submittedFrame, target) }
            // 这一帧已交给 GPU：调度交还给 wake 去准备下一帧（还能不能再发由上面的在途预算决定）。
            turn.handOff(); wake(0)
          } : undefined, undefined, 'interactive', historyEnabled, !playing && !scrubbing).finally(() => { if (pipelined && !submitted) unsubmitted-- })
          // 正向播放不等提交回执：这一帧排进 Worker 就去准备下一帧，让它排在这一帧后面，
          // 主线程的时间线更新、电平刷新不会推迟它的准备。
          if (pipelined) { turn.handOff(); wake(0) }
          // 暂停时（拖动、跳转、松手后的精确帧）不等这一帧的回执就交出调度（主线程忙于指针事件与界面更新，回执要晚 7–20ms 才
          // 轮到处理）：指针一动，下一帧直接排在它后面，Worker 轮到一帧时若已有更新的请求就跳过它（答复 skipped）；前一次点击的
          // 精确画面还在准备（长 GOP 可达一秒）时，新的点击也能马上发出，由 Worker 在队列外先画常驻关键帧。
          else if (!playing && captureFull === 0 && !historyEnabled) turn.handOff()
          let result: Awaited<typeof presentation>
          try { result = await presentation } catch (error) {
            if (!(error instanceof VideoEditRenderBusyError)) throw error
            // 渲染队列排满是背压：这一帧没排上，稍后按最新状态重新请求；不停播、不提示失败。
            if (queuedFrame === target) queuedFrame = target - 1
            lastRequested = -1
            logger.debug('节目渲染队列已满，稍后重新请求', { event: 'video_edit.preview.render_backpressure', context: { projectId: instance.document.id, frame: target, playing } })
            wake(PROGRAM_BUSY_RETRY_MS); return
          }
          // 拖动中被更新的请求取代、没有画的一帧：后面那一帧会照常回来，这里只唤醒调度。
          if (result.skipped) { wake(0); return }
          if (submittedFrame === target) submittedFrame = -1
          if (queuedFrame === target && unsubmitted === 0) queuedFrame = -1
          {
            // A completed seek is useful while the pointer keeps moving. Only a different
            // document/lifetime invalidates it; the next iteration reads the latest target.
            if (stopped || !listVideoEditInstances().includes(instance)) { result.history?.close(); return }
            if (videoMotionComposition(current) !== document) {
              // An already submitted draw cannot be undone by a later parameter edit.
              // Report that same-surface fact without advancing the new document's clock.
              if (result.presented === true && recordPresentation(target, result, requestedAt, scrubbing, document) && playing) playbackShown = target
              const latest = videoMotionComposition(current)
              if (result.presented === true && pipelined && current.playing && current.playbackDirection === direction && videoEditProgramCommandIdentity(current.document.id) === command && latest && videoEditParameterUpdate(document, latest)) { lastFrame = Math.max(lastFrame, target); pausedPicture = false }
              wake(0); return
            }
            recordVideoEditProgramRender(instance.document.id, document, target, result, playing && direction === 1 && !scrubbing && !liveRecording)
            if (result.presented === false) { if (!liveRecording) lastFrame = -1; lastRequested = -1; wake(0); return }
            if (!recordPresentation(target, result, requestedAt, scrubbing, document)) { wake(0); return }
            if (playing) playbackShown = target
            approximateFrame = result.approximate ? target : -1; approximateWhileActive = !!result.approximate && steppingBack
            setEffectFailure(result.effectErrors?.join('\n') ?? null)
            lastFrame = target; lastScrubbing = scrubbing; pausedPicture = !playing && !scrubbing && !result.approximate
            if (playing && current.playing && current.playbackDirection === direction && videoEditProgramCommandIdentity(instance.document.id) === command) setVideoEditView(instance.document.id, { frame: target }, true)
          }
          // 已交出调度的一步只收尾自己这一帧：唤醒调度按新状态推进，预热与下一帧都由那一步决定。
          if (turn.released) { wake(0); return }
        }
        // 首帧后的第一秒留给用户操作；停稳且没有输入时再准备声音与前向解码，播放命令仍可按需准备。
        // 按住拖动播放头期间不预热：预热要打开连续解码并预混首段声音（复杂工程约 0.6 秒），循环等它完成期间不再请求新画面，
        // 拖动方向反转、指针短暂停住时就出现半秒以上的停顿；松手时由上面的 releasedScrub 预热一次，起播照样即时。
        if (!playing && approximateFrame < 0 && performance.now() - firstPresentationAt >= 1100 && !current.scrubbing && (armedDocument !== undefined || performance.now() - lastInteractionAt >= 180) && lastFrame === current.frame && current.frame === lastRequested && !!current.scrubbing === lastScrubbing && (armedDocument !== document || armedFrame !== current.frame) && captureFull === 0) {
          await preparePlayback(document, current.frame)
          if (stopped) return
          // 刷新周期在后台量，不挡住紧接着的起播。
          if (performance.now() - displayMeasuredAt > DISPLAY_PERIOD_REFRESH_MS) { displayMeasuredAt = performance.now(); void measureVideoEditDisplayPeriod().then(period => { if (period) displayPeriod = period }) }
          if (stopped) return
        }
        wake(current.playing ? 0 : 2)
      } catch (error) {
        if (stopped || !listVideoEditInstances().includes(instance)) return
        if (error instanceof VideoEditRenderBusyError) {
          // 文档、分辨率或预热请求没排上同样是背压：下一步按最新状态重试，不停播、不提示失败。
          logger.debug('节目渲染队列已满，稍后重试', { event: 'video_edit.preview.render_backpressure', context: { projectId: instance.document.id, playing: instance.playing } })
          wake(PROGRAM_BUSY_RETRY_MS); return
        }
        if (videoMotionComposition(instance) !== requestDocument || videoEditProgramCommandIdentity(instance.document.id) !== requestCommand) { wake(0); return }
        setVideoEditView(instance.document.id, { playing: false }, true)
        // Shown on the program monitor itself and cleared by the next presented frame.
        logger.warn('节目画面渲染失败', { event: 'video_edit.preview.render_failed', error, context: { projectId: instance.document.id, revision: requestDocument.revision, cause: error instanceof Error && error.cause instanceof Error ? error.cause.message : undefined } })
        if (error instanceof VideoEditGpuDeviceLostError) {
          const now = Date.now()
          gpuRecoveryTimes.current = gpuRecoveryTimes.current.filter(at => now - at < 30_000)
          // A lost device cannot execute another draw. Retire the complete owner (including
          // nested pictures and decoders) before mounting a fresh session on a fresh canvas.
          stop()
          if (gpuRecoveryTimes.current.length < 2) {
            gpuRecoveryTimes.current.push(now)
            logger.info('重新建立节目画面', { event: 'video_edit.preview.gpu_recover', context: { projectId: instance.document.id, attempt: gpuRecoveryTimes.current.length } })
            setRetry(value => value + 1)
          } else setRenderFailure('画面处理连续中断，请重新加载预览；如果仍无法显示，请重启软件。')
          return
        }
        failedDocument = requestDocument; failedFrame = instance.frame; lastFrame = -1; lastRequested = -1
        failedRetryAt = Date.now() + failedRetryMs; failedRetryMs = Math.min(10_000, failedRetryMs * 2)
        setRenderFailure(error instanceof Error ? error.message : String(error))
        wake(250)
      }
    }
    let retired = false
    stopCurrent = (): void => {
      if (retired) return
      void flushVideoEditRenderPerformance()
      retired = true; pauseSettled.current = () => Promise.resolve(); releaseSettleWaiters(); for (const event of idleEvents) window.removeEventListener(event, interaction, true); unregisterCapture(); unsubscribe(); unsubscribeView(); unsubscribeScrub(); unsubscribeMotion(); unsubscribeRegions(); unsubscribeTracks(); clearTimeout(timer); immediate.port1.close(); clearInterval(meterTimer); instance.playing = false; stopAudio(); scrubber.stop()
      const closeAudio = (): Promise<void> | undefined => { meter?.dispose(); return audio?.close() }
      programReleases.set(instance, Promise.allSettled([meter ? finishVideoEditAudioFade().then(closeAudio) : closeAudio(), renderer.dispose(), audioRenderer?.dispose()]))
      retainExplanationPixels(surface, -1)
      explanationSurface?.remove(); explanationSurface = undefined
      surface.remove(); if (canvas.current === surface) canvas.current = null
    }
    void step()
    }
    void initialize().catch(error => { if (!stopped) onError(error) })
    return stop
  }, [instance, onError, retry, visible])
  const busy = collecting || preparing
  /** 选帧、设封面、编辑当前帧：先原地暂停，等播放头落在实际上屏的那一帧（见 `settlePause`），再按那一帧取图。 */
  const pauseForFrame = async (): Promise<void> => { setVideoEditView(instance.document.id, { playing: false }); await pauseSettled.current() }
  const setPosterFrame = (): void => {
    void pauseForFrame().then(() => setVideoEditPosterFrame(instance.document.id)).catch(onError)
  }
  const captureFrame = (): void => {
    setCollecting(true)
    void pauseForFrame().then(() => captureVideoEditProgramFrame(instance.document.id)).then(async output => {
      if (!output) return
      const asset = await collectVideoEditOutput(output, libraryId ? { libraryId } : {})
      if (activeVideoEditInstance() === instance) { useAssetLibraryStore.getState().setSelectedAsset(asset); openAssetLibrary('floating') }
    }).catch(onError).finally(() => setCollecting(false))
  }
  const editFrame = (): void => {
    setCollecting(true)
    void pauseForFrame().then(() => editVideoEditProgramFrame(instance.document.id)).catch(onError).finally(() => setCollecting(false))
  }
  const shortcuts = useSettingsStore(state => state.videoEditShortcuts)
  const buttonIds = useVideoEditMonitorButtonIds('program')
  const projectId = instance.document.id
  const playbackResolution = getVideoEditPlaybackResolution(projectId)
  const changePlaybackResolution = (value: Partial<typeof playbackResolution>): void => { try { setVideoEditPlaybackResolution(projectId, value) } catch (error) { onError(error) } }
  const runCommand = (id: VideoEditCommandId): void => { void executeVideoEditCommand(captureVideoEditCommandContext(projectId, 'program'), id).catch(onError) }
  // 提升／提取的可用判定要试算一次编辑：只在序列、入出点或目标轨道变化时算，不随播放每帧重算。
  const targetTracks = instance.targetTrackIds.join(',')
  const { document: projectDocument, activeSequenceId, inFrame, outFrame } = instance
  const rangeEdits = useMemo(() => {

    const context = captureVideoEditCommandContext(projectId, 'program', { includeClipboard: false })
    return { lift: timelineCommandPresentation(context, 'lift', shortcuts), extract: timelineCommandPresentation(context, 'extract', shortcuts) }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 实例是可变对象：按它的序列、入出点与目标轨道重算
  }, [projectId, projectDocument, activeSequenceId, inFrame, outFrame, targetTracks, shortcuts])
  const commandContext = captureVideoEditCommandContext(projectId, 'program', { includeClipboard: false })
  const programButtons: VideoEditMonitorButtonSpec[] = [
    { id: 'toggle_proxies', title: '切换代理', Icon: ICON_VIDEO_EDIT_PROXY, on: getVideoEditProxyPreference(instance.document.id).enabled, tooltip: '切换代理：看片使用已有代理；导出默认用原片（可在导出设置中选代理）；分析使用原片', onClick: () => { try { setVideoEditProxyPreference(instance.document.id, { enabled: !getVideoEditProxyPreference(instance.document.id).enabled }) } catch (error) { onError(error) } } },
    ...PROGRAM_COMMAND_BUTTONS.map((id): VideoEditMonitorButtonSpec => {
      const command = id === 'lift' || id === 'extract' ? rangeEdits[id] : timelineCommandPresentation(commandContext, id, shortcuts)
      if (id === 'play_pause') return { id, title: command.title, tooltip: command.tooltip, Icon: instance.playing ? Pause : Play, enabled: command.enabled, onClick: () => runCommand(id) }
      return { id, title: command.title, tooltip: id === 'toggle_safe_margins' ? '安全框：动作安全区（93%）与字幕安全区（90%）' : command.tooltip, Icon: PROGRAM_COMMAND_ICONS[id], enabled: command.enabled, on: command.checked, onClick: () => runCommand(id) }
    }),
    { id: 'export_frame', title: '导出帧', tooltip: '导出帧：把当前画面加入资产库', Icon: Camera, enabled: !busy, onClick: captureFrame },
  ]
  const programButtonOf = new Map(programButtons.map(spec => [spec.id, spec]))
  const barButtons = buttonIds.flatMap(id => { const spec = programButtonOf.get(id); return spec ? [spec] : [] })
  const menuButtons = (hiddenIds: readonly string[]) => barButtons.filter(spec => hiddenIds.includes(spec.id))
  // 节目监视器（界面重设计 3.5，设计稿 VideoEdit；剪辑对齐 PR 2.5）：画面区（媒体底 + 右侧纵向电平）+ 唯一一条控制带：
  // 时间码 ｜ 自定义按钮栏（默认同 PR 节目监视器）+“+”按钮编辑器、适应 ｜ 更多（放不下的按钮、不在栏里的工具模式、重新加载、选帧加入资产库、编辑当前帧）。
  // 压在画面上的状态与标注输入用玻璃 / 媒体叠层令牌。
  return <div className="flex min-h-0 flex-1 flex-col bg-panel" onKeyDown={event => {
    if (!multicamView || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || !/^[1-9]$/.test(event.key) || (event.target as HTMLElement).closest('input,textarea,[contenteditable="true"],[role="textbox"]')) return
    const target = videoEditProgramMulticam(instance); const camera = target?.source.multicam?.cameras[Number(event.key) - 1]
    if (!target || !camera) return
    event.preventDefault(); event.stopPropagation()
    try { switchVideoEditMulticam({ projectId: instance.document.id, sequenceId: instance.activeSequenceId, clipId: target.clip.id }, camera.id, instance.playing ? instance.frame : undefined) } catch (error) { onError(error) }
  }}>
    <div className="flex min-h-0 flex-1">
    <div ref={zoom.containerRef} {...zoom.containerProps} className={`relative flex min-h-0 flex-1 bg-media py-3 pl-3 pr-6 ${zoom.containerClass}`}
      onDragOver={event => {
        if (!acceptsVideoEditDrop(event.dataTransfer)) return
        const mode = programDropZoneAt(event)
        const sequence = instance.document.sequences.find(item => item.id === instance.activeSequenceId)
        const replaceable = Boolean(sequence && findVideoEditReplaceTarget(sequence, instance.frame, instance.targetTrackIds))
        // 分区盖住看得见的画面区：“100%”显示滚动过时，叠层按当前滚动位置放，而不是内容原点
        const host = event.currentTarget
        const frame = { left: host.scrollLeft, top: host.scrollTop, width: host.clientWidth, height: host.clientHeight }
        setDropZone(current => current?.mode === mode && current.replaceable === replaceable && current.frame.left === frame.left && current.frame.top === frame.top && current.frame.width === frame.width && current.frame.height === frame.height ? current : { mode, replaceable, frame })
        if (mode === 'replace' && !replaceable) { event.dataTransfer.dropEffect = 'none'; return }
        event.preventDefault(); event.dataTransfer.dropEffect = 'copy'
      }}
      onDragLeave={event => { if (!isDomNode(event.relatedTarget) || !event.currentTarget.contains(event.relatedTarget)) setDropZone(null) }}
      onDrop={event => {
        setDropZone(null)
        if (!acceptsVideoEditDrop(event.dataTransfer)) return
        event.preventDefault(); event.stopPropagation()
        const mode = programDropZoneAt(event)
        try { void dropVideoEditInput(instance.document.id, readVideoEditDrop(event.dataTransfer), { frame: instance.frame, mode }).catch(onError) } catch (error) { onError(error) }
      }}>
      {visible && multicamView && <div className="flex w-1/2 min-w-0 shrink-0 flex-col pr-3"><VideoEditMulticamView instance={instance} onError={onError} /></div>}
      <div className={`relative ${zoom.boxClass} ${multicamView ? 'min-w-0 flex-1' : ''}`} style={zoom.boxStyle} data-monitor-zoom-box data-video-edit-program-display={display === 'fit' ? 'fit' : 'zoom'}>
        <div ref={host} className="relative h-full w-full" onContextMenu={event => {
          const rect = event.currentTarget.getBoundingClientRect(); const point = { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width))), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / Math.max(1, rect.height))) }
          annotationMenu.showMenu(event, [{ id: 'ask', label: '让助手改这里', icon: <PenLine size={UI_ICON_SIZE.sm} />, disabled: instance.playing, onClick: () => { void askAssistantAtVideoEditFrame(instance.document.id, point).catch(onError) } }])
        }}
          onPointerDown={event => { if (videoMotionState(instance)?.status === 'recording') motionGesture.down(event); else if (selecting) picture.down(event) }} onPointerMove={event => { motionGesture.move(event); picture.move(event) }}
          onPointerCancel={() => { motionGesture.cancel(); picture.cancel() }} onLostPointerCapture={() => { motionGesture.cancel(); picture.cancel() }} onPointerUp={event => { motionGesture.up(event); if (selecting) picture.up(event) }} />
        <VideoEditMotionOverlay owner={instance} />
        {!motionRecording && <><VideoEditMaskOverlay instance={instance} onError={onError} />
        <VideoEditTrackingOverlay instance={instance} onError={onError} />
        <VideoEditTextOverlay instance={instance} onError={onError} enabled={visible} />
        <VideoEditAnnotationOverlay instance={instance} active={visible && instance.tool === 'annotate'} onError={onError} />
        <VideoEditCodeElementOverlay instance={instance} enabled={visible} onError={onError} /></>}
        <VideoEditSafeMarginsOverlay />
      </div>
      <VideoEditLevelMeter className="absolute bottom-3 right-2 top-3" levels={levels.length ? levels : Array.from({ length: document.channels }, () => ({ peak: 0, rms: 0 }))} title="节目播放电平" />
      {!pictureReady && !renderFailure && <div className="pointer-events-none absolute inset-0 flex items-center justify-center" data-video-edit-program-preparing>
        {/* 节目底是不随主题的媒体黑：放在玻璃浮层里，浅色主题下文字也看得清 */}
        <div className="ui-glass rounded-xl px-4"><UiLoading size="sm" message="正在准备画面…" /></div>
      </div>}
      {(preparing || collecting) && <div className="absolute left-2 top-2 flex max-w-full items-center gap-2 rounded-lg bg-media-scrim p-1 text-xs text-on-media">
        {preparing && <><span className="whitespace-nowrap px-1">正在准备流畅预览…</span><UiButton variant="media" size="sm" onClick={() => { stopPreview.current(); setPreparing(false) }}>取消准备</UiButton></>}
        {collecting && !preparing && <span className="whitespace-nowrap px-1">正在处理当前帧…</span>}
      </div>}
      {(renderFailure || effectFailure) && <div className="pointer-events-none absolute inset-x-6 bottom-3 flex justify-center">
        <UiPanel className="pointer-events-auto max-w-md px-3 py-2">
          {renderFailure ? <UiError title="节目画面无法显示" message={renderFailure} /> : <UiError title="部分效果已跳过" message={effectFailure ?? ''} />}
        </UiPanel>
      </div>}
      {dropZone && <div className="pointer-events-none absolute grid grid-cols-4 grid-rows-5 bg-media-scrim" style={dropZone.frame} aria-hidden>
        {PROGRAM_DROP_ZONES.map(zone => {
          const disabled = zone.mode === 'replace' && !dropZone.replaceable; const active = dropZone.mode === zone.mode && !disabled
          // ui-surface-allow: S4 节目画面上的拖放热区是空间叠层，各格已有边界，不是纵向记录列表；u6。
          return <div key={zone.mode} className={`flex min-h-0 min-w-0 flex-col items-center justify-center gap-0.5 overflow-hidden border px-2 text-center text-on-media transition-colors duration-120 ${zone.cell} ${active ? 'border-accent bg-accent/30' : 'border-media-line'} ${disabled ? 'opacity-50' : ''}`}>
            <span className="truncate text-13 font-semibold">{zone.label}</span>
            <span className="max-w-full truncate text-2xs">{disabled ? '播放头下没有片段' : zone.hint}</span>
          </div>
        })}
      </div>}
    </div>
    </div>
    {/* 节目监视器控制条单行（5.8 toolbarWrap）：窄面板下先让出时间码（时间线左上角有同一读数），
        再把显示比例与节目工具按优先级收进“更多”，不再折成多行 */}
    <div ref={programToolbarRef} className="flex min-h-10 shrink-0 items-center gap-x-1 whitespace-nowrap border-t border-line px-2 py-1" role="toolbar" aria-label="节目监视器控制">
      <VideoEditMotionControls owner={instance} onError={onError} />
      <VideoEditExplanationControls owner={instance} onError={onError} />
      <ContextMenu surface="glass" visible={annotationMenu.menuVisible} items={annotationMenu.menuItems} position={annotationMenu.menuPosition} onClose={annotationMenu.hideMenu} />
      {compactProgramToolbar ? null : <VideoEditTimecode instance={instance} label="节目时间码" className="w-28 px-1.5 text-13" />}
      {compactProgramToolbar ? null : <VideoEditInOutDuration instance={instance} className="px-1.5 text-xs" />}
      <UiOverflowRow
        className="flex-1 justify-center gap-0.5"
        alwaysShowOverflow
        items={[
          ...barButtons.map(spec => ({ id: spec.id, priority: PROGRAM_BUTTON_PRIORITY[spec.id as VideoEditProgramButtonId] ?? 10, node: <VideoEditMonitorButton spec={spec} /> })),
          { id: 'button_editor', priority: 0, pinned: true, node: <VideoEditMonitorButtonEditor kind="program" specs={programButtons} /> },
          { id: 'display', priority: 0, node: <div className="ml-2">{zoom.dropdown}</div> },
          { id: 'resolution', priority: 0, node: <Tooltip content={PLAYBACK_RESOLUTION_TIP}><div><Dropdown<VideoEditPlaybackResolution> ariaLabel="回放分辨率" appearance="text" size="sm" value={playbackResolution.resolution} options={PLAYBACK_RESOLUTION_OPTIONS} onSelect={resolution => changePlaybackResolution({ resolution })} /></div></Tooltip> },
        ]}
        renderOverflow={hiddenIds => <PanelTrigger panelSize="menu" zIndex={Z_LAYERS.dropdown} closeOnPanelClick panelPadding="menu" renderPanel={() => <div className="flex flex-col gap-1">
        {menuButtons(hiddenIds).length > 0 && <div className="flex flex-col gap-1" role="group" aria-label="收起的按钮">
          {menuButtons(hiddenIds).map(spec => <UiOptionButton key={spec.id} variant="menu" size="sm" className="gap-2" disabled={spec.enabled === false} tooltip={spec.tooltip} onClick={spec.onClick}><spec.Icon size={UI_ICON_SIZE.sm} />{spec.title}</UiOptionButton>)}
        </div>}
        {hiddenIds.includes('display') && <div className="flex flex-col gap-1" role="group" aria-label="节目显示比例">
          {PROGRAM_DISPLAY_OPTIONS.map(option => <UiOptionButton key={option.value} variant="menu" size="sm" active={option.value === 'fit' ? display === 'fit' : display === 1} onClick={() => zoom.setDisplay(option.value === 'fit' ? 'fit' : 1)}>显示 {option.label}</UiOptionButton>)}
        </div>}
        {hiddenIds.includes('resolution') && <div className="flex flex-col gap-1" role="group" aria-label="回放分辨率">
          {PLAYBACK_RESOLUTION_OPTIONS.map(option => <UiOptionButton key={option.value} variant="menu" size="sm" active={playbackResolution.resolution === option.value} tooltip={PLAYBACK_RESOLUTION_TIP} onClick={() => changePlaybackResolution({ resolution: option.value })}>回放 {option.label}</UiOptionButton>)}
        </div>}
        <UiOptionButton variant="menu" size="sm" active={multicamView} onClick={() => setMulticamView(value => !value)}>多机位视图（1–9 切换）</UiOptionButton>
        <UiOptionButton variant="menu" size="sm" disabled={!multicam || instance.playing} onClick={() => { if (multicam) void autoSwitchVideoEditMulticam({ projectId: instance.document.id, sequenceId: instance.activeSequenceId, clipId: multicam.clip.id }).catch(onError) }}>建议机位切换</UiOptionButton>
        <UiOptionButton variant="menu" size="sm" className="gap-2" active={!playbackResolution.fullWhenPaused} disabled={playbackResolution.resolution === 'full'} tooltip="默认暂停时回到完整分辨率以便看清细节；打开后暂停时也保持所选回放分辨率" onClick={() => changePlaybackResolution({ fullWhenPaused: !playbackResolution.fullWhenPaused })}><Gauge size={UI_ICON_SIZE.sm} />暂停时也用此分辨率</UiOptionButton>
        <UiOptionButton variant="menu" size="sm" className="gap-2" disabled={preparing} onClick={() => setRetry(value => value + 1)}><RotateCcw size={UI_ICON_SIZE.sm} />重新加载预览</UiOptionButton>
        <UiOptionButton variant="menu" size="sm" className="gap-2" disabled={busy} onClick={captureFrame}><ImagePlus size={UI_ICON_SIZE.sm} />选帧加入资产库</UiOptionButton>
        <UiOptionButton variant="menu" size="sm" className="gap-2" disabled={busy} onClick={() => setCanvasSend({ projectId: instance.document.id, sequenceId: instance.activeSequenceId, source: { kind: 'frame', frame: instance.frame } })}><ICON_WORKSPACE_CANVAS size={UI_ICON_SIZE.sm} />发送当前帧到画布</UiOptionButton>
        <UiOptionButton variant="menu" size="sm" className="gap-2" disabled={busy} tooltip="把当前画面作为项目列表里的封面" onClick={setPosterFrame}><ImageUp size={UI_ICON_SIZE.sm} />设为项目封面</UiOptionButton>
        {instance.document.posterFrame && <UiOptionButton variant="menu" size="sm" className="gap-2" tooltip="不再固定封面，保存时按剪辑内容自动更新" onClick={() => { try { clearVideoEditPosterFrame(instance.document.id) } catch (error) { onError(error) } }}><RotateCcw size={UI_ICON_SIZE.sm} />恢复自动封面</UiOptionButton>}
        <UiOptionButton variant="menu" size="sm" className="gap-2" disabled={busy} tooltip="在图片编辑中修改当前帧，完成后可替换回原时刻的一帧" onClick={editFrame}><PenLine size={UI_ICON_SIZE.sm} />编辑当前帧</UiOptionButton>
      </div>}>
        {({ open, togglePanel }) => <UiIconButton size="sm" aria-label="更多节目操作" tooltip="更多：重新加载预览、选帧加入资产库、编辑当前帧" aria-expanded={open} data-panel-trigger-button onClick={togglePanel}><MoreHorizontal /></UiIconButton>}
      </PanelTrigger>}
 />
    </div>
    {canvasSend && <VideoEditCanvasSendDialog request={canvasSend} onClose={() => setCanvasSend(null)} />}
  </div>
}

export function VideoEditPreview(props: Parameters<typeof VideoEditPreviewContent>[0]): React.ReactElement {
  // 序列从无到有、或被全部删除时要在“预热 + 空状态”和真实节目画面之间切换，外层也要随视图更新。
  useSyncExternalStore(subscribeVideoEditView, videoEditViewRevision)
  return props.instance.activeSequenceId ? <VideoEditPreviewContent {...props} /> : <><UiEmpty className="h-full" title="没有序列" />{props.visible !== false && <VideoEditProgramPrewarm />}</>
}
