import type { ReactNode } from 'react'
import { RotateCcw } from 'lucide-react'
import { UiIconButton, UiInput, UiTooltipText } from '@/components/ui'
import NumberInput from '@/components/ui/NumberInput'
import type { VideoEditClip, VideoEditComposition } from '@/core/videoEdit/document'
import { videoEditClipPropertyBounds, videoEditClipPropertyDefault, type VideoEditClipPropertyKey } from '../application/videoEditClipProperties'
import { VideoEditEffectSection } from './VideoEditEffectSection'
import type { useVideoEditClipPropertyGesture } from './useVideoEditClipPropertyGesture'
import { videoEditClipValue } from '@/core/videoEdit/keyframes'
import { VideoEditKeyframeControls } from './VideoEditKeyframeControls'

type Gesture = ReturnType<typeof useVideoEditClipPropertyGesture>
type Frame = Pick<VideoEditComposition, 'width' | 'height'> & { playhead: number }

/**
 * 读数按 PR 的单位显示：位置是序列像素（画面中心为宽高的一半），缩放 / 不透明度 / 音量是百分比，旋转是度。
 * 文档里存的仍是归一化数值，换算只发生在界面上。
 */
interface PropertyView { key: VideoEditClipPropertyKey; label: string; tooltip: string; unit?: string; step: number; precision: number; toDisplay: (value: number, frame: Frame) => number; fromDisplay: (value: number, frame: Frame) => number }
const percent = { toDisplay: (value: number) => value * 100, fromDisplay: (value: number) => value / 100, unit: '%', step: 1, precision: 1 }
type VisiblePropertyKey = Exclude<VideoEditClipPropertyKey, 'brightness'>
const VIEWS: Record<VisiblePropertyKey, PropertyView> = {
  x: { key: 'x', label: '水平位置', tooltip: '运动锚点的水平像素位置；序列宽度的一半是居中。', step: 1, precision: 1, toDisplay: (value, frame) => frame.width / 2 + value * frame.width, fromDisplay: (value, frame) => (value - frame.width / 2) / frame.width },
  y: { key: 'y', label: '垂直位置', tooltip: '运动锚点的垂直像素位置；序列高度的一半是居中。', step: 1, precision: 1, toDisplay: (value, frame) => frame.height / 2 + value * frame.height, fromDisplay: (value, frame) => (value - frame.height / 2) / frame.height },
  scale: { key: 'scale', label: '缩放', tooltip: '画面大小，100% 为原始适配大小。', ...percent },
  rotation: { key: 'rotation', label: '旋转', tooltip: '画面绕运动锚点旋转的角度。', unit: '°', step: 1, precision: 1, toDisplay: value => value, fromDisplay: value => value },
  anchorX: { key: 'anchorX', label: '锚点水平', tooltip: '旋转和缩放的支点，50% 为画面中心。', ...percent },
  anchorY: { key: 'anchorY', label: '锚点垂直', tooltip: '旋转和缩放的支点，50% 为画面中心。', ...percent },
  opacity: { key: 'opacity', label: '不透明度', tooltip: '0% 完全透明，100% 完全不透明。', ...percent },
  volume: { key: 'volume', label: '音量', tooltip: '片段音量，100% 为原始音量，0% 静音，最高 200%。', ...percent },
}

function PropertyRow({ label, tooltip, children, resetLabel, resetDisabled, onReset, animation }: { label: string; tooltip: string; children: ReactNode; resetLabel: string; resetDisabled: boolean; onReset: () => void; animation?: ReactNode }): React.ReactElement {
  return <div className="flex min-h-8 flex-wrap items-center gap-1.5 pl-5">
    {animation}<span className="min-w-20 flex-1 text-xs text-text2"><UiTooltipText tooltip={tooltip}>{label}</UiTooltipText></span>
    {children}
    <UiIconButton size="xs" aria-label={resetLabel} title={resetLabel} disabled={resetDisabled} onClick={onReset}><RotateCcw size={12} /></UiIconButton>
  </div>
}

/** 一个数值读数：拖动期间实时预览，松手只记一步撤销，Esc 回到拖动前；输入与步进各算一步。 */
function PropertyNumber({ view, clip, frame, gesture }: { view: PropertyView; clip: VideoEditClip; frame: Frame; gesture: Gesture }): React.ReactElement {
  const value = view.toDisplay(videoEditClipValue(clip, view.key, frame.playhead), frame)
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
const isDefault = (clip: VideoEditClip, keys: readonly VideoEditClipPropertyKey[]): boolean => keys.every(key => (clip[key] ?? 0.5) === videoEditClipPropertyDefault(clip, key) && !clip.curves?.[key]?.length)

function SingleProperty({ property, clip, frame, gesture }: { property: VisiblePropertyKey; clip: VideoEditClip; frame: Frame; gesture: Gesture }): React.ReactElement {
  const view = VIEWS[property]
  const value = videoEditClipValue(clip, property, frame.playhead)
  return <PropertyRow label={view.label} tooltip={view.tooltip} resetLabel={`重置${view.label}`} resetDisabled={value === videoEditClipPropertyDefault(clip, property)} onReset={() => gesture.commit(resetPatch(clip, [property]))}
    animation={<VideoEditKeyframeControls label={view.label} points={clip.curves?.[property]} value={value} time={frame.playhead - clip.start} duration={clip.duration} onChange={points => gesture.keyframes(property, points)} onSeek={time => gesture.seek(clip.start + time)} onDisable={() => { gesture.begin(); gesture.keyframes(property, []); gesture.commit({ [property]: value }); gesture.finish() }} />}>
    <PropertyNumber view={view} clip={clip} frame={frame} gesture={gesture} />
  </PropertyRow>
}

const MOTION: readonly VisiblePropertyKey[] = ['x', 'y', 'scale', 'rotation', 'anchorX', 'anchorY']

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
    {sound && <VideoEditEffectSection id="audio" title="音频" info="片段的音量。">
      <SingleProperty property="volume" clip={clip} frame={frame} gesture={gesture} />
    </VideoEditEffectSection>}
  </>
}
