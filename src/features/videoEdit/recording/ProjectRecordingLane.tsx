import { useEffect, useRef, useState } from 'react'
import { Minus, Plus, Scan, Scissors, SkipBack, SkipForward, Play, Pause, Trash2 } from 'lucide-react'
import { UiIconButton, UiInput, UiRangeInput, UiToolbar } from '@/components/ui'
import { UI_TEXT_NUMERIC_CLASS } from '@/components/ui/styleTokens'
import { videoEditClipLabel } from '@/core/videoEdit/labels'
import { videoEditClipMedia, type VideoEditSequence } from '@/core/videoEdit/document'
import { videoEditRecordingLane, type VideoEditRecordingBlock } from '@/core/videoEdit/recordingLane'
import { videoEditClipSourceSecondsAtTime } from '@/core/videoEdit/clipSpeed'
import { useSettingsStore } from '@/stores/settingsStore'
import { TIMELINE_SELECTED_RING_CLASS, videoEditClipLabelSurface, videoEditClipTitleSurface } from '../timeline/clipLabelSurface'
import { VideoEditClipFilmstrip } from '../timeline/VideoEditClipFilmstrip'
import { VideoEditClipWaveform } from '../timeline/VideoEditClipWaveform'
import { VideoEditTimecode, VideoEditTimelinePlayheadHead } from '../timeline/VideoEditTimelineTransport'
import { timelineCommandPresentation } from '../timeline/timelineCommandPresentation'
import { captureVideoEditCommandContext, executeVideoEditCommand } from '../application/videoEditCommands'
import { useVideoEditViewSelector, sameVideoEditViewFields } from '../application/useVideoEditViewSelector'
import { getActiveVideoEditSequence, setVideoEditView, videoEditRecordingInProgress, videoEditRevision, type VideoEditInstance } from '../application/videoEditService'
import { beginVideoEditTimelineDrag, previewVideoEditTimelineTrim } from '../application/videoEditTimeline'
import { deleteVideoEditRecordingBlock, finishVideoEditRecordingTrim, renameVideoEditRecordingBlock, selectVideoEditRecordingBlock, splitVideoEditRecordingAtPlayhead } from '../application/videoEditRecordingLane'
import { recordingTimeLabel } from '@/features/screenRecording'
import { RECORDING_LANE_HEIGHT, RECORDING_LANE_INSET, RECORDING_LANE_LEFT, RECORDING_CLIP_TITLE_HEIGHT, RECORDING_COVER_HINT_WIDTH, RECORDING_APPEND_SLOT_WIDTH, recordingRulerTicks } from './projectRecordingGeometry'

/** 正在录的那一块：从落点起，宽度随已录时长长出来。 */
export interface ProjectRecordingTake { frame: number; frames: number; saving: boolean }

const shortTime = (frames: number, fps: number): string => recordingTimeLabel(frames / fps * 1000).replace(/^00:/, '')

/**
 * 录制样子的时间轴：播放控制 44、标尺 28、一条录屏轨 92、底栏 32。一个块就是录屏轨上的一个画面片段连同它链接的声音，
 * 带缩略图与波形；拖两端是波纹修剪（后面的块跟着走，不留空隙），剪刀在指针处切开，删除后面的接上来。
 */
