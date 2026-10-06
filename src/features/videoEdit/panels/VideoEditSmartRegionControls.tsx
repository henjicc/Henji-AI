import { useSyncExternalStore } from 'react'
import { RotateCcw } from 'lucide-react'
import { Dropdown, UiButton, UiError, UiIconButton, UiSwitch, UiTooltipText } from '@/components/ui'
import NumberInput from '@/components/ui/NumberInput'
import type { VideoEditBuiltinEffect } from '@/core/videoEdit/compositing'
import { isVideoEditSmartRegionId, SMART_REGION_EXPAND_RANGE, SMART_REGION_FEATHER_RANGE, SMART_REGIONS, VIDEO_EDIT_SMART_REGION_IDS } from '@/core/videoEdit/smartRegions'
import { openSettingsPanel } from '@/stores/uiStore'
import { requireVideoEditInstance } from '../application/videoEditService'
import type { VideoEditCompositeTarget } from '../application/videoEditCompositing'
import { retryVideoEditSmartRegion, subscribeVideoEditSmartRegions, videoEditSmartRegionFailureText, videoEditSmartRegionRequest, videoEditSmartRegionStatus, videoEditSmartRegionsRevision } from '../application/videoEditSmartRegions'
import type { VideoEditBuiltinParamGesture } from './useVideoEditBuiltinParamGesture'

const WHOLE = 'whole'
/** 去掉一项设置（回到区域默认值），不留 undefined 键。 */
function without<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> { const { [key]: _removed, ...rest } = value; return rest }

function Row({ label, tooltip, children, reset }: { label: string; tooltip: string; children: React.ReactNode; reset?: { label: string; disabled: boolean; onReset: () => void } }): React.ReactElement {
  return <div className="flex min-h-8 items-center gap-1.5" data-video-edit-smart-region-row={label}>
    <span className="min-w-0 flex-1 truncate text-xs text-text2"><UiTooltipText tooltip={tooltip}>{label}</UiTooltipText></span>
    {children}
    {reset ? <UiIconButton size="xs" aria-label={reset.label} title={reset.label} disabled={reset.disabled} onClick={reset.onReset}><RotateCcw size={12} /></UiIconButton> : <span className="w-5 shrink-0" aria-hidden="true" />}
  </div>
}

/**
 * 效果控件里内置画面效果的“作用区域”（4.7d）：整个画面 / 人脸 / 人物 / 背景 / 文字，选了区域再给羽化、扩展、反转。
 * 区域在后台分析，这里显示进度；失败给出用户能处理的说明与重试（模型下载失败可直接去设置下载）。
 */
export function VideoEditSmartRegionControls({ target, effect, gesture }: { target: VideoEditCompositeTarget; effect: VideoEditBuiltinEffect; gesture: VideoEditBuiltinParamGesture }): React.ReactElement | null {
  useSyncExternalStore(subscribeVideoEditSmartRegions, videoEditSmartRegionsRevision)
  const document = requireVideoEditInstance(target.projectId).document
  const sequence = document.sequences.find(entry => entry.id === target.sequenceId)
  const clip = sequence?.clips.find(entry => entry.id === target.clipId)
  // 只有视频、图片片段能分析画面；文字、图形、代码与调整图层上的效果不显示这一组。
  if (!sequence || !clip || (clip.kind !== 'video' && clip.kind !== 'image')) return null
  const mask = effect.mask
  const region = mask ? SMART_REGIONS[mask.regionId] : undefined
  const status = mask ? videoEditSmartRegionStatus(document, sequence.frameRate, clip, effect) : undefined
  const request = mask ? videoEditSmartRegionRequest(document, sequence.frameRate, clip, effect) : undefined
  const scrub = (label: string, value: number, range: { min: number; max: number }, apply: (next: number) => void): React.ReactElement => <span className="flex shrink-0 items-center gap-1">
    <NumberInput ariaLabel={label} increaseLabel={`增加${label}`} decreaseLabel={`减少${label}`} size="sm" value={value} min={range.min} max={range.max} step={1} precision={0} widthClassName="w-20" align="right"
      onScrubStart={gesture.begin} onScrubEnd={cancelled => { if (cancelled) gesture.cancel(); else gesture.finish() }}
      onChange={next => { if (gesture.active() || Math.round(next) !== Math.round(value)) apply(Math.round(next)) }} />
    <span className="w-6" aria-hidden="true" />
  </span>
  return <div className="flex flex-col" data-video-edit-smart-region={mask?.regionId ?? WHOLE}>
    <Row label="作用区域" tooltip="效果只作用在 AI 找出的区域里：人脸逐帧跟随，人物与背景按抠像，文字找字幕与标牌。第一次使用会在后台分析素材。">
      <span className="w-32 shrink-0"><Dropdown ariaLabel="作用区域" value={mask?.regionId ?? WHOLE} buttonClassName="w-full"
        options={[{ value: WHOLE, label: '整个画面' }, ...VIDEO_EDIT_SMART_REGION_IDS.map(id => ({ value: id, label: SMART_REGIONS[id].label }))]}
        onSelect={value => gesture.commit({ mask: isVideoEditSmartRegionId(value) ? { regionId: value } : null })} /></span>
    </Row>
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
