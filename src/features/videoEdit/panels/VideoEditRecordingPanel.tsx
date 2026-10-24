import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { Dropdown, UiButton, UiDisclosurePanel, UiFormRow, UiIconButton, UiPropertyUnit, UiSegmented, UiSwitch } from '@/components/ui'
import { UI_PROPERTY_INSET_CLASS } from '@/components/ui/styleTokens'
import NumberInput from '@/components/ui/NumberInput'
import type { VideoEditClip, VideoEditSequence } from '@/core/videoEdit/document'
import { videoEditClipMedia } from '@/core/videoEdit/document'
import { requireVideoEditBuiltinEffect, resolveVideoEditBuiltinParams } from '@/core/videoEdit/builtinEffects'
import type { VideoEditBuiltinEffect } from '@/core/videoEdit/compositing'
import { RECORDING_CURSOR_EFFECT } from '@/core/videoEdit/recordingCursor'
import { RECORDING_ZOOM_EFFECT, recordingZoomRegionFrames, recordingZoomSourceUsAtFrame, type RecordingZoomRegion } from '@/core/videoEdit/recordingZoom'
import { RECORDING_FRAME_EFFECT } from '@/core/videoEdit/recordingFrame'
import { updateVideoEditBuiltinEffect, type VideoEditCompositeTarget } from '../application/videoEditCompositing'
import { RECORDING_ZOOM_DEPTH_LABELS, recordingClipEffect, recordingClipSource, regenerateRecordingClipZoom, setRecordingClipEffect, setRecordingZoomRegions, type RecordingClipEffect } from '../application/videoEditRecordingClip'
import type { VideoEditInstance } from '../application/videoEditService'
import { useVideoEditBuiltinParamGesture } from './useVideoEditBuiltinParamGesture'
import { VideoEditBuiltinParamRows } from './VideoEditBuiltinEffectControls'
import { VideoEditEffectSection } from './VideoEditEffectSection'

const ADD_ZOOM_US = 3_000_000

/** The params of one recording effect: the common ones always, the rest behind "更多". */
function EffectRows({ target, effect, keys, more, onError }: { target: VideoEditCompositeTarget; effect: VideoEditBuiltinEffect; keys: readonly string[]; more?: readonly string[]; onError: (reason: unknown) => void }): React.ReactElement {
  const gesture = useVideoEditBuiltinParamGesture(target.projectId, JSON.stringify([target.sequenceId, target.clipId, effect.id]), (changes, handle) => updateVideoEditBuiltinEffect(target, effect.id, changes, handle), onError)
  const [open, setOpen] = useState(false)
  const definition = requireVideoEditBuiltinEffect(effect.builtin.id)
  const values = resolveVideoEditBuiltinParams(effect.builtin)
  const pick = (list: readonly string[]) => list.flatMap(key => definition.params.filter(param => param.key === key))
  // A solid background needs its colour; the gradients do not.
  const shown = keys.filter(key => key !== 'color' || values.background === 'solid')
  return <>
    <VideoEditBuiltinParamRows params={pick(shown)} values={values} gesture={gesture} />
    {/* One block, so a folded "更多" adds no row gap of its own. */}
    {more?.length ? <div>
      <div className={UI_PROPERTY_INSET_CLASS}><UiButton size="sm" aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? <ChevronDown /> : <ChevronRight />}更多</UiButton></div>
      <UiDisclosurePanel open={open}><VideoEditBuiltinParamRows params={pick(more)} values={values} gesture={gesture} /></UiDisclosurePanel>
    </div> : null}
  </>
}

