import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Dropdown, PanelTrigger, UiButton, UiError, UiIconButton, UiInput, UiOptionButton, UiPanel } from '@/components/ui'
import { ImagePlus, MapPin, MoreHorizontal, MousePointer2, Move, PenLine, RotateCcw, SquareDashed } from 'lucide-react'
import { Z_LAYERS } from '@/core/theme/zLayers'
import { audibleVideoEditClips, videoEditDuration } from '@/core/videoEdit/document'
import { VideoEditRenderSession } from './engine/videoEditRenderSession'
import { acceptsVideoEditDrop, dropVideoEditInput, readVideoEditDrop } from './application/videoEditDrop'
import { activeVideoEditInstance, editVideoSequence, getActiveVideoEditSequence, requireVideoEditInstance, listVideoEditInstances, setVideoEditView, subscribeVideoEditDomain, subscribeVideoEditView, videoEditViewRevision, videoEditProgramCommandIdentity, type VideoEditInstance } from './application/videoEditService'
import { yieldVideoEditSource } from './application/videoEditSource'
import { createVideoEditAudioMeter, type VideoEditAudioLevel } from './engine/videoEditAudioMeter'
import { VideoEditAudioScheduler } from './engine/videoEditAudioScheduler'
import { VideoEditLevelMeter } from './panels/VideoEditLevelMeter'
import { useVideoEditPictureGesture } from './panels/useVideoEditPictureGesture'
import { VideoEditTimecode, VideoEditTransportControls } from './timeline/VideoEditTimelineTransport'
import { captureVideoEditProgramFrame, registerVideoEditProgramCapture } from './application/videoEditProgramCapture'
import { collectVideoEditOutput } from './application/videoEditOutputs'
import { editVideoEditProgramFrame } from './application/videoEditFrameEdit'
import { useAssetLibraryStore } from '@/features/assets/store/assetLibraryStore'
import { openAssetLibrary } from '@/stores/navigationStore'
import { createLogger } from '@/core/logging'
import type { VideoEditComposition } from '@/core/videoEdit/document'

const logger = createLogger('features.videoEdit.preview')
/** 节目监视器的工具模式：选中态开关（不是动作按钮），名称与标注逻辑不变。 */
const PROGRAM_MODES = [{ id: 'select', title: '选择', Icon: MousePointer2 }, { id: 'move', title: '移动画面', Icon: Move }, { id: 'point', title: '点标注', Icon: MapPin }, { id: 'region', title: '区域标注', Icon: SquareDashed }] as const

