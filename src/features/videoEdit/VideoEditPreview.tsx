import ContextMenu from '@/components/ContextMenu'
import { useContextMenu } from '@/hooks/useContextMenu'
import { VideoEditAnnotationQueueButton } from './panels/VideoEditAnnotationsPanel'
import { VideoEditAnnotationOverlay, type VideoEditAnnotationMode } from './VideoEditAnnotationOverlay'
import { VideoEditCodeElementOverlay } from './VideoEditCodeElementOverlay'
import { registerVideoEditAnnotationMonitor, askAssistantAtVideoEditFrame } from './application/videoEditAnnotations'
import { VideoEditMulticamView } from './panels/VideoEditMulticamView'
import { ICON_VIDEO_EDIT_PROXY } from '@/core/theme/icons'
import { autoSwitchVideoEditMulticam, switchVideoEditMulticam, videoEditProgramMulticam } from './application/videoEditMulticam'
import { getVideoEditProxyPreference, setVideoEditProxyPreference, videoEditProxySignature } from './application/videoEditProxy'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Dropdown, PanelTrigger, UiButton, UiEmpty, UiError, UiIconButton,  UiOptionButton, UiOverflowRow, UiPanel } from '@/components/ui'
import { ArrowRightFromLine, ArrowRightToLine, ArrowUpFromLine, BookmarkPlus, Camera, ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Eraser, FastForward, Gauge, FoldHorizontal, ImagePlus, ImageUp, MapPin, MoreHorizontal, MousePointer2, Move, Pause, PenLine, Play, Rewind, RotateCcw, SkipBack, SkipForward, Square, SquareDashed, StepBack, StepForward, type LucideIcon } from 'lucide-react'
import Tooltip from '@/components/ui/Tooltip'
import { Z_LAYERS } from '@/core/theme/zLayers'
import { audibleVideoEditClips, videoEditDuration } from '@/core/videoEdit/document'
import { VideoEditRenderSession } from './engine/videoEditRenderSession'
import { acceptsVideoEditDrop, dropVideoEditInput, readVideoEditDrop } from './application/videoEditDrop'
import { findVideoEditReplaceTarget, type VideoEditDropMode } from '@/core/videoEdit/dropPlacement'
import { isDomNode } from '@/utils/crossRealmDom'
import { activeVideoEditInstance, getActiveVideoEditSequence, findActiveVideoEditSequence, requireVideoEditInstance, listVideoEditInstances, setVideoEditView, setVideoEditTimelineView, subscribeVideoEditDomain, subscribeVideoEditView, videoEditViewRevision, videoEditProgramCommandIdentity, type VideoEditInstance } from './application/videoEditService'
import { yieldVideoEditSource } from './application/videoEditSource'
import { subscribeVideoEditTracking, videoEditTrackResults } from './application/videoEditTracking'
import { subscribeVideoEditSmartRegions, videoEditSmartRegionSegments } from './application/videoEditSmartRegions'
import { createVideoEditAudioMeter, type VideoEditAudioLevel } from './engine/videoEditAudioMeter'
import { VIDEO_EDIT_AUDIO_BLOCK_SECONDS, VideoEditAudioScheduler } from './engine/videoEditAudioScheduler'
import { alignVideoEditClockToDisplay, measureVideoEditDisplayPeriod, nextVideoEditDisplayFrame } from './engine/videoEditDisplayClock'
import { VideoEditLevelMeter } from './panels/VideoEditLevelMeter'
import { VideoEditTrackingOverlay } from './panels/VideoEditTrackingOverlay'
import { VideoEditMaskOverlay } from './panels/VideoEditMaskOverlay'
import { VideoEditTextOverlay } from './panels/VideoEditTextOverlay'
import { useVideoEditPictureGesture } from './panels/useVideoEditPictureGesture'
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

