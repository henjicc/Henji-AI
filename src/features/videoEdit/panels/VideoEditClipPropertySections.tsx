import type { ReactNode } from 'react'
import { RotateCcw } from 'lucide-react'
import { UiIconButton, UiInput, UiTooltipText } from '@/components/ui'
import NumberInput from '@/components/ui/NumberInput'
import type { VideoEditClip, VideoEditComposition } from '@/core/videoEdit/document'
import { videoEditClipPropertyBounds, videoEditClipPropertyDefault, type VideoEditClipPropertyKey } from '../application/videoEditClipProperties'
import { VideoEditEffectSection } from './VideoEditEffectSection'
import type { useVideoEditClipPropertyGesture } from './useVideoEditClipPropertyGesture'

type Gesture = ReturnType<typeof useVideoEditClipPropertyGesture>
type Frame = Pick<VideoEditComposition, 'width' | 'height'>

/**
 * 读数按 PR 的单位显示：位置是序列像素（画面中心为宽高的一半），缩放 / 不透明度 / 亮度 / 音量是百分比，旋转是度。
 * 文档里存的仍是归一化数值，换算只发生在界面上。
 */
interface PropertyView { key: VideoEditClipPropertyKey; label: string; tooltip: string; unit?: string; step: number; precision: number; toDisplay: (value: number, frame: Frame) => number; fromDisplay: (value: number, frame: Frame) => number }
const percent = { toDisplay: (value: number) => value * 100, fromDisplay: (value: number) => value / 100, unit: '%', step: 1, precision: 1 }
const VIEWS: Record<VideoEditClipPropertyKey, PropertyView> = {
  x: { key: 'x', label: '水平位置', tooltip: '画面中心的水平像素位置；序列宽度的一半是居中。', step: 1, precision: 1, toDisplay: (value, frame) => frame.width / 2 + value * frame.width, fromDisplay: (value, frame) => (value - frame.width / 2) / frame.width },
  y: { key: 'y', label: '垂直位置', tooltip: '画面中心的垂直像素位置；序列高度的一半是居中。', step: 1, precision: 1, toDisplay: (value, frame) => frame.height / 2 + value * frame.height, fromDisplay: (value, frame) => (value - frame.height / 2) / frame.height },
  scale: { key: 'scale', label: '缩放', tooltip: '画面大小，100% 为原始适配大小。', ...percent },
  rotation: { key: 'rotation', label: '旋转', tooltip: '画面绕中心旋转的角度。', unit: '°', step: 1, precision: 1, toDisplay: value => value, fromDisplay: value => value },
  opacity: { key: 'opacity', label: '不透明度', tooltip: '0% 完全透明，100% 完全不透明。', ...percent },
  brightness: { key: 'brightness', label: '亮度', tooltip: '画面明暗，100% 为原样，低于 100% 变暗，最高 200%。', ...percent },
  volume: { key: 'volume', label: '音量', tooltip: '片段音量，100% 为原始音量，0% 静音，最高 200%。', ...percent },
}

function PropertyRow({ label, tooltip, children, resetLabel, resetDisabled, onReset }: { label: string; tooltip: string; children: ReactNode; resetLabel: string; resetDisabled: boolean; onReset: () => void }): React.ReactElement {
  return <div className="flex min-h-8 items-center gap-1.5 pl-5">
    <span className="min-w-0 flex-1 truncate text-xs text-text2"><UiTooltipText tooltip={tooltip}>{label}</UiTooltipText></span>
    {children}
    <UiIconButton size="xs" aria-label={resetLabel} title={resetLabel} disabled={resetDisabled} onClick={onReset}><RotateCcw size={12} /></UiIconButton>
  </div>
}