/** The Program GPU surface belongs to the project: a remount (dock ↔ popout window) waits until the previous session actually retired. */
const programReleases = new WeakMap<VideoEditInstance, Promise<unknown>>()
export function VideoEditPreview({ instance, onError, visible = true }: { instance: VideoEditInstance; onError: (error: unknown) => void; visible?: boolean }): React.ReactElement {
  useSyncExternalStore(subscribeVideoEditView, videoEditViewRevision)
  const host = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const [mode, setMode] = useState<'select' | 'move' | 'point' | 'region'>('select')
  const [display, setDisplay] = useState<'fit' | 'actual'>('fit')
  const [levels, setLevels] = useState<VideoEditAudioLevel[]>([])
  const picture = useVideoEditPictureGesture(instance, visible && mode === 'move', onError)
  const [label, setLabel] = useState('')
  const pointer = useRef<{ x: number; y: number; document: VideoEditInstance['document']; sequenceId: string; clipId: string; frame: number; command: object; selection: string[] } | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [retry, setRetry] = useState(0)
  const [renderFailure, setRenderFailure] = useState<string | null>(null)
  const [collecting, setCollecting] = useState(false)
  const libraryId = useAssetLibraryStore(state => state.libraryId)
  const session = useRef<VideoEditRenderSession | null>(null)
  const stopPreview = useRef<() => void>(() => {})
  const document = getActiveVideoEditSequence(instance)
  useEffect(() => {
    if (!visible) { setVideoEditView(instance.document.id, { playing: false }, true); setPreparing(false); setLevels([]); return }
    const previousRelease = programReleases.get(instance) ?? Promise.resolve()
    setRenderFailure(null)
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
    const renderer = new VideoEditRenderSession(initialDocument, initialDocument.width, active => { if (!stopped) setPreparing(active) }, surface.transferControlToOffscreen()); session.current = renderer
    const unsubscribe = subscribeVideoEditDomain(() => {
      if (stopped) return
      if (getActiveVideoEditSequence(instance) !== appliedDocument) { stopAudio(); setLevels([]) }
      renderer.invalidateDocument(instance.document.revision)
    })
    const unsubscribeView = subscribeVideoEditView(() => {
      if (stopped) return
      if (!instance.playing || instance.playbackDirection !== direction || activeCommand && videoEditProgramCommandIdentity(instance.document.id) !== activeCommand) { stopAudio(); setLevels([]) }
    })
    let audioRenderer: VideoEditRenderSession | undefined
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
    const audioScheduler = new VideoEditAudioScheduler()
    const stopAudio = (): void => audioScheduler.stop()
    const meterTimer = setInterval(() => { if (!stopped && meter) setLevels(instance.playing && instance.playbackDirection === 1 ? meter.read() : Array.from({ length: appliedDocument.channels }, () => ({ peak: 0, rms: 0 }))) }, 50)
    let lastPresentation = -Infinity
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
      surface.dataset.presentedRevision = String(revision)
      if (failedDocument === undefined) { setRenderFailure(null); failedRetryMs = 2000 }
      return true
    }
    const unregisterCapture = registerVideoEditProgramCapture(instance, initialDocument.id, async (request, signal) => {
      const current = (): void => {
        signal?.throwIfAborted(); request.assertCurrent()
        if (stopped || session.current !== renderer || canvas.current !== surface || !surface.isConnected) throw new Error('节目面板已关闭，请重新打开后选帧。')
      }
      const start = performance.now()
      while (appliedDocument !== request.document || lastFrame !== request.frame || surface.dataset.presentedRevision !== String(request.document.revision) || surface.dataset.scrubbing === 'true') {
        current()
        if (performance.now() - start > 10000) throw new Error('节目画面尚未就绪，请等待画面更新后重试选帧。')
        await new Promise(resolve => setTimeout(resolve, 5))
      }
      current()
      if (surface.width !== request.document.width || surface.height !== request.document.height) throw new Error('节目画幅尚未就绪，请重新加载预览。')
      const blob = await new Promise<Blob>((resolve, reject) => surface.toBlob(value => value ? resolve(value) : reject(new Error('节目图片保存失败，请重试。')), 'image/png'))
      current()
      return blob
    })
    const loop = async (): Promise<void> => {
      let scheduled = false
      let requestCommand: object | undefined
      let requestDocument = appliedDocument
      try {
        const current = requireVideoEditInstance(instance.document.id)
        const command = videoEditProgramCommandIdentity(instance.document.id)
        const document = getActiveVideoEditSequence(current)
        requestCommand = command; requestDocument = document
        if (failedDocument) {
          if (failedDocument === document && failedFrame === current.frame && Date.now() < failedRetryAt) { timer = setTimeout(() => { void loop() }, 250); return }
          failedDocument = undefined
        }
        if (appliedDocument !== document) {
          stopAudio(); wasPlaying = false
          if (appliedDocument.sampleRate !== document.sampleRate || appliedDocument.channels !== document.channels) { meter?.dispose(); meter = undefined; await audio?.close(); audio = undefined; if (!stopped) setLevels([]) }
          await renderer.updateDocument(document); await audioRenderer?.updateDocument(document); appliedDocument = document; lastFrame = -1; lastRequested = -1
          if (stopped) return
        }
        if (current.playing && (!wasPlaying || direction !== current.playbackDirection || activeCommand !== command)) {
          stopAudio(); direction = current.playbackDirection
          await yieldVideoEditSource(instance.document.id)
          if (stopped || !current.playing || videoEditProgramCommandIdentity(instance.document.id) !== command) { if (!stopped) timer = setTimeout(() => { void loop() }, 0); return }
          const initialFrame = current.frame
          const requestedAt = performance.now()
          const initialResult = await renderer.present(initialFrame, direction === 1)
          if (stopped) return
          if (initialResult.presented === true) recordPresentation(initialFrame, initialResult, requestedAt, false, document.revision)
          if (!current.playing || !listVideoEditInstances().includes(instance) || getActiveVideoEditSequence(instance) !== document || videoEditProgramCommandIdentity(instance.document.id) !== command) { wasPlaying = false; timer = setTimeout(() => { void loop() }, 0); return }
          if (initialResult.presented === false) { lastFrame = -1; lastRequested = -1; wasPlaying = false; timer = setTimeout(() => { void loop() }, 0); return }
          if (initialResult.presented !== true) recordPresentation(initialFrame, initialResult, requestedAt, false, document.revision)
          lastFrame = initialFrame; lastScrubbing = false
          lastRequested = initialFrame; activeCommand = command
          if (direction === 1 && audibleVideoEditClips(document).length) {
            audio ??= new AudioContext({ sampleRate: document.sampleRate }); await audio.resume()
            if (stopped) return
            if (!current.playing || !listVideoEditInstances().includes(instance) || getActiveVideoEditSequence(instance) !== document || videoEditProgramCommandIdentity(instance.document.id) !== command) { wasPlaying = false; timer = setTimeout(() => { void loop() }, 0); return }
            meter ??= createVideoEditAudioMeter(audio, document.channels)
            const before = audio.currentTime; const waiting = performance.now()
            while (audio.currentTime === before && performance.now() - waiting < 1000 && !stopped) await new Promise(resolve => setTimeout(resolve, 2))
          }
          if (stopped) return
          clockStart = (audio?.currentTime ?? 0) + 0.1; startFrame = initialFrame; audioScheduler.start(initialFrame / document.fps)
          if (!current.playing || getActiveVideoEditSequence(instance) !== document || videoEditProgramCommandIdentity(instance.document.id) !== command) { wasPlaying = false; timer = setTimeout(() => { void loop() }, 0); return }
          clockPerformanceStart = performance.now() + 100
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
              mix: (from, duration) => (audioRenderer ??= new VideoEditRenderSession(document)).mixAudio(from, duration),
              isCurrent: () => !stopped && listVideoEditInstances().includes(instance) && getActiveVideoEditSequence(instance) === document && videoEditProgramCommandIdentity(instance.document.id) === command,
              onError: error => { setVideoEditView(instance.document.id, { playing: false }, true); onError(error) },
            })
          }
        }
        const playing = current.playing
        const target = playing ? direction === 1 ? Math.max(startFrame, Math.min(videoEditDuration(document) - 1, lastFrame + 1)) : Math.min(startFrame, Math.max(0, lastFrame - 1)) : current.frame
        if (target !== lastRequested || (!!current.scrubbing !== lastScrubbing && !current.scrubbing)) {
          const scrubbing = !!current.scrubbing
          const requestedAt = performance.now()
          const deadline = playing ? performance.timeOrigin + clockPerformanceStart + Math.abs(target - startFrame) / document.fps * 1000 : undefined
          lastRequested = target
          const result = await renderer.present(target, playing && direction === 1, scrubbing, deadline, scrubbing ? () => {
            if (!stopped) { scheduled = true; timer = setTimeout(() => { void loop() }, 0) }
          } : undefined)
          {
            // A completed seek is useful while the pointer keeps moving. Only a different
            // document/lifetime invalidates it; the next iteration reads the latest target.
            if (stopped || !listVideoEditInstances().includes(instance)) return
            if (getActiveVideoEditSequence(current) !== document) {
              // An already submitted draw cannot be undone by a later parameter edit.
              // Report that same-surface fact without advancing the new document's clock.
              if (result.presented === true) recordPresentation(target, result, requestedAt, scrubbing, document.revision)
              if (!scheduled) timer = setTimeout(() => { void loop() }, 0)
              return
            }
            if (result.presented === false) { lastFrame = -1; lastRequested = -1; if (!scheduled) timer = setTimeout(() => { void loop() }, 0); return }
            if (!recordPresentation(target, result, requestedAt, scrubbing, document.revision)) { if (!scheduled) timer = setTimeout(() => { void loop() }, 0); return }
            lastFrame = target; lastScrubbing = scrubbing
            if (playing && current.playing && current.playbackDirection === direction && videoEditProgramCommandIdentity(instance.document.id) === command) setVideoEditView(instance.document.id, { frame: target }, true)
          }
        }
        if (!stopped && !scheduled) timer = setTimeout(() => { void loop() }, current.playing ? 0 : 2)
      } catch (error) {
        if (stopped || !listVideoEditInstances().includes(instance)) return
        if (getActiveVideoEditSequence(instance) !== requestDocument || videoEditProgramCommandIdentity(instance.document.id) !== requestCommand) { timer = setTimeout(() => { void loop() }, 0); return }
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
      retired = true; unregisterCapture(); unsubscribe(); unsubscribeView(); clearTimeout(timer); clearInterval(meterTimer); instance.playing = false; stopAudio(); meter?.dispose()
      programReleases.set(instance, Promise.allSettled([audio?.close(), renderer.dispose(), audioRenderer?.dispose()]))
      surface.remove(); if (canvas.current === surface) canvas.current = null
    }
    void loop()
    }
    void initialize().catch(error => { if (!stopped) onError(error) })
    return stop
  }, [instance, instance.activeSequenceId, onError, retry, visible])
  const busy = collecting || preparing
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
  // 节目监视器（界面重设计 3.5，设计稿 VideoEdit）：画面区（媒体底 + 右侧纵向电平）+ 唯一一条控制带：
  // 时间码 ｜ 播放控制 ｜ 适应、工具模式（选中态）、更多（重新加载、选帧加入资产库、编辑当前帧）。
  // 压在画面上的状态与标注输入用玻璃 / 媒体叠层令牌。
  return <div className="flex min-h-0 flex-1 flex-col bg-panel">
    <div className={`relative flex min-h-0 flex-1 bg-media py-3 pl-3 pr-6 ${display === 'fit' ? 'items-center justify-center overflow-hidden' : 'items-start justify-start overflow-auto'}`}
      onDragOver={event => { if (acceptsVideoEditDrop(event.dataTransfer)) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' } }}
      onDrop={event => {
        if (!acceptsVideoEditDrop(event.dataTransfer)) return
        event.preventDefault(); event.stopPropagation()
        try { void dropVideoEditInput(instance.document.id, readVideoEditDrop(event.dataTransfer), { frame: instance.frame }).catch(onError) } catch (error) { onError(error) }
      }}>
      <div className={`relative ${display === 'fit' ? 'max-h-full max-w-full' : 'shrink-0'}`} style={display === 'fit' ? { aspectRatio: `${document.width}/${document.height}`, height: '100%' } : { width: document.width, height: document.height }} data-video-edit-program-display={display}>
        <div ref={host} className="h-full w-full"
          onPointerDown={event => { if (mode === 'move') { picture.down(event); return } if (mode === 'select' || !instance.selection) return; const rect = event.currentTarget.getBoundingClientRect(); pointer.current = { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height, document: instance.document, sequenceId: instance.activeSequenceId, clipId: instance.selection, frame: instance.frame, command: videoEditProgramCommandIdentity(instance.document.id), selection: instance.selectedClipIds }; event.currentTarget.setPointerCapture(event.pointerId) }}
          onPointerMove={picture.move}
          onPointerCancel={() => { pointer.current = null; picture.cancel() }} onLostPointerCapture={() => { pointer.current = null; picture.cancel() }}
          onPointerUp={event => {
            if (mode === 'move') { picture.up(event); return }
            const start = pointer.current; pointer.current = null
            if (!start || instance.document !== start.document || instance.activeSequenceId !== start.sequenceId || instance.selection !== start.clipId || instance.selectedClipIds !== start.selection || instance.frame !== start.frame || videoEditProgramCommandIdentity(instance.document.id) !== start.command) return
            const rect = event.currentTarget.getBoundingClientRect(); const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)); const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))
            try { editVideoSequence(instance.document.id, start.sequenceId, draft => ({ ...draft, annotations: [...draft.annotations, { id: crypto.randomUUID(), clipId: start.clipId, frame: start.frame, space: 'composition-normalized', kind: mode === 'region' ? 'region' : 'point', x: Math.min(start.x, x), y: Math.min(start.y, y), width: mode === 'region' ? Math.abs(x - start.x) : 0, height: mode === 'region' ? Math.abs(y - start.y) : 0, text: label }] })) } catch (error) { onError(error) }
          }} />
        {document.annotations.filter(mark => mark.frame === instance.frame).map(mark => <div key={mark.id} className="pointer-events-none absolute border border-on-media text-xs text-on-media" style={{ left: `${mark.x * 100}%`, top: `${mark.y * 100}%`, width: mark.kind === 'point' ? 8 : `${mark.width * 100}%`, height: mark.kind === 'point' ? 8 : `${mark.height * 100}%` }}><span className="absolute bottom-full whitespace-nowrap bg-media-scrim px-1">{mark.text}</span></div>)}
      </div>
      <VideoEditLevelMeter className="absolute bottom-3 right-2 top-3" levels={levels.length ? levels : Array.from({ length: document.channels }, () => ({ peak: 0, rms: 0 }))} title="节目播放电平" />
      {(mode === 'point' || mode === 'region' || preparing || collecting) && <div className="absolute left-2 top-2 flex max-w-full items-center gap-2 rounded-lg bg-media-scrim p-1 text-xs text-on-media">
        {(mode === 'point' || mode === 'region') && <div className="w-44 shrink-0"><UiInput aria-label="标注文字" size="sm" value={label} onChange={event => setLabel(event.target.value)} placeholder="标注文字" /></div>}
        {preparing && <><span className="whitespace-nowrap px-1">正在准备流畅预览…</span><UiButton variant="media" size="sm" onClick={() => { stopPreview.current(); setPreparing(false) }}>取消准备</UiButton></>}
        {collecting && !preparing && <span className="whitespace-nowrap px-1">正在处理当前帧…</span>}
      </div>}
      {(renderFailure || (mode !== 'select' && !instance.selection)) && <div className="pointer-events-none absolute inset-x-6 bottom-3 flex justify-center">
        <UiPanel className="pointer-events-auto max-w-md px-3 py-2">
          {renderFailure ? <UiError title="节目画面无法显示" message={renderFailure} /> : <UiError message="请先选择要编辑的片段" />}
        </UiPanel>
      </div>}
    </div>
    <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-x-1 gap-y-0.5 whitespace-nowrap border-t border-line px-2 py-1" role="toolbar" aria-label="节目监视器控制">
      <VideoEditTimecode instance={instance} label="节目时间码" className="w-28 px-1.5 text-13 text-text1" />
      <div className="flex min-w-fit flex-1 justify-center"><VideoEditTransportControls instance={instance} onError={onError} /></div>
      <div className="ml-auto flex shrink-0 items-center gap-1">
      <Dropdown<'fit' | 'actual'> ariaLabel="节目显示比例" appearance="text" size="sm" value={display} options={[{ value: 'fit', label: '适应' }, { value: 'actual', label: '100%' }]} onSelect={setDisplay} />
      <div className="flex items-center gap-0.5" role="group" aria-label="节目工具">
        {PROGRAM_MODES.map(({ id, title, Icon }) => <UiIconButton key={id} on={mode === id} aria-label={title} title={title} onClick={() => setMode(id)}><Icon size={15} /></UiIconButton>)}
      </div>
      <PanelTrigger panelWidth={188} zIndex={Z_LAYERS.dropdown} closeOnPanelClick panelPadding="menu" renderPanel={() => <div className="flex flex-col gap-1">
        <UiOptionButton variant="menu" size="sm" className="gap-2" disabled={preparing} onClick={() => setRetry(value => value + 1)}><RotateCcw size={14} />重新加载预览</UiOptionButton>
        <UiOptionButton variant="menu" size="sm" className="gap-2" disabled={busy} onClick={captureFrame}><ImagePlus size={14} />选帧加入资产库</UiOptionButton>
        <UiOptionButton variant="menu" size="sm" className="gap-2" disabled={busy} title="在图片编辑中修改当前帧，完成后可回填到此帧上方的空画面轨道" onClick={editFrame}><PenLine size={14} />编辑当前帧</UiOptionButton>
      </div>}>
        {({ open, togglePanel }) => <UiIconButton aria-label="更多节目操作" title="更多：重新加载预览、选帧加入资产库、编辑当前帧" aria-expanded={open} data-panel-trigger-button onClick={togglePanel}><MoreHorizontal size={16} /></UiIconButton>}
      </PanelTrigger>
      </div>
    </div>
  </div>
}
