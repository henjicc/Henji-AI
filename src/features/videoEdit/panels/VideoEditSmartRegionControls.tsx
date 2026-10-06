import { useState, useSyncExternalStore } from 'react'
import { RotateCcw, Scan } from 'lucide-react'
import { Dropdown, UiButton, UiError, UiIconButton, UiSwitch, UiTooltipText } from '@/components/ui'
import NumberInput from '@/components/ui/NumberInput'
import type { VideoEditBuiltinEffect } from '@/core/videoEdit/compositing'
import { isVideoEditSmartRegionId, SMART_REGION_EXPAND_RANGE, SMART_REGION_FEATHER_RANGE, SMART_REGIONS, VIDEO_EDIT_SMART_REGION_IDS } from '@/core/videoEdit/smartRegions'
import { createVideoEditMaskShape, isShapesMask, isSmartRegionMask, VIDEO_EDIT_TRACKER_MASK_DEFAULTS } from '@/core/videoEdit/effectMasks'
import { trackVideoEditMask } from '../application/videoEditTrackingEdits'
import { createLogger } from '@/core/logging'
import { subscribeVideoEditTracking, videoEditTrackingRevision, videoEditTrackingRequest, videoEditTrackingStatus, videoEditTrackingFailureText, runVideoEditTracking } from '../application/videoEditTracking'
import { setVideoEditMaskEditing } from '../application/videoEditMaskEditing'
import { VideoEditMaskCreateButtons, VideoEditMaskShapeControls } from './VideoEditMaskShapeControls'
import { openSettingsPanel } from '@/stores/uiStore'
import { requireVideoEditInstance } from '../application/videoEditService'
import type { VideoEditCompositeTarget } from '../application/videoEditCompositing'
import { retryVideoEditSmartRegion, subscribeVideoEditSmartRegions, videoEditSmartRegionFailureText, videoEditSmartRegionRequest, videoEditSmartRegionStatus, videoEditSmartRegionsRevision } from '../application/videoEditSmartRegions'
import type { VideoEditBuiltinParamGesture } from './useVideoEditBuiltinParamGesture'

const WHOLE = 'whole'
const SHAPES = 'shapes'
const logger = createLogger('features.videoEdit.tracking')
/** 去掉一项设置（回到区域默认值），不留 undefined 键。 */
function without<T extends object, K extends keyof T>(value: T, key: K): T { const { [key]: _removed, ...rest } = value; return rest as T }

function Row({ label, tooltip, children, reset }: { label: string; tooltip: string; children: React.ReactNode; reset?: { label: string; disabled: boolean; onReset: () => void } }): React.ReactElement {
  return <div className="flex min-h-8 items-center gap-1.5" data-video-edit-smart-region-row={label}>
    <span className="min-w-0 flex-1 truncate text-xs text-text2"><UiTooltipText tooltip={tooltip}>{label}</UiTooltipText></span>
    {children}
    {reset ? <UiIconButton size="xs" aria-label={reset.label} title={reset.label} disabled={reset.disabled} onClick={reset.onReset}><RotateCcw size={12} /></UiIconButton> : <span className="w-5 shrink-0" aria-hidden="true" />}
  </div>
}

/**
 * 效果控件里内置画面效果的“作用区域”：整个画面 / 手绘遮罩（4.10）/ 人脸 / 人物 / 背景 / 文字（4.7d），选了智能区域再给羽化、扩展、反转。
 * 智能区域在后台分析，这里显示进度；失败给出用户能处理的说明与重试（模型下载失败可直接去设置下载）。
 * 手绘遮罩任何画面片段都能用；智能区域要分析素材画面，只给视频、图片片段。
 */