/** 一个数值读数：拖动期间实时预览，松手只记一步撤销，Esc 回到拖动前；输入与步进各算一步。 */
function PropertyNumber({ view, clip, frame, gesture }: { view: PropertyView; clip: VideoEditClip; frame: Frame; gesture: Gesture }): React.ReactElement {
  const value = view.toDisplay(clip[view.key], frame)
  const bounds = videoEditClipPropertyBounds(view.key)
  const factor = 10 ** view.precision
  return <span className="flex shrink-0 items-center gap-1">
    <NumberInput ariaLabel={view.label} increaseLabel={`增加${view.label}`} decreaseLabel={`减少${view.label}`} size="sm" value={value} min={view.toDisplay(bounds.min, frame)} max={view.toDisplay(bounds.max, frame)} step={view.step} precision={view.precision} widthClassName="w-20" align="right"
      onScrubStart={gesture.begin} onScrubEnd={cancelled => { if (cancelled) gesture.cancel(); else gesture.finish() }}
      onChange={next => { if (gesture.active() || Math.round(next * factor) !== Math.round(value * factor)) gesture.commit({ [view.key]: view.fromDisplay(next, frame) }) }} />
    {view.unit ? <span className="w-3 text-2xs text-text3">{view.unit}</span> : <span className="w-3" aria-hidden="true" />}
  </span>
}

function resetPatch(clip: VideoEditClip, keys: readonly VideoEditClipPropertyKey[]): Partial<Record<VideoEditClipPropertyKey, number>> {
  return Object.fromEntries(keys.map(key => [key, videoEditClipPropertyDefault(clip, key)]))
}
const isDefault = (clip: VideoEditClip, keys: readonly VideoEditClipPropertyKey[]): boolean => keys.every(key => clip[key] === videoEditClipPropertyDefault(clip, key))

function SingleProperty({ property, clip, frame, gesture }: { property: VideoEditClipPropertyKey; clip: VideoEditClip; frame: Frame; gesture: Gesture }): React.ReactElement {
  const view = VIEWS[property]
  return <PropertyRow label={view.label} tooltip={view.tooltip} resetLabel={`重置${view.label}`} resetDisabled={isDefault(clip, [property])} onReset={() => gesture.commit(resetPatch(clip, [property]))}>
    <PropertyNumber view={view} clip={clip} frame={frame} gesture={gesture} />
  </PropertyRow>
}

const MOTION: readonly VideoEditClipPropertyKey[] = ['x', 'y', 'scale', 'rotation']

/** 片段固有效果（PR 的“运动 / 不透明度 / 音量”）：按片段类型只出现能生效的几节。 */
export function VideoEditClipPropertySections({ clip, frame, gesture }: { clip: VideoEditClip; frame: Frame; gesture: Gesture }): React.ReactElement {
  const picture = clip.kind !== 'audio'
  const motion = picture && clip.kind !== 'adjustment'
  const sound = clip.kind === 'video' || clip.kind === 'audio'
  return <>
    {clip.kind === 'text' && <VideoEditEffectSection id="text" title="文字">
      <div className="pl-5">
        <UiInput aria-label="画面文字" size="sm" value={clip.text}
          onChange={event => { gesture.begin(); gesture.commit({ text: event.target.value }) }}
          onBlur={() => gesture.finish()}
          onKeyDown={event => { if (event.key === 'Escape' && gesture.active()) { event.preventDefault(); event.stopPropagation(); gesture.cancel(); event.currentTarget.blur() } else if (event.key === 'Enter') event.currentTarget.blur() }} />
      </div>
    </VideoEditEffectSection>}
    {motion && <VideoEditEffectSection id="motion" title="运动" info="画面的位置、大小与旋转。也可以在节目监视器里直接拖动画面。"
      actions={<UiIconButton size="xs" aria-label="重置运动" title="重置运动" disabled={isDefault(clip, MOTION)} onClick={() => gesture.commit(resetPatch(clip, MOTION))}><RotateCcw size={12} /></UiIconButton>}>
      {MOTION.map(key => <SingleProperty key={key} property={key} clip={clip} frame={frame} gesture={gesture} />)}
    </VideoEditEffectSection>}
    {picture && <VideoEditEffectSection id="opacity" title="不透明度" info="片段与下方画面叠加时的透明程度。">
      <SingleProperty property="opacity" clip={clip} frame={frame} gesture={gesture} />
    </VideoEditEffectSection>}
    {motion && <VideoEditEffectSection id="color" title="颜色" info="片段画面的明暗。更多调色可在下方“附加效果”添加滤镜。">
      <SingleProperty property="brightness" clip={clip} frame={frame} gesture={gesture} />
    </VideoEditEffectSection>}
    {sound && <VideoEditEffectSection id="audio" title="音频" info="片段的音量。">
      <SingleProperty property="volume" clip={clip} frame={frame} gesture={gesture} />
    </VideoEditEffectSection>}
  </>
}