export function ProjectRecordingLane({ instance, take, coverHint, onError }: { instance: VideoEditInstance; take: ProjectRecordingTake | null; coverHint: boolean; onError: (error: unknown) => void }): React.ReactElement {
  // 播放时不跟着每一帧重绘整条轨（指针由 LanePlayhead 自己订阅）；停下与拖动时按帧更新切开、空位这类依赖指针的状态。
  useVideoEditViewSelector(() => [videoEditRevision(), instance.playing, instance.playing ? null : instance.frame, instance.selection], sameVideoEditViewFields)
  const projectId = instance.document.id
  const committed = getActiveVideoEditSequence(instance)
  const [preview, setPreview] = useState<VideoEditSequence | null>(null)
  const sequence = preview ?? committed
  const fps = committed.fps
  const lane = videoEditRecordingLane({ ...sequence, items: committed.items, media: committed.media })
  // 助手或快捷键在别处开始的录制也算：录屏写进这份剪辑期间录屏轨不接受编辑。
  const recording = Boolean(take) || videoEditRecordingInProgress(instance)
  const host = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState(0)
  useEffect(() => {
    const element = host.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => setViewport(element.clientWidth))
    observer.observe(element); setViewport(element.clientWidth)
    return () => observer.disconnect()
  }, [])
  // 缩放：省略时铺满（整条录屏轨放得下，结尾留出“接在这里”的空位）；用户缩放后按每秒像素记住。
  const [chosenScale, setChosenScale] = useState<number | null>(null)
  const endFrame = Math.max(lane.end, take ? take.frame + take.frames : 0)
  const fitScale = Math.max(0.2, (viewport - RECORDING_LANE_LEFT * 2 - RECORDING_APPEND_SLOT_WIDTH) / Math.max(30, endFrame / fps))
  const secondPixels = chosenScale ?? fitScale
  const pixels = secondPixels / fps
  const x = (frame: number): number => RECORDING_LANE_LEFT + frame * pixels
  const width = Math.max(viewport, x(endFrame) + RECORDING_APPEND_SLOT_WIDTH + RECORDING_LANE_LEFT)
  const selected = lane.blocks.find(block => block.clip.id === instance.selection) ?? null

  const shortcuts = useSettingsStore(state => state.videoEditShortcuts)
  const context = captureVideoEditCommandContext(projectId, 'timeline', { includeClipboard: false })
  const command = (id: 'play_pause' | 'go_prev_edit' | 'go_next_edit') => {
    const state = timelineCommandPresentation(context, id, shortcuts)
    return { tooltip: state.tooltip, enabled: state.enabled && !recording, run: () => { void executeVideoEditCommand(captureVideoEditCommandContext(projectId, 'timeline'), id).catch(onError) } }
  }
  const play = command('play_pause'), previous = command('go_prev_edit'), next = command('go_next_edit')
  const run = (work: () => unknown): void => { void Promise.resolve().then(work).catch(onError) }
  const splitAvailable = !recording && lane.blocks.some(({ clip }) => instance.frame > clip.start && instance.frame < clip.start + clip.duration)

  // 拖标尺或空白处移动指针；录制中不响应。
  const frameAt = (clientX: number): number => {
    const box = host.current!.getBoundingClientRect()
    return Math.max(0, Math.round((clientX - box.left + host.current!.scrollLeft - RECORDING_LANE_LEFT) / pixels))
  }
  const seekDown = (event: React.PointerEvent): void => {
    if (recording || event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    if (event.target === event.currentTarget) run(() => selectVideoEditRecordingBlock(projectId, null))
    run(() => setVideoEditView(projectId, { frame: frameAt(event.clientX), playing: false, scrubbing: true }))
  }
  const seekMove = (event: React.PointerEvent): void => { if (event.currentTarget.hasPointerCapture(event.pointerId)) run(() => setVideoEditView(projectId, { frame: frameAt(event.clientX), scrubbing: true })) }
  const seekUp = (event: React.PointerEvent): void => { if (event.currentTarget.hasPointerCapture(event.pointerId)) { event.currentTarget.releasePointerCapture(event.pointerId); run(() => setVideoEditView(projectId, { scrubbing: false })) } }

  // 拖块的一端：波纹修剪（与剪辑时间线的 B 工具同一份编辑），预览与松手共用，松手记一步撤销。
  const trimDown = (block: VideoEditRecordingBlock, edge: 'in' | 'out') => (event: React.PointerEvent): void => {
    if (recording || event.button !== 0) return
    event.stopPropagation()
    const target = event.currentTarget as HTMLElement
    target.setPointerCapture(event.pointerId)
    try {
      selectVideoEditRecordingBlock(projectId, block.clip.id)
      const handle = beginVideoEditTimelineDrag(projectId, committed.id)
      const startX = event.clientX
      let delta = 0
      const move = (moveEvent: PointerEvent): void => {
        delta = Math.round((moveEvent.clientX - startX) / pixels)
        try { setPreview(delta ? previewVideoEditTimelineTrim(handle, { mode: 'ripple', edge, delta }) : null) } catch { /* 超出素材范围的位置不预览，停在上一个有效位置 */ }
      }
      const up = (): void => {
        target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', up); target.removeEventListener('pointercancel', up)
        setPreview(null)
        if (delta) run(() => finishVideoEditRecordingTrim(handle, { mode: 'ripple', edge, delta }))
      }
      target.addEventListener('pointermove', move); target.addEventListener('pointerup', up); target.addEventListener('pointercancel', up)
    } catch (error) { onError(error) }
  }

  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  const commitRename = (): void => {
    if (!renaming) return
    const { id, name } = renaming
    setRenaming(null)
    run(() => renameVideoEditRecordingBlock(projectId, id, name))
  }

  const total = Math.max(lane.end, take ? take.frame + take.frames : 0)
  const status = `${lane.blocks.length + (take && !take.saving ? 1 : 0)} 段 · 总长 ${recordingTimeLabel(total / fps * 1000)}${selected ? ' · 已选 1' : ''}`
  const zoomTo = (value: number): void => setChosenScale(Math.min(400, Math.max(0.2, value)))
  const ticks = recordingRulerTicks(secondPixels, width - RECORDING_LANE_LEFT)

  const renderBlock = (block: VideoEditRecordingBlock): React.ReactElement => {
    const { clip } = block
    const left = x(clip.start), blockWidth = clip.duration * pixels
    const isSelected = clip.id === selected?.clip.id
    const media = videoEditClipMedia(instance.document, clip)
    const label = videoEditClipLabel(instance.document, clip)
    const contentHeight = RECORDING_LANE_HEIGHT - RECORDING_LANE_INSET * 2 - RECORDING_CLIP_TITLE_HEIGHT
    // 波形取麦克风（没有就取第一段声音），按它在块里的实际起止放。
    const sound = block.linked.find(value => value.kind === 'audio' && sequence.tracks.find(track => track.index === value.track)?.name === '麦克风') ?? block.linked.find(value => value.kind === 'audio')
    const soundMedia = sound ? videoEditClipMedia(instance.document, sound) : undefined
    const soundRange = sound && soundMedia ? (() => {
      const head = videoEditClipSourceSecondsAtTime(sound, sound.start / fps, fps), tail = videoEditClipSourceSecondsAtTime(sound, (sound.start + sound.duration) / fps, fps)
      return { startSeconds: Math.max(0, Math.min(head, tail)), endSeconds: Math.min(soundMedia.durationSeconds, Math.max(head, tail)), left: (sound.start - clip.start) * pixels, width: sound.duration * pixels, source: { source: soundMedia.path, ...(soundMedia.sourceRevision ? { sourceRevision: soundMedia.sourceRevision } : {}), channels: 2 as const } }
    })() : undefined
    return <div key={clip.id} data-recording-block={clip.id} data-selected={isSelected || undefined} className="group absolute" style={{ left, width: blockWidth, top: RECORDING_LANE_INSET, bottom: RECORDING_LANE_INSET }}
      onPointerDown={event => { if (recording || event.button !== 0) return; event.stopPropagation(); run(() => selectVideoEditRecordingBlock(projectId, clip.id)) }}
      onDoubleClick={() => { if (!recording) setRenaming({ id: clip.id, name: clip.name }) }}>
      <div className="absolute inset-y-0 left-0 right-px overflow-hidden rounded-check" style={videoEditClipLabelSurface(label, isSelected)}>
        <div className="absolute inset-x-0 bottom-0" style={{ top: RECORDING_CLIP_TITLE_HEIGHT }}>
          {media?.kind === 'video' && <VideoEditClipFilmstrip clipId={clip.id} source={media.path} sourceRevision={media.sourceRevision} still={false} aspect={media.width > 0 && media.height > 0 ? media.width / media.height : 16 / 9}
            mediaEndSeconds={media.durationSeconds} frameSeconds={media.frameRate ? media.frameRate.denominator / media.frameRate.numerator : 1 / 30} clip={clip} fps={fps} pixels={pixels} clipWidth={blockWidth} height={contentHeight}
            visibleFrom={0} visibleTo={blockWidth} devicePixelRatio={window.devicePixelRatio || 1} active />}
          {soundRange && <VideoEditClipWaveform projectId={projectId} clipId={sound!.id} gainDb={sound!.gainDb} sources={[soundRange.source]} startSeconds={soundRange.startSeconds} endSeconds={soundRange.endSeconds} left={soundRange.left} width={soundRange.width} visible lane="lower" compact={blockWidth <= 110} />}
        </div>
        <div className="absolute inset-x-0 top-0 flex items-center gap-2 px-1.5" style={{ height: RECORDING_CLIP_TITLE_HEIGHT, ...videoEditClipTitleSurface(label, isSelected) }}>
          <span data-user-content className="min-w-0 truncate text-2xs font-medium leading-4 text-text1">{clip.name}</span>
          {blockWidth > 72 && <span className={`ml-auto shrink-0 text-2xs leading-4 text-text2 ${UI_TEXT_NUMERIC_CLASS}`}>{shortTime(clip.duration, fps)}</span>}
        </div>
      </div>
      {isSelected && <div className={TIMELINE_SELECTED_RING_CLASS} aria-hidden="true" />}
      {/* 两端的修剪柄：命中区，不画东西；光标说明能拖 */}
      <div aria-hidden="true" className="absolute inset-y-0 left-0 z-raised w-1.5 cursor-ew-resize" onPointerDown={trimDown(block, 'in')} />
      <div aria-hidden="true" className="absolute inset-y-0 right-0 z-raised w-1.5 cursor-ew-resize" onPointerDown={trimDown(block, 'out')} />
      {renaming?.id === clip.id && <div className="absolute inset-x-0 top-0 z-raised" onPointerDown={event => event.stopPropagation()}>
        <UiInput aria-label="这一段的名称" size="sm" autoFocus value={renaming.name} onChange={event => setRenaming({ id: clip.id, name: event.target.value })}
          onKeyDown={event => { if (event.key === 'Enter') commitRename(); else if (event.key === 'Escape') setRenaming(null) }} onBlur={commitRename} />
      </div>}
    </div>
  }

  return <div className="flex shrink-0 flex-col bg-panel" aria-label="录屏轨" data-recording-lane>
    <div className="relative flex h-band-command shrink-0 items-center gap-0.5 border-b border-line pl-3 pr-2" role="toolbar" aria-label="播放控制">
      <span className="flex min-w-0 items-baseline gap-1.5">
        <VideoEditTimecode instance={instance} label="当前时间码" primary className="text-15" />
        <span className={`text-xs text-text3 ${UI_TEXT_NUMERIC_CLASS}`}>/ {recordingTimeLabel(total / fps * 1000)}</span>
      </span>
      <div className="absolute left-1/2 flex -translate-x-1/2 items-center gap-0.5">
        <UiIconButton aria-label="上一段" tooltip={previous.tooltip} disabled={!previous.enabled} disabledReason={recording ? '录制中不能跳转' : previous.tooltip} onClick={previous.run}><SkipBack /></UiIconButton>
        <UiIconButton aria-label={instance.playing ? '暂停' : '播放'} tooltip={play.tooltip} disabled={!play.enabled} disabledReason={recording ? '录制中不能播放' : play.tooltip} onClick={play.run}>{instance.playing ? <Pause /> : <Play />}</UiIconButton>
        <UiIconButton aria-label="下一段" tooltip={next.tooltip} disabled={!next.enabled} disabledReason={recording ? '录制中不能跳转' : next.tooltip} onClick={next.run}><SkipForward /></UiIconButton>
      </div>
      <span className="flex-1" />
      <UiIconButton aria-label="在指针处切开" tooltip="在指针处切开" disabled={!splitAvailable} disabledReason={recording ? '录制中不能切开' : '把指针放在某一段中间'} onClick={() => run(() => splitVideoEditRecordingAtPlayhead(projectId))}><Scissors /></UiIconButton>
      <UiIconButton tone="danger" aria-label="删除这一段" tooltip="删除这一段，后面的接上来" disabled={recording || !selected} disabledReason={recording ? '录制中不能删除' : '先选中一段'} onClick={() => { if (selected) run(() => deleteVideoEditRecordingBlock(projectId, selected.clip.id)) }}><Trash2 /></UiIconButton>
    </div>
    <div ref={host} className="relative overflow-x-auto overflow-y-hidden" data-layout-scroll-region onPointerDown={seekDown} onPointerMove={seekMove} onPointerUp={seekUp} onPointerCancel={seekUp}>
      <div className="relative" style={{ width }}>
        <div className="relative h-7 border-b border-line" aria-hidden="true" data-recording-ruler>
          {ticks.map(tick => <span key={tick.seconds} className={`absolute bottom-0 w-px ${tick.major ? 'h-2.5 bg-line-strong' : 'h-1 bg-line'}`} style={{ left: RECORDING_LANE_LEFT + tick.seconds * secondPixels }} />)}
          {ticks.filter(tick => tick.major).map(tick => <span key={`label-${tick.seconds}`} className={`absolute bottom-0.5 text-2xs leading-4 text-text3 ${UI_TEXT_NUMERIC_CLASS}`} style={{ left: RECORDING_LANE_LEFT + tick.seconds * secondPixels + 4 }}>{recordingTimeLabel(tick.seconds * 1000).replace(/^00:/, '')}</span>)}
          {!recording && <div className="absolute inset-y-0 z-raised" style={{ left: RECORDING_LANE_LEFT }}><VideoEditTimelinePlayheadHead instance={instance} pixels={pixels} /></div>}
        </div>
        <div className="relative bg-gap" style={{ height: RECORDING_LANE_HEIGHT }} data-recording-track>
          {lane.blocks.map(renderBlock)}
          {!recording && instance.frame >= lane.end && <div className="pointer-events-none absolute flex items-center gap-1.5 rounded-check border border-dashed border-line-strong px-3 text-xs text-icon-rest" style={{ left: x(lane.end) + 2, width: RECORDING_APPEND_SLOT_WIDTH, top: RECORDING_LANE_INSET, bottom: RECORDING_LANE_INSET }} data-recording-append-slot><Plus className="h-3.5 w-3.5" aria-hidden="true" />接在这里</div>}
          {coverHint && !recording && instance.frame < lane.end && <div className="ui-hatch-cover pointer-events-none absolute z-raised" style={{ left: x(instance.frame), width: Math.min(RECORDING_COVER_HINT_WIDTH, x(lane.end) - x(instance.frame) + RECORDING_COVER_HINT_WIDTH / 2), top: RECORDING_LANE_INSET, bottom: RECORDING_LANE_INSET }} data-recording-cover-hint />}
          {take && <div className="absolute z-raised overflow-hidden rounded-check bg-clip-recording" style={{ left: x(take.frame), width: Math.max(2, take.frames * pixels), top: RECORDING_LANE_INSET, bottom: RECORDING_LANE_INSET }} data-recording-take>
            <div className="flex items-center gap-2 bg-clip-recording-title px-1.5" style={{ height: RECORDING_CLIP_TITLE_HEIGHT }}>
              <span className="min-w-0 truncate text-2xs font-medium leading-4 text-text1">{take.saving ? '正在放进序列' : '正在录制'}</span>
              {take.frames * pixels > 72 && <span className={`ml-auto shrink-0 text-2xs leading-4 text-text2 ${UI_TEXT_NUMERIC_CLASS}`}>{shortTime(take.frames, fps)}</span>}
            </div>
            <span className="absolute inset-y-0 right-0 w-0.5 bg-danger-solid" aria-hidden="true" />
          </div>}
        </div>
        {/* 录制中不画指针：正在录的那一块右缘的红线就是现在的位置 */}
        {!recording && <LanePlayhead instance={instance} left={x} />}
      </div>
    </div>
    <UiToolbar variant="footer" aria-label="录屏轨缩放" tools={[
      { kind: 'action', id: 'zoom_out', label: '缩小', icon: Minus, onSelect: () => zoomTo(secondPixels / 1.5) },
      { kind: 'custom', id: 'zoom', label: '缩放', priority: -1, node: <div className="flex w-24 items-center"><UiRangeInput aria-label="录屏轨缩放" min={0.2} max={400} step={0.1} value={secondPixels} onChange={event => zoomTo(Number(event.target.value))} /></div> },
      { kind: 'action', id: 'zoom_in', label: '放大', icon: Plus, onSelect: () => zoomTo(secondPixels * 1.5) },
      { kind: 'action', id: 'zoom_fit', label: '整条放进视野', icon: Scan, onSelect: () => setChosenScale(null) },
    ]}><span className={UI_TEXT_NUMERIC_CLASS}>{status}</span></UiToolbar>
  </div>
}

/** 指针竖线：自己订阅帧，播放时只有它跟着走。录制中停在正在录的那一块的右缘。 */
function LanePlayhead({ instance, left }: { instance: VideoEditInstance; left: (frame: number) => number }): React.ReactElement {
  const frame = useVideoEditViewSelector(() => instance.frame)
  return <div className="pointer-events-none absolute bottom-0 top-7 z-raised w-px bg-accent-ring" style={{ left: left(frame) }} aria-hidden="true" data-recording-playhead />
}