export function VideoEditSmartRegionControls({ target, effect, gesture }: { target: VideoEditCompositeTarget; effect: VideoEditBuiltinEffect; gesture: VideoEditBuiltinParamGesture }): React.ReactElement | null {
  useSyncExternalStore(subscribeVideoEditSmartRegions, videoEditSmartRegionsRevision)
  useSyncExternalStore(subscribeVideoEditTracking, videoEditTrackingRevision)
  const [trackingError, setTrackingError] = useState<string | null>(null)
  const document = requireVideoEditInstance(target.projectId).document
  const sequence = document.sequences.find(entry => entry.id === target.sequenceId)
  const clip = sequence?.clips.find(entry => entry.id === target.clipId)
  if (!sequence || !clip || clip.kind === 'audio') return null
  // 只有视频、图片片段能分析画面；文字、图形、代码与调整图层上只有手绘遮罩。
  const analyzable = clip.kind === 'video' || clip.kind === 'image'
  const mask = isSmartRegionMask(effect.mask) || effect.mask?.regionId === 'tracker' ? effect.mask : undefined
  const region = mask ? mask.regionId === 'tracker' ? { defaults: VIDEO_EDIT_TRACKER_MASK_DEFAULTS } : SMART_REGIONS[mask.regionId] : undefined
  const status = isSmartRegionMask(mask) ? videoEditSmartRegionStatus(document, sequence.frameRate, clip, effect) : undefined
  const request = isSmartRegionMask(mask) ? videoEditSmartRegionRequest(document, sequence.frameRate, clip, effect) : undefined
  const tracker = mask?.regionId === 'tracker' ? clip.trackers?.find(tracker => tracker.id === mask.trackerId) : undefined
  const trackingRequest = tracker && videoEditTrackingRequest(document, sequence.frameRate, clip, tracker)
  const trackingStatus = videoEditTrackingStatus(trackingRequest?.definition)
  const scrub = (label: string, value: number, range: { min: number; max: number }, apply: (next: number) => void): React.ReactElement => <span className="flex shrink-0 items-center gap-1">
    <NumberInput ariaLabel={label} increaseLabel={`增加${label}`} decreaseLabel={`减少${label}`} size="sm" value={value} min={range.min} max={range.max} step={1} precision={0} widthClassName="w-20" align="right"
      onScrubStart={gesture.begin} onScrubEnd={cancelled => { if (cancelled) gesture.cancel(); else gesture.finish() }}
      onChange={next => { if (gesture.active() || Math.round(next) !== Math.round(value)) apply(Math.round(next)) }} />
    <span className="w-6" aria-hidden="true" />
  </span>
  const selectRegion = (value: string): void => {
    if (value.startsWith('tracker:')) { gesture.commit({ mask: { regionId: 'tracker', trackerId: value.slice(8) } }); return }
    if (value === SHAPES) {
      if (isShapesMask(effect.mask)) return
      const shape = createVideoEditMaskShape('ellipse')
      gesture.commit({ mask: { regionId: 'shapes', shapes: [shape] } })
      setVideoEditMaskEditing({ ...target, effectId: effect.id, shapeId: shape.id })
      return
    }
    gesture.commit({ mask: isVideoEditSmartRegionId(value) ? { regionId: value } : null })
  }
  return <div className="flex flex-col" data-video-edit-smart-region={effect.mask?.regionId ?? WHOLE}>
    <Row label="作用区域" tooltip={analyzable ? '效果只作用在一部分画面里：手绘遮罩在节目画面上画；人脸逐帧跟随，人物与背景按抠像，文字找字幕与标牌（第一次使用会在后台分析素材）。' : '效果只作用在手绘遮罩里：在节目画面上画矩形、椭圆或钢笔路径。'}>
      <span className="w-32 shrink-0"><Dropdown ariaLabel="作用区域" value={effect.mask?.regionId === 'tracker' ? `tracker:${effect.mask.trackerId}` : effect.mask?.regionId ?? WHOLE} buttonClassName="w-full"
        options={[{ value: WHOLE, label: '整个画面' }, { value: SHAPES, label: '手绘遮罩' }, ...(clip.trackers ?? []).map(tracker => ({ value: `tracker:${tracker.id}`, label: `跟踪 · ${tracker.name}` })), ...(analyzable ? VIDEO_EDIT_SMART_REGION_IDS.map(id => ({ value: id, label: SMART_REGIONS[id].label })) : [])]}
        onSelect={selectRegion} /></span>
    </Row>
    <Row label="遮罩" tooltip="在节目画面上画遮罩，效果只作用在遮罩里（可以有多个，按模式相加、相减、交叉）">
      <VideoEditMaskCreateButtons target={target} effect={effect} gesture={gesture} />
    </Row>
    <VideoEditMaskShapeControls target={target} effect={effect} gesture={gesture} trackAction={analyzable ? shape => <UiIconButton size="xs" aria-label={shape.follow ? '取消遮罩跟踪' : '跟踪遮罩'} title={shape.follow ? '取消遮罩跟踪' : '跟踪遮罩'} on={Boolean(shape.follow)} onClick={() => { try { trackVideoEditMask(target, effect.id, shape.id); setTrackingError(null) } catch (error) { logger.warn('遮罩跟踪绑定失败', { event: 'video_edit.tracking.bind_failed', error }); setTrackingError(error instanceof Error ? error.message : '遮罩跟踪失败，请重试。') } }}><Scan size={12} /></UiIconButton> : undefined} />
    {trackingError && <UiError size="sm" title="遮罩跟踪失败" message={trackingError} />}
    {trackingStatus?.state === 'tracking' && <p className="text-xs text-text2" role="status">正在跟踪 {Math.round(trackingStatus.progress * 100)}%</p>}
    {trackingStatus?.state === 'failed' && <UiError size="sm" title="跟踪失败" message={videoEditTrackingFailureText(trackingStatus.reason)} actions={<UiButton size="sm" onClick={() => { if (trackingRequest) runVideoEditTracking(trackingRequest.definition, trackingRequest.range, { direction: 'both' }) }}>重试</UiButton>} />}
    {mask && region && <>
      <Row label="羽化" tooltip="区域边缘的柔和过渡，100 约为画面高度的 10%" reset={{ label: '重置羽化', disabled: mask.feather === undefined, onReset: () => gesture.commit({ mask: without(mask, 'feather') }) }}>
        {scrub('羽化', mask.feather ?? region.defaults.feather, SMART_REGION_FEATHER_RANGE, next => gesture.commit({ mask: { ...mask, feather: next } }))}
      </Row>
      <Row label="扩展" tooltip="正数把区域向外扩大，负数向内收缩，100 约为画面高度的 10%" reset={{ label: '重置扩展', disabled: mask.expand === undefined, onReset: () => gesture.commit({ mask: without(mask, 'expand') }) }}>
        {scrub('扩展', mask.expand ?? region.defaults.expand, SMART_REGION_EXPAND_RANGE, next => gesture.commit({ mask: { ...mask, expand: next } }))}
      </Row>
      <Row label="反转" tooltip="作用到区域以外的部分">
        <span className="flex shrink-0 items-center"><UiSwitch aria-label="反转作用区域" checked={Boolean(mask.invert)} onCheckedChange={checked => gesture.commit({ mask: checked ? { ...mask, invert: true } : without(mask, 'invert') })} /></span>
      </Row>
      {status?.state === 'analyzing' && <p className="py-1 text-2xs text-text3" role="status" data-video-edit-smart-region-status="analyzing">
        正在分析画面{status.progress > 0 ? ` ${Math.round(status.progress * 100)}%` : ''}，完成后效果自动出现
      </p>}
      {status?.state === 'failed' && <div data-video-edit-smart-region-status="failed">
        <UiError size="sm" align="start" title="作用区域分析失败" message={videoEditSmartRegionFailureText(status.reason)}
          actions={<span className="flex gap-1">
            {request && <UiButton size="sm" onClick={() => retryVideoEditSmartRegion(request)}>重试</UiButton>}
            {status.reason === 'model' && <UiButton size="sm" onClick={() => openSettingsPanel({ tab: 'files', sectionId: 'files-models' })}>去下载模型</UiButton>}
          </span>} />
      </div>}
    </>}
  </div>
}