/** The zoom stretch under the playhead: how close it gets and what it looks at; or a way to add one there. */
function ZoomAtPlayhead({ instance, sequence, clip, target, regions, onError }: { instance: VideoEditInstance; sequence: VideoEditSequence; clip: VideoEditClip; target: VideoEditCompositeTarget; regions: readonly RecordingZoomRegion[]; onError: (reason: unknown) => void }): React.ReactElement | null {
  const frame = instance.frame
  if (frame < clip.start || frame >= clip.start + clip.duration) return null
  const current = regions.find(region => { const frames = recordingZoomRegionFrames(instance.document, sequence.id, clip, region); return frames && frame >= frames.startFrame && frame < frames.endFrame })
  const write = (next: readonly RecordingZoomRegion[]): void => { try { setRecordingZoomRegions(target, next) } catch (error) { onError(error) } }
  const change = (patch: Partial<RecordingZoomRegion>): void => write(regions.map(region => region === current ? { ...region, ...patch, origin: 'manual' } : region))
  if (!current) {
    const add = (): void => {
      const durationUs = Math.round((videoEditClipMedia(instance.document, clip)?.durationSeconds ?? 0) * 1e6)
      const startUs = Math.max(0, recordingZoomSourceUsAtFrame(instance.document, sequence.id, clip, frame))
      const next = regions.find(region => region.startUs >= startUs)
      const endUs = Math.min(startUs + ADD_ZOOM_US, next?.startUs ?? Infinity, durationUs || Infinity)
      if (endUs - startUs < 200_000) { onError(new Error('播放头离下一段缩放太近，没有空间再加一段。')); return }
      write([...regions, { id: crypto.randomUUID(), startUs, endUs, depth: 3, focus: 'cursor', origin: 'manual' }])
    }
    return <div className={`py-1 ${UI_PROPERTY_INSET_CLASS}`}><UiButton size="sm" variant="secondary" onClick={add}><Plus />在播放头处添加缩放</UiButton></div>
  }
  const fixed = current.focus !== 'cursor' ? current.focus : null
  return <div className="flex flex-col">
    <div className={`pt-1 text-xs font-semibold text-text3 ${UI_PROPERTY_INSET_CLASS}`}>播放头所在的缩放</div>
    <UiFormRow label="程度" density="compact" trailing={<UiIconButton size="sm" tone="danger" aria-label="删除这段缩放" tooltip="删除这段缩放" onClick={() => write(regions.filter(region => region !== current))}><Trash2 /></UiIconButton>}>
      <Dropdown size="sm" ariaLabel="缩放程度" value={current.depth} options={RECORDING_ZOOM_DEPTH_LABELS.map((label, index) => ({ value: index + 1, label }))} onSelect={depth => change({ depth: Number(depth) })} />
    </UiFormRow>
    <UiFormRow label="对准" density="compact" trailing={null}>
      <UiSegmented ariaLabel="缩放对准" size="sm" value={fixed ? 'fixed' : 'cursor'} onChange={value => change({ focus: value === 'cursor' ? 'cursor' : { x: 0.5, y: 0.5 } })} options={[{ value: 'cursor', label: '跟随鼠标' }, { value: 'fixed', label: '固定位置' }]} />
    </UiFormRow>
    {fixed && <UiFormRow label="位置" density="compact" trailing={null} info="缩放对准的点：左右、上下，占画面的百分比。">
      <div className="flex items-center">
        <NumberInput size="sm" align="right" ariaLabel="缩放对准左右" value={Math.round(fixed.x * 100)} min={0} max={100} step={1} onChange={x => change({ focus: { ...fixed, x: x / 100 } })} /><UiPropertyUnit hanging={false}>%</UiPropertyUnit>
        <NumberInput size="sm" align="right" ariaLabel="缩放对准上下" value={Math.round(fixed.y * 100)} min={0} max={100} step={1} onChange={y => change({ focus: { ...fixed, y: y / 100 } })} /><UiPropertyUnit>%</UiPropertyUnit>
      </div>
    </UiFormRow>}
  </div>
}

/**
 * Effect controls for a recording clip, above the generic effect chain: pointer, zoom and frame, each a switch with
 * its common settings shown and the rest folded away. These are the clip's own recording effects — the chain below
 * no longer lists them, so each setting has exactly one place.
 */