const logger = createLogger('features.videoEdit.preview')
/** 节目控制条低于这个宽度时不显示时间码：时间码 112 + 默认按钮 ~360 + 显示比例 ~70 + 回放分辨率 ~56 + 更多 28 + 间距 */
const PROGRAM_TOOLBAR_TIMECODE_MIN_WIDTH = 656
/** 收进“更多”时的常用显示比例（完整等级在显示比例下拉里）。 */
const PROGRAM_DISPLAY_OPTIONS = [{ value: 'fit' as const, label: '适合' }, { value: 'actual' as const, label: '100%' }]
/** 节目监视器的工具模式：选中态开关（不是动作按钮），名称与标注逻辑不变；默认不在按钮栏，不在栏里时从“更多”切换。 */
const PROGRAM_MODES = [{ id: 'select', title: '选择', Icon: MousePointer2 }, { id: 'move', title: '移动画面', Icon: Move }, { id: 'point', title: '点标注', Icon: MapPin }, { id: 'region', title: '区域标注', Icon: SquareDashed }, { id: 'stroke', title: '画笔标注', Icon: PenLine }] as const
/** 节目按钮栏里走剪辑命令的按钮（名称、快捷键与启用状态来自正式命令）。 */
const PROGRAM_COMMAND_BUTTONS = ['add_marker', 'mark_in', 'mark_out', 'clear_in_out', 'go_in', 'go_out', 'go_start', 'step_back_five', 'step_back', 'play_reverse', 'play_stop', 'play_pause', 'play_forward', 'step_forward', 'step_forward_five', 'go_end', 'go_prev_edit', 'go_next_edit', 'lift', 'extract'] as const satisfies readonly (VideoEditProgramButtonId & VideoEditCommandId)[]
const PROGRAM_COMMAND_ICONS: Record<Exclude<typeof PROGRAM_COMMAND_BUTTONS[number], 'play_pause'>, LucideIcon> = {
  add_marker: BookmarkPlus, mark_in: ArrowRightFromLine, mark_out: ArrowRightToLine, clear_in_out: Eraser, go_in: ChevronFirst, go_out: ChevronLast,
  go_start: SkipBack, step_back_five: ChevronsLeft, step_back: ChevronLeft, play_reverse: Rewind, play_stop: Square, play_forward: FastForward,
  step_forward: ChevronRight, step_forward_five: ChevronsRight, go_end: SkipForward, go_prev_edit: StepBack, go_next_edit: StepForward, lift: ArrowUpFromLine, extract: FoldHorizontal,
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

/** The Program GPU surface belongs to the project: a remount (dock ↔ popout window) waits until the previous session actually retired. */
/**
 * 起播预热的时机：点击定位、松手后画面一出来就预热（人从松手到按空格至少一两百毫秒，正好用来解码）；
 * 拖动中指针停住这么久也预热，再动一下即中止（取消原生解码很便宜）。
 */
const PLAY_ARM_SCRUB_REST_MS = 120
/** 刷新周期每隔这么久才重新量一次（窗口可能被拖到另一块显示器）。 */
const DISPLAY_PERIOD_REFRESH_MS = 5000
/** 第一块声音已混好时的起播提前量：只够把它排进声音时钟。 */
const PLAY_PREMIXED_LEAD_SECONDS = 0.03
const programReleases = new WeakMap<VideoEditInstance, Promise<unknown>>()
function VideoEditPreviewContent({ instance, onError, visible = true }: { instance: VideoEditInstance; onError: (error: unknown) => void; visible?: boolean }): React.ReactElement {
  const annotationMenu = useContextMenu()
  const [multicamView, setMulticamView] = useState(false)
  const multicam = videoEditProgramMulticam(instance)
  const [canvasSend, setCanvasSend] = useState<VideoEditCanvasSendRequest | null>(null)
  useSyncExternalStore(subscribeVideoEditView, videoEditViewRevision)
  const host = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const [mode, setMode] = useState<VideoEditAnnotationMode>('select')
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
  const picture = useVideoEditPictureGesture(instance, visible && mode === 'move', onError)
  useEffect(() => { if (instance.tool === 'type') setMode('select') }, [instance.tool])
  const changeMode = useCallback((next: VideoEditAnnotationMode): void => {
    if (instance.tool === 'type') setVideoEditTimelineView(instance.document.id, { tool: 'select' })
    setVideoEditView(instance.document.id, { playing: false }); setMode(next)
  }, [instance])
  useEffect(() => {
    if (!visible) return
    return registerVideoEditAnnotationMonitor(instance.document.id, action => {
      if (action === 'ask') void askAssistantAtVideoEditFrame(instance.document.id).catch(onError)
      else changeMode(action)
    })
  }, [instance, visible, onError, changeMode])
  const [preparing, setPreparing] = useState(false)
  const [retry, setRetry] = useState(0)
  const [effectFailure, setEffectFailure] = useState<string | null>(null)
  const [renderFailure, setRenderFailure] = useState<string | null>(null)
  const [collecting, setCollecting] = useState(false)
  /** 正在拖入时指针所在的落点区；替换区在播放头下没有片段时不可用。 */
  const [dropZone, setDropZone] = useState<{ mode: VideoEditDropMode; replaceable: boolean; frame: { left: number; top: number; width: number; height: number } } | null>(null)
  const libraryId = useAssetLibraryStore(state => state.libraryId)
  const session = useRef<VideoEditRenderSession | null>(null)
  const stopPreview = useRef<() => void>(() => {})
  const document = getActiveVideoEditSequence(instance)
  // 显示比例与缩放（Premiere：滚轮缩放、中键平移、下拉选等级或“适合”）
  const zoom = useMonitorZoom({ width: document.width, height: document.height, label: '节目显示比例' })
  const display = zoom.display
  useEffect(() => {
    if (!visible) { setVideoEditView(instance.document.id, { playing: false }, true); setPreparing(false); setLevels([]); return }
    const previousRelease = programReleases.get(instance) ?? Promise.resolve()
    setRenderFailure(null); setEffectFailure(null)
    let stopped = false
    let stopCurrent: () => void = () => {}
    const stop = (): void => { stopped = true; stopCurrent() }
    stopPreview.current = stop
    const initialize = async (): Promise<void> => {
    // A new sequence has its own renderer target; release the previous GPU/cache owner first.
    await previousRelease
    if (stopped) return
    const initialDocument = getActiveVideoEditSequence(instance)
    const surface = window.document.createElement('canvas')
    surface.width = initialDocument.width; surface.height = initialDocument.height
    surface.setAttribute('aria-label', '剪辑画面'); surface.className = 'h-full w-full object-contain'
    host.current?.replaceChildren(surface); canvas.current = surface
    const renderer = new VideoEditRenderSession(initialDocument, initialDocument.width, active => { if (!stopped) setPreparing(active) }, surface.transferControlToOffscreen(), undefined, instance.document.id); session.current = renderer
    const unsubscribe = subscribeVideoEditDomain(() => {
      if (stopped) return
      if (findActiveVideoEditSequence(instance) !== appliedDocument) { stopAudio(); setLevels([]) }
      renderer.invalidateDocument(instance.document.revision)
    })
    const unsubscribeView = subscribeVideoEditView(() => {
      if (stopped) return
      if (!instance.playing || instance.playbackDirection !== direction || activeCommand && videoEditProgramCommandIdentity(instance.document.id) !== activeCommand) { stopAudio(); setLevels([]) }
    })
    let audioRenderer: VideoEditRenderSession | undefined
    let appliedProxy = videoEditProxySignature(instance.document.id)
    let appliedDocument = initialDocument
    let timer: ReturnType<typeof setTimeout>
    let audio: AudioContext | undefined
    let meter: ReturnType<typeof createVideoEditAudioMeter> | undefined
    let lastRequested = -1
    let lastFrame = -1
    let lastScrubbing = false
    let clockStart = 0
    let clockPerformanceStart = 0
    let startFrame = 0
    let wasPlaying = false
    let direction: 1 | -1 = 1
    let activeCommand: object | undefined
    let armedDocument: VideoEditComposition | undefined
    let armedFrame = -1
    /** 已提交给 GPU、结果还没回来的正向播放帧（两帧流水，见下方 present）。 */
    let submittedFrame = -1
    let playbackInFlight = 0
    // 起播预热时提前混好的第一块声音：起播时钟不必再留 100ms 等混音。
    let displayPeriod: number | undefined
    let displayMeasuredAt = -Infinity
    let firstBlock: { document: VideoEditComposition; from: number; duration: number; buffer: Promise<AudioBuffer>; ready: boolean } | undefined
    // 回放分辨率（4.9）：播放用所选分辨率，暂停默认回到完整；选帧、设封面期间强制完整。
    let appliedDivisor: VideoEditRenderDivisor = 1
    let captureFull = 0
    const audioScheduler = new VideoEditAudioScheduler()
    const stopAudio = (): void => audioScheduler.stop()
    const meterTimer = setInterval(() => { if (!stopped && meter) setLevels(instance.playing && instance.playbackDirection === 1 ? meter.read() : Array.from({ length: appliedDocument.channels }, () => ({ peak: 0, rms: 0 }))) }, 50)
    let lastPresentation = -Infinity
    // 智能区域（4.7d）：分析完成的段落交给渲染 Worker，并重画当前帧（之前跳过了未就绪区域的效果）。
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
    const recordPresentation = (target: number, result: Awaited<ReturnType<VideoEditRenderSession['present']>>, requestedAt: number, scrubbing: boolean, revision: number): boolean => {
      if (stopped || !listVideoEditInstances().includes(instance) || instance.activeSequenceId !== initialDocument.id || session.current !== renderer || canvas.current !== surface || requestedAt < lastPresentation) return false
      lastPresentation = requestedAt
      surface.dataset.requestedAt = String(requestedAt); surface.dataset.renderMs = String(performance.now() - requestedAt)
      surface.dataset.decodeMs = String(result.decodeMs ?? 0); surface.dataset.gpuMs = String(result.gpuMs ?? 0)
      surface.dataset.sourceTimestamps = (result.sourceTimestamps ?? []).join(','); surface.dataset.cacheHits = String(result.cacheHits ?? 0); surface.dataset.cacheBytes = String(result.cacheBytes ?? 0)
      surface.dataset.proxyPreparationMs = String(renderer.previewPreparationMs); surface.dataset.proxyBytes = String(renderer.previewBytes)
      surface.dataset.scrubbing = String(scrubbing); surface.dataset.presentedFrame = String(target)
      surface.dataset.presentedRevision = String(revision); surface.dataset.renderDivisor = String(appliedDivisor)
      if (failedDocument === undefined) { setRenderFailure(null); failedRetryMs = 2000 }
      return true
    }
    const unregisterCapture = registerVideoEditProgramCapture(instance, initialDocument.id, async (request, signal) => {
      const current = (): void => {
        signal?.throwIfAborted(); request.assertCurrent()
        if (stopped || session.current !== renderer || canvas.current !== surface || !surface.isConnected) throw new Error('节目面板已关闭，请重新打开后选帧。')
      }
      const start = performance.now()
      // 选帧与封面始终是完整分辨率：降低了回放分辨率时，先按完整尺寸重画这一帧再取图。
      captureFull++
      try {
        while (appliedProxy !== 'original' || appliedDocument !== request.document || lastFrame !== request.frame || surface.dataset.presentedRevision !== String(request.document.revision) || surface.dataset.scrubbing === 'true' || surface.dataset.renderDivisor !== '1' || surface.width !== request.document.width || surface.height !== request.document.height) {
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
    const loop = async (): Promise<void> => {
      let scheduled = false
      let requestCommand: object | undefined
      let requestDocument = appliedDocument
      try {
        const current = requireVideoEditInstance(instance.document.id)
        const command = videoEditProgramCommandIdentity(instance.document.id)
        const document = findActiveVideoEditSequence(current)
        if (!document) { stopAudio(); return }
        requestCommand = command; requestDocument = document
        if (failedDocument) {
          if (failedDocument === document && failedFrame === current.frame && Date.now() < failedRetryAt) { timer = setTimeout(() => { void loop() }, 250); return }
          failedDocument = undefined
        }
        if (appliedDocument !== document) {
          stopAudio(); wasPlaying = false
          if (appliedDocument.sampleRate !== document.sampleRate || appliedDocument.channels !== document.channels) { meter?.dispose(); meter = undefined; await audio?.close(); audio = undefined; if (!stopped) setLevels([]) }
          await renderer.updateDocument(document, captureFull > 0); await audioRenderer?.updateDocument(document); appliedDocument = document; lastFrame = -1; lastRequested = -1
          if (stopped) return
        }
        const proxySignature = captureFull > 0 ? 'original' : videoEditProxySignature(instance.document.id)
        if (appliedProxy !== proxySignature) {
          stopAudio(); wasPlaying = false; await renderer.updateDocument(document, captureFull > 0); appliedProxy = proxySignature; lastFrame = -1; lastRequested = -1
          if (stopped) return
        }
        const divisor = captureFull > 0 ? 1 : videoEditPreviewDivisor(getVideoEditPlaybackResolution(instance.document.id), current.playing)
        if (divisor !== appliedDivisor) {
          await renderer.setRenderDivisor(divisor)
          if (stopped) return
          appliedDivisor = divisor; lastRequested = -1
        }
        if (current.playing && (!wasPlaying || direction !== current.playbackDirection || activeCommand !== command)) {
          stopAudio(); direction = current.playbackDirection
          const phaseStart = performance.now()
          await yieldVideoEditSource(instance.document.id)
          const phaseYield = performance.now()
          if (stopped || !current.playing || videoEditProgramCommandIdentity(instance.document.id) !== command) { if (!stopped) timer = setTimeout(() => { void loop() }, 0); return }
          const initialFrame = current.frame
          const requestedAt = performance.now()
          // 声音设备与第一帧并行准备：AudioContext 启动（Windows 首次可达上百毫秒）不再排在第一帧之后。
          const audioReady = direction === 1 && audibleVideoEditClips(document).length ? (async (): Promise<void> => {
            audio ??= new AudioContext({ sampleRate: document.sampleRate }); await audio.resume()
            const before = audio.currentTime; const waiting = performance.now()
            while (audio.currentTime === before && performance.now() - waiting < 1000 && !stopped) await new Promise(resolve => setTimeout(resolve, 2))
          })() : undefined
          audioReady?.catch(() => undefined)
          const initialResult = await renderer.present(initialFrame, direction === 1)
          if (!stopped) setEffectFailure(initialResult.effectErrors?.join('\n') ?? null)
          if (stopped) return
          if (initialResult.presented === true) recordPresentation(initialFrame, initialResult, requestedAt, false, document.revision)
          if (!current.playing || !listVideoEditInstances().includes(instance) || findActiveVideoEditSequence(instance) !== document || videoEditProgramCommandIdentity(instance.document.id) !== command) { wasPlaying = false; timer = setTimeout(() => { void loop() }, 0); return }
          if (initialResult.presented === false) { lastFrame = -1; lastRequested = -1; wasPlaying = false; timer = setTimeout(() => { void loop() }, 0); return }
          if (initialResult.presented !== true) recordPresentation(initialFrame, initialResult, requestedAt, false, document.revision)
          const phaseFirst = performance.now()
          lastFrame = initialFrame; lastScrubbing = false; submittedFrame = -1
          lastRequested = initialFrame; activeCommand = command
          if (audioReady) {
            await audioReady
            if (stopped) return
            if (!current.playing || !listVideoEditInstances().includes(instance) || findActiveVideoEditSequence(instance) !== document || videoEditProgramCommandIdentity(instance.document.id) !== command) { wasPlaying = false; timer = setTimeout(() => { void loop() }, 0); return }
            if (audio) meter ??= createVideoEditAudioMeter(audio, document.channels)
          }
          if (stopped) return
          // 预热还没混完（刚定位就按空格）不等它：照常留 100ms，晚到的那块由声音排程从中途接上。
          const premixed = firstBlock?.document === document && firstBlock.from === initialFrame / document.fps && firstBlock.ready
          const lead = premixed ? PLAY_PREMIXED_LEAD_SECONDS : 0.1
          // 起点放在两次刷新正中间，避免每帧呈现时刻贴着刷新边界来回跳（见 videoEditDisplayClock）。
          const vsync = displayPeriod ? await nextVideoEditDisplayFrame() : undefined
          if (stopped) return
          const clockNow = performance.now(); const audioNow = audio?.currentTime ?? 0
          const clockAt = vsync !== undefined && displayPeriod ? alignVideoEditClockToDisplay(clockNow + lead * 1000, vsync, displayPeriod) : clockNow + lead * 1000
          clockStart = audioNow + (clockAt - clockNow) / 1000; startFrame = initialFrame; audioScheduler.start(initialFrame / document.fps)
          if (!current.playing || findActiveVideoEditSequence(instance) !== document || videoEditProgramCommandIdentity(instance.document.id) !== command) { wasPlaying = false; timer = setTimeout(() => { void loop() }, 0); return }
          clockPerformanceStart = clockAt
          surface.dataset.playStartPhases = JSON.stringify({ at: phaseStart, yieldMs: phaseYield - phaseStart, firstFrameMs: phaseFirst - phaseYield, audioMs: clockNow - phaseFirst })
          surface.dataset.playClockStartAt = String(clockPerformanceStart)
          surface.dataset.playStartFrame = String(startFrame)
        }
        if (!current.playing && wasPlaying) stopAudio()
        wasPlaying = current.playing
        if (current.playing) {
          const timelineTime = startFrame / document.fps + direction * (performance.now() - clockPerformanceStart) / 1000
          if (direction === 1 ? timelineTime >= videoEditDuration(document) / document.fps && lastFrame >= videoEditDuration(document) - 1 : timelineTime <= 0 && lastFrame <= 0) { setVideoEditView(instance.document.id, { playing: false }, true); stopAudio() }
          if (direction === 1 && audio && meter && audibleVideoEditClips(document).length) {
            audioScheduler.pump({
              context: audio, destination: meter.input, origin: clockStart - startFrame / document.fps, timelineTime, endTime: videoEditDuration(document) / document.fps,
              mix: (from, duration) => {
                const block = firstBlock; firstBlock = undefined
                return block?.document === document && block.from === from && block.duration === duration ? block.buffer : (audioRenderer ??= new VideoEditRenderSession(document)).mixAudio(from, duration)
              },
              isCurrent: () => !stopped && listVideoEditInstances().includes(instance) && findActiveVideoEditSequence(instance) === document && videoEditProgramCommandIdentity(instance.document.id) === command,
              onError: error => { setVideoEditView(instance.document.id, { playing: false }, true); onError(error) },
            })
          }
        }
        const playing = current.playing
        const target = playing ? direction === 1 ? Math.max(startFrame, Math.min(videoEditDuration(document) - 1, Math.max(lastFrame, submittedFrame) + 1)) : Math.min(startFrame, Math.max(0, lastFrame - 1)) : current.frame
        if (target !== lastRequested || (!!current.scrubbing !== lastScrubbing && !current.scrubbing)) {
          const scrubbing = !!current.scrubbing
          const requestedAt = performance.now()
          const deadline = playing ? performance.timeOrigin + clockPerformanceStart + Math.abs(target - startFrame) / document.fps * 1000 : undefined
          lastRequested = target
          // 正向播放与拖动一样两帧流水：这一帧一提交给 GPU 就去准备下一帧，不等它画完再往返一趟，
          // 否则每帧都赶不上下一次刷新，画面成对出现（一帧晚、下一帧紧跟着补上，前一帧根本没显示）。
          const pipelined = playing && direction === 1
          if (pipelined) playbackInFlight++
          const result = await renderer.present(target, pipelined, scrubbing, deadline, scrubbing || pipelined ? () => {
            if (pipelined) { submittedFrame = target; if (playbackInFlight >= 2) return }
            if (!stopped) { scheduled = true; timer = setTimeout(() => { void loop() }, 0) }
          } : undefined).finally(() => { if (pipelined) playbackInFlight-- })
          if (submittedFrame === target) submittedFrame = -1
          {
            // A completed seek is useful while the pointer keeps moving. Only a different
            // document/lifetime invalidates it; the next iteration reads the latest target.
            if (stopped || !listVideoEditInstances().includes(instance)) return
            if (findActiveVideoEditSequence(current) !== document) {
              // An already submitted draw cannot be undone by a later parameter edit.
              // Report that same-surface fact without advancing the new document's clock.
              if (result.presented === true) recordPresentation(target, result, requestedAt, scrubbing, document.revision)
              if (!scheduled) timer = setTimeout(() => { void loop() }, 0)
              return
            }
            if (result.presented === false) { lastFrame = -1; lastRequested = -1; if (!scheduled) timer = setTimeout(() => { void loop() }, 0); return }
            if (!recordPresentation(target, result, requestedAt, scrubbing, document.revision)) { if (!scheduled) timer = setTimeout(() => { void loop() }, 0); return }
            setEffectFailure(result.effectErrors?.join('\n') ?? null)
            lastFrame = target; lastScrubbing = scrubbing
            if (playing && current.playing && current.playbackDirection === direction && videoEditProgramCommandIdentity(instance.document.id) === command) setVideoEditView(instance.document.id, { frame: target }, true)
          }
        }
        // 起播预热：暂停画面一出来，就在后台把前向解码定位到播放头（从关键帧解到当前帧），按下播放即可直接出下一帧。
        if (!playing && lastFrame === current.frame && current.frame === lastRequested && !!current.scrubbing === lastScrubbing && (armedDocument !== document || armedFrame !== current.frame) && (!current.scrubbing || performance.now() - lastPresentation > PLAY_ARM_SCRUB_REST_MS) && captureFull === 0) {
          armedDocument = document; armedFrame = current.frame
          // 声音设备一并提前打开（首次创建 AudioContext 在 Windows 上要几百毫秒）。
          firstBlock = undefined
          if (audibleVideoEditClips(document).length && (!audio || audio.sampleRate === document.sampleRate)) {
            audio ??= new AudioContext({ sampleRate: document.sampleRate }); void audio.resume().catch(() => undefined)
            const from = current.frame / document.fps; const duration = Math.min(VIDEO_EDIT_AUDIO_BLOCK_SECONDS, videoEditDuration(document) / document.fps - from)
            if (duration > 0) { const block = { document, from, duration, buffer: (audioRenderer ??= new VideoEditRenderSession(document)).mixAudio(from, duration), ready: false }; firstBlock = block; block.buffer.then(() => { block.ready = true }, () => undefined) }
          }
          // 预热只是提速：失败不影响画面，起播时照常从头定位。
          await Promise.resolve().then(() => renderer.armPlayback(current.frame)).catch(error => logger.debug('起播预热未完成', { event: 'video_edit.preview.arm_failed', error, context: { projectId: instance.document.id } }))
          if (stopped) return
          // 刷新周期在后台量，不挡住紧接着的起播。
          if (performance.now() - displayMeasuredAt > DISPLAY_PERIOD_REFRESH_MS) { displayMeasuredAt = performance.now(); void measureVideoEditDisplayPeriod().then(period => { if (period) displayPeriod = period }) }
          if (stopped) return
        }
        if (!stopped && !scheduled) timer = setTimeout(() => { void loop() }, current.playing ? 0 : 2)
      } catch (error) {
        if (stopped || !listVideoEditInstances().includes(instance)) return
        if (findActiveVideoEditSequence(instance) !== requestDocument || videoEditProgramCommandIdentity(instance.document.id) !== requestCommand) { timer = setTimeout(() => { void loop() }, 0); return }
        setVideoEditView(instance.document.id, { playing: false }, true)
        // Shown on the program monitor itself and cleared by the next presented frame.
        logger.warn('节目画面渲染失败', { event: 'video_edit.preview.render_failed', error, context: { projectId: instance.document.id, revision: requestDocument.revision, cause: error instanceof Error && error.cause instanceof Error ? error.cause.message : undefined } })
        failedDocument = requestDocument; failedFrame = instance.frame; lastFrame = -1; lastRequested = -1
        failedRetryAt = Date.now() + failedRetryMs; failedRetryMs = Math.min(10_000, failedRetryMs * 2)
        setRenderFailure(error instanceof Error ? error.message : String(error))
        timer = setTimeout(() => { void loop() }, 250)
      }
    }
    let retired = false
    stopCurrent = (): void => {
      if (retired) return
      retired = true; unregisterCapture(); unsubscribe(); unsubscribeView(); unsubscribeRegions(); unsubscribeTracks(); clearTimeout(timer); clearInterval(meterTimer); instance.playing = false; stopAudio(); meter?.dispose()
      programReleases.set(instance, Promise.allSettled([audio?.close(), renderer.dispose(), audioRenderer?.dispose()]))
      surface.remove(); if (canvas.current === surface) canvas.current = null
    }
    void loop()
    }
    void initialize().catch(error => { if (!stopped) onError(error) })
    return stop
  }, [instance, instance.activeSequenceId, onError, retry, visible])
  const busy = collecting || preparing
  const setPosterFrame = (): void => {
    setVideoEditView(instance.document.id, { playing: false })
    void setVideoEditPosterFrame(instance.document.id).catch(onError)
  }
  const captureFrame = (): void => {
    setCollecting(true)
    setVideoEditView(instance.document.id, { playing: false })
    void captureVideoEditProgramFrame(instance.document.id).then(async output => {
      if (!output) return
      const asset = await collectVideoEditOutput(output, libraryId ? { libraryId } : {})
      if (activeVideoEditInstance() === instance) { useAssetLibraryStore.getState().setSelectedAsset(asset); openAssetLibrary('floating') }
    }).catch(onError).finally(() => setCollecting(false))
  }
  const editFrame = (): void => {
    setCollecting(true)
    setVideoEditView(instance.document.id, { playing: false })
    void editVideoEditProgramFrame(instance.document.id).catch(onError).finally(() => setCollecting(false))
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
      if (id === 'play_pause') return { id, title: command.title, tooltip: command.tooltip, Icon: instance.playing ? Pause : Play, size: 'lg', enabled: command.enabled, onClick: () => runCommand(id) }
      return { id, title: command.title, tooltip: command.tooltip, Icon: PROGRAM_COMMAND_ICONS[id], enabled: command.enabled, onClick: () => runCommand(id) }
    }),
    { id: 'export_frame', title: '导出帧', tooltip: '导出帧：把当前画面加入资产库', Icon: Camera, enabled: !busy, onClick: captureFrame },
    ...PROGRAM_MODES.map(({ id, title, Icon }): VideoEditMonitorButtonSpec => ({ id: `mode_${id}`, title, Icon, on: mode === id, onClick: () => changeMode(id) })),
  ]
  const programButtonOf = new Map(programButtons.map(spec => [spec.id, spec]))
  const barButtons = buttonIds.flatMap(id => { const spec = programButtonOf.get(id); return spec ? [spec] : [] })
  const menuModes = (hiddenIds: readonly string[]) => PROGRAM_MODES.filter(({ id }) => !buttonIds.includes(`mode_${id}`) || hiddenIds.includes(`mode_${id}`))
  const menuButtons = (hiddenIds: readonly string[]) => barButtons.filter(spec => hiddenIds.includes(spec.id) && !spec.id.startsWith('mode_'))
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
        <div ref={host} className="h-full w-full" onContextMenu={event => {
          const rect = event.currentTarget.getBoundingClientRect(); const point = { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width))), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / Math.max(1, rect.height))) }
          annotationMenu.showMenu(event, [{ id: 'ask', label: '让助手改这里', icon: <PenLine size={14} />, disabled: instance.playing, onClick: () => { void askAssistantAtVideoEditFrame(instance.document.id, point).catch(onError) } }])
        }}
          onPointerDown={event => { if (mode === 'move') picture.down(event) }} onPointerMove={picture.move}
          onPointerCancel={picture.cancel} onLostPointerCapture={picture.cancel} onPointerUp={event => { if (mode === 'move') picture.up(event) }} />
        <VideoEditMaskOverlay instance={instance} onError={onError} />
        <VideoEditTrackingOverlay instance={instance} onError={onError} />
        <VideoEditTextOverlay instance={instance} onError={onError} enabled={visible && mode === 'select'} />
        <VideoEditAnnotationOverlay instance={instance} mode={mode} onError={onError} />
        <VideoEditCodeElementOverlay instance={instance} enabled={visible && mode === 'select'} onError={onError} />
      </div>
      <VideoEditLevelMeter className="absolute bottom-3 right-2 top-3" levels={levels.length ? levels : Array.from({ length: document.channels }, () => ({ peak: 0, rms: 0 }))} title="节目播放电平" />
      {(preparing || collecting) && <div className="absolute left-2 top-2 flex max-w-full items-center gap-2 rounded-lg bg-media-scrim p-1 text-xs text-on-media">
        {preparing && <><span className="whitespace-nowrap px-1">正在准备流畅预览…</span><UiButton variant="media" size="sm" onClick={() => { stopPreview.current(); setPreparing(false) }}>取消准备</UiButton></>}
        {collecting && !preparing && <span className="whitespace-nowrap px-1">正在处理当前帧…</span>}
      </div>}
      {(renderFailure || effectFailure || (mode === 'move' && !instance.selection)) && <div className="pointer-events-none absolute inset-x-6 bottom-3 flex justify-center">
        <UiPanel className="pointer-events-auto max-w-md px-3 py-2">
          {renderFailure ? <UiError title="节目画面无法显示" message={renderFailure} /> : effectFailure ? <UiError title="部分效果已跳过" message={effectFailure} /> : <UiEmpty size="xs" title="请先选择要编辑的片段" />}
        </UiPanel>
      </div>}
      {dropZone && <div className="pointer-events-none absolute grid grid-cols-4 grid-rows-5 bg-media-scrim" style={dropZone.frame} aria-hidden>
        {PROGRAM_DROP_ZONES.map(zone => {
          const disabled = zone.mode === 'replace' && !dropZone.replaceable; const active = dropZone.mode === zone.mode && !disabled
          return <div key={zone.mode} className={`flex min-h-0 min-w-0 flex-col items-center justify-center gap-0.5 overflow-hidden border px-2 text-center text-on-media transition-colors duration-120 ${zone.cell} ${active ? 'border-accent bg-accent/30' : 'border-media-line'} ${disabled ? 'opacity-50' : ''}`}>
            <span className="truncate text-13 font-semibold">{zone.label}</span>
            <span className="max-w-full truncate text-2xs">{disabled ? '播放头下没有片段' : zone.hint}</span>
          </div>
        })}
      </div>}
    </div>
    {/* 节目监视器控制条单行（5.8 toolbarWrap）：窄面板下先让出时间码（时间线工具栏有同一读数），
        再把显示比例与节目工具按优先级收进“更多”，不再折成多行 */}
    <div ref={programToolbarRef} className="flex min-h-10 shrink-0 items-center gap-x-1 whitespace-nowrap border-t border-line px-2 py-1" role="toolbar" aria-label="节目监视器控制">
      <VideoEditAnnotationQueueButton instance={instance} />
      <ContextMenu surface="glass" visible={annotationMenu.menuVisible} items={annotationMenu.menuItems} position={annotationMenu.menuPosition} onClose={annotationMenu.hideMenu} />
      <PanelTrigger label="标注" display={PROGRAM_MODES.find(item => item.id === mode)?.title ?? '选择'} appearance="quiet" panelWidth="content" closeOnPanelClick renderPanel={() => <div role="group" aria-label="标注工具">{PROGRAM_MODES.map(({ id, title, Icon }) => <UiOptionButton key={id} variant="menu" active={mode === id} onClick={() => changeMode(id)}><Icon size={14} />{title}</UiOptionButton>)}<UiOptionButton variant="menu" onClick={() => { void askAssistantAtVideoEditFrame(instance.document.id).catch(onError) }}>让助手改这里</UiOptionButton></div>} />
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
        renderOverflow={hiddenIds => <PanelTrigger panelWidth={200} zIndex={Z_LAYERS.dropdown} closeOnPanelClick panelPadding="menu" renderPanel={() => <div className="flex flex-col gap-1">
        {menuButtons(hiddenIds).length > 0 && <div className="flex flex-col gap-1" role="group" aria-label="收起的按钮">
          {menuButtons(hiddenIds).map(spec => <UiOptionButton key={spec.id} variant="menu" size="sm" className="gap-2" disabled={spec.enabled === false} title={spec.tooltip} onClick={spec.onClick}><spec.Icon size={14} />{spec.title}</UiOptionButton>)}
        </div>}
        {menuModes(hiddenIds).length > 0 && <div className="flex flex-col gap-1" role="group" aria-label="节目工具">
          {menuModes(hiddenIds).map(({ id, title, Icon }) => <UiOptionButton key={id} variant="menu" size="sm" className="gap-2" active={mode === id} onClick={() => changeMode(id)}><Icon size={14} />{title}</UiOptionButton>)}
        </div>}
        {hiddenIds.includes('display') && <div className="flex flex-col gap-1" role="group" aria-label="节目显示比例">
          {PROGRAM_DISPLAY_OPTIONS.map(option => <UiOptionButton key={option.value} variant="menu" size="sm" active={option.value === 'fit' ? display === 'fit' : display === 1} onClick={() => zoom.setDisplay(option.value === 'fit' ? 'fit' : 1)}>显示 {option.label}</UiOptionButton>)}
        </div>}
        {hiddenIds.includes('resolution') && <div className="flex flex-col gap-1" role="group" aria-label="回放分辨率">
          {PLAYBACK_RESOLUTION_OPTIONS.map(option => <UiOptionButton key={option.value} variant="menu" size="sm" active={playbackResolution.resolution === option.value} title={PLAYBACK_RESOLUTION_TIP} onClick={() => changePlaybackResolution({ resolution: option.value })}>回放 {option.label}</UiOptionButton>)}
        </div>}
        <UiOptionButton variant="menu" size="sm" active={multicamView} onClick={() => setMulticamView(value => !value)}>多机位视图（1–9 切换）</UiOptionButton>
        <UiOptionButton variant="menu" size="sm" disabled={!multicam || instance.playing} onClick={() => { if (multicam) void autoSwitchVideoEditMulticam({ projectId: instance.document.id, sequenceId: instance.activeSequenceId, clipId: multicam.clip.id }).catch(onError) }}>建议机位切换</UiOptionButton>
        <UiOptionButton variant="menu" size="sm" className="gap-2" active={!playbackResolution.fullWhenPaused} disabled={playbackResolution.resolution === 'full'} title="默认暂停时回到完整分辨率以便看清细节；打开后暂停时也保持所选回放分辨率" onClick={() => changePlaybackResolution({ fullWhenPaused: !playbackResolution.fullWhenPaused })}><Gauge size={14} />暂停时也用此分辨率</UiOptionButton>
        <UiOptionButton variant="menu" size="sm" className="gap-2" disabled={preparing} onClick={() => setRetry(value => value + 1)}><RotateCcw size={14} />重新加载预览</UiOptionButton>
        <UiOptionButton variant="menu" size="sm" className="gap-2" disabled={busy} onClick={captureFrame}><ImagePlus size={14} />选帧加入资产库</UiOptionButton>
        <UiOptionButton variant="menu" size="sm" className="gap-2" disabled={busy} onClick={() => setCanvasSend({ projectId: instance.document.id, sequenceId: instance.activeSequenceId, source: { kind: 'frame', frame: instance.frame } })}><ICON_WORKSPACE_CANVAS size={14} />发送当前帧到画布</UiOptionButton>
        <UiOptionButton variant="menu" size="sm" className="gap-2" disabled={busy} title="把当前画面作为项目列表里的封面" onClick={setPosterFrame}><ImageUp size={14} />设为项目封面</UiOptionButton>
        {instance.document.posterFrame && <UiOptionButton variant="menu" size="sm" className="gap-2" title="不再固定封面，保存时按剪辑内容自动更新" onClick={() => { try { clearVideoEditPosterFrame(instance.document.id) } catch (error) { onError(error) } }}><RotateCcw size={14} />恢复自动封面</UiOptionButton>}
        <UiOptionButton variant="menu" size="sm" className="gap-2" disabled={busy} title="在图片编辑中修改当前帧，完成后可替换回原时刻的一帧" onClick={editFrame}><PenLine size={14} />编辑当前帧</UiOptionButton>
      </div>}>
        {({ open, togglePanel }) => <UiIconButton aria-label="更多节目操作" title="更多：重新加载预览、选帧加入资产库、编辑当前帧" aria-expanded={open} data-panel-trigger-button onClick={togglePanel}><MoreHorizontal size={16} /></UiIconButton>}
      </PanelTrigger>}
      />
    </div>
    {canvasSend && <VideoEditCanvasSendDialog request={canvasSend} onClose={() => setCanvasSend(null)} />}
  </div>
}

export function VideoEditPreview(props: Parameters<typeof VideoEditPreviewContent>[0]): React.ReactElement {
  return props.instance.activeSequenceId ? <VideoEditPreviewContent {...props} /> : <UiEmpty className="h-full" title="没有序列" />
}