export function VideoEditRecordingPanel({ instance, sequence, clip, onError }: { instance: VideoEditInstance; sequence: VideoEditSequence; clip: VideoEditClip; onError: (reason: unknown) => void }): React.ReactElement | null {
  const source = recordingClipSource(instance.document, clip)
  const [busy, setBusy] = useState(false)
  const [spacer, setSpacer] = useState(0)
  const controller = useRef<AbortController>()
  const anchor = useRef<{ element: HTMLElement; top: number; scroller: HTMLElement } | null>(null)
  useEffect(() => () => controller.current?.abort(), [clip.id])
  useLayoutEffect(() => {
    const pinned = anchor.current
    if (!pinned) return
    const { scroller } = pinned
    const wanted = scroller.scrollTop + pinned.element.getBoundingClientRect().top - pinned.top
    const room = wanted - (scroller.scrollHeight - scroller.clientHeight)
    // Too short to scroll the switch back into place: add room below, and finish on the next render.
    if (room > 0.5) { setSpacer(value => value + Math.ceil(room)); return }
    anchor.current = null
    scroller.scrollTop = wanted
  }, [clip.effects, spacer])
  if (!source) return null
  const target = { projectId: instance.document.id, sequenceId: sequence.id, clipId: clip.id }
  // A switch stays where the pointer is: rows appearing or disappearing below it (or the panel's scroll
  // clamping when it gets shorter) must not slide the switch away from under the cursor.
  const pin = (event?: { currentTarget: Element }): void => {
    const element = event?.currentTarget as HTMLElement | undefined
    const scroller = element?.closest<HTMLElement>('[data-video-edit-panel="effects"]')
    if (element && scroller) anchor.current = { element, top: element.getBoundingClientRect().top, scroller }
  }
  const toggle = (id: RecordingClipEffect, on: boolean): void => { try { setRecordingClipEffect(target, id, on) } catch (error) { onError(error) } }
  const cursor = recordingClipEffect(clip, RECORDING_CURSOR_EFFECT) as VideoEditBuiltinEffect | undefined
  const zoom = recordingClipEffect(clip, RECORDING_ZOOM_EFFECT) as VideoEditBuiltinEffect | undefined
  const frame = recordingClipEffect(clip, RECORDING_FRAME_EFFECT) as VideoEditBuiltinEffect | undefined
  const regions = zoom?.builtin.regions ?? []
  const regenerate = async (): Promise<void> => {
    if (controller.current) return
    const current = new AbortController(); controller.current = current; setBusy(true)
    try { await regenerateRecordingClipZoom(target, current.signal) } catch (error) { if (!current.signal.aborted) onError(error) }
    finally { if (controller.current === current) { controller.current = undefined; setBusy(false) } }
  }
  return <div className="flex flex-col" data-video-edit-recording-panel={clip.id}>
    <VideoEditEffectSection id="recording-cursor" title="鼠标">
      <UiFormRow label="显示" density="compact"><UiSwitch aria-label="显示鼠标" checked={Boolean(cursor)} onClickCapture={pin} onCheckedChange={on => toggle(RECORDING_CURSOR_EFFECT, on)} /></UiFormRow>
      {cursor && (source.cursorBakedIn
        ? <EffectRows target={target} effect={cursor} keys={['click_style', 'size']} onError={onError} />
        : <EffectRows target={target} effect={cursor} keys={['style', 'size', 'click_style']} more={['smoothing', 'hide_after', 'distinguish_buttons']} onError={onError} />)}
    </VideoEditEffectSection>
    <VideoEditEffectSection id="recording-zoom" title="缩放">
      <UiFormRow label="自动缩放" density="compact" info="按录制时的点击放大到正在操作的地方，可在时间线的缩放轨上拖动调整。"><UiSwitch aria-label="自动缩放" checked={Boolean(zoom)} disabled={busy} onClickCapture={pin} onCheckedChange={on => { if (on) void regenerate(); else toggle(RECORDING_ZOOM_EFFECT, false) }} /></UiFormRow>
      {zoom && <>
        <div className={`flex items-center gap-2 py-1 ${UI_PROPERTY_INSET_CLASS}`}>
          <span className="min-w-0 flex-1 text-xs text-text2" data-video-edit-recording-zoom-count={regions.length}>{regions.length ? `${regions.length} 段缩放` : '还没有缩放段'}</span>
          <UiButton size="sm" loading={busy} tooltip="按点击重新生成自动缩放段，手动调过的保留" onClick={() => void regenerate()}><RefreshCw />重新生成</UiButton>
        </div>
        <ZoomAtPlayhead instance={instance} sequence={sequence} clip={clip} target={target} regions={regions} onError={onError} />
        <EffectRows target={target} effect={zoom} keys={['transition']} more={['connect']} onError={onError} />
      </>}
    </VideoEditEffectSection>
    <VideoEditEffectSection id="recording-frame" title="画框">
      <UiFormRow label="显示" density="compact"><UiSwitch aria-label="显示画框" checked={Boolean(frame)} onClickCapture={pin} onCheckedChange={on => toggle(RECORDING_FRAME_EFFECT, on)} /></UiFormRow>
      {frame && <EffectRows target={target} effect={frame} keys={['background', 'color', 'padding']} more={['radius', 'shadow']} onError={onError} />}
    </VideoEditEffectSection>
    {spacer > 0 && <div aria-hidden="true" style={{ height: spacer }} />}
  </div>
}
