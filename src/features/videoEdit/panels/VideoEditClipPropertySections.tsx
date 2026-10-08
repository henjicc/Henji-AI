import type { ReactNode } from 'react'
import { RotateCcw, AlignHorizontalJustifyStart, AlignHorizontalJustifyCenter, AlignHorizontalJustifyEnd, AlignVerticalJustifyStart, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd, Link } from 'lucide-react'
import { UiIconButton, UiInput, UiTooltipText } from '@/components/ui'
import NumberInput from '@/components/ui/NumberInput'
import type { VideoEditClip, VideoEditComposition, VideoEditIntrinsicSection } from '@/core/videoEdit/document'
import { videoEditClipPropertyBounds, videoEditClipPropertyDefault, type VideoEditClipPropertyKey } from '../application/videoEditClipProperties'
import { VideoEditEffectSection } from './VideoEditEffectSection'
import type { useVideoEditClipPropertyGesture } from './useVideoEditClipPropertyGesture'
import { videoEditClipValue } from '@/core/videoEdit/keyframes'
import { VideoEditKeyframeControls } from './VideoEditKeyframeControls'
import { layoutVideoEditText } from '@/core/videoEdit/text'
import { videoEditClipToFrame } from '@/core/videoEdit/clipGeometry'

type Gesture = ReturnType<typeof useVideoEditClipPropertyGesture>
type Frame = Pick<VideoEditComposition, 'width' | 'height'> & { playhead: number }

/**
 * 读数按 PR 的单位显示：位置是序列像素（画面中心为宽高的一半），缩放 / 不透明度 / 音量是百分比，旋转是度。
 * 文档里存的仍是归一化数值，换算只发生在界面上。
 */
interface PropertyView { key: VideoEditClipPropertyKey; label: string; tooltip: string; unit?: string; step: number; precision: number; toDisplay: (value: number, frame: Frame) => number; fromDisplay: (value: number, frame: Frame) => number }
const percent = { toDisplay: (value: number) => value * 100, fromDisplay: (value: number) => value / 100, unit: '%', step: 1, precision: 1 }
const VIEWS: Record<VideoEditClipPropertyKey, PropertyView> = {
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
  const value = view.toDisplay(videoEditClipValue({ ...clip, disabledIntrinsicSections: [] }, view.key, frame.playhead), frame)
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

function SingleProperty({ property, clip, frame, gesture }: { property: VideoEditClipPropertyKey; clip: VideoEditClip; frame: Frame; gesture: Gesture }): React.ReactElement {
  const view = VIEWS[property]
  const value = videoEditClipValue({ ...clip, disabledIntrinsicSections: [] }, property, frame.playhead)
  return <PropertyRow label={view.label} tooltip={view.tooltip} resetLabel={`重置${view.label}`} resetDisabled={value === videoEditClipPropertyDefault(clip, property)} onReset={() => gesture.commit(resetPatch(clip, [property]))}
    animation={<VideoEditKeyframeControls onBegin={gesture.begin} onFinish={gesture.finish} onCancel={gesture.cancel} label={view.label} points={clip.curves?.[property]} value={value} time={frame.playhead - clip.start} duration={clip.duration} onChange={points => gesture.keyframes(property, points)} onSeek={time => gesture.seek(clip.start + time)} onDisable={() => { gesture.begin(); gesture.keyframes(property, []); gesture.commit({ [property]: value }); gesture.finish() }} />}>
    <PropertyNumber view={view} clip={clip} frame={frame} gesture={gesture} />
  </PropertyRow>
}

const MOTION: readonly VideoEditClipPropertyKey[] = ['x', 'y', 'scale', 'rotation', 'anchorX', 'anchorY']

export function VideoEditTextTransformControls({ clip, frame, gesture }: { clip: VideoEditClip; frame: Frame; gesture: Gesture }): React.ReactElement {
  const align = (axis: 'x' | 'y', target: 0 | .5 | 1): void => {
    const context = document.createElement('canvas').getContext('2d'); if (!context) return
    const layout = layoutVideoEditText(clip, frame, (text, font) => { context.font = font; return context.measureText(text).width })
    const evaluated = { ...clip, ...Object.fromEntries(MOTION.map(key => [key, videoEditClipValue(clip, key, frame.playhead)])) }
    const corners = [[layout.left, layout.top], [layout.left + layout.width, layout.top], [layout.left + layout.width, layout.top + layout.height], [layout.left, layout.top + layout.height]].map(([x, y]) => videoEditClipToFrame(evaluated, frame, frame, x / frame.width, y / frame.height)[axis])
    const edge = target === 0 ? Math.min(...corners) : target === 1 ? Math.max(...corners) : (Math.min(...corners) + Math.max(...corners)) / 2
    gesture.commit({ [axis]: videoEditClipValue(clip, axis, frame.playhead) + target - edge })
  }
  const switchProps = (section: VideoEditIntrinsicSection) => ({ enabled: !clip.disabledIntrinsicSections?.includes(section), onEnabledChange: (enabled: boolean): void => { gesture.finish(); gesture.commit({ disabledIntrinsicSections: enabled ? (clip.disabledIntrinsicSections ?? []).filter(value => value !== section) : [...(clip.disabledIntrinsicSections ?? []), section] }) } })
  return <>
    <VideoEditEffectSection id="motion" title="运动" {...switchProps('motion')}>
    <div className="flex flex-wrap gap-1">{([['x', 0, '对齐画面左边', AlignHorizontalJustifyStart], ['x', .5, '对齐画面水平中心', AlignHorizontalJustifyCenter], ['x', 1, '对齐画面右边', AlignHorizontalJustifyEnd], ['y', 0, '对齐画面顶部', AlignVerticalJustifyStart], ['y', .5, '对齐画面垂直中心', AlignVerticalJustifyCenter], ['y', 1, '对齐画面底部', AlignVerticalJustifyEnd]] as const).map(([axis, value, label, Icon]) => <UiIconButton key={label} size="sm" aria-label={label} title={label} onClick={() => align(axis, value)}><Icon size={14} /></UiIconButton>)}</div>
    {MOTION.map(key => <SingleProperty key={key} property={key} clip={clip} frame={frame} gesture={gesture} />)}
    <span className="flex items-center gap-1 text-xs text-text2"><Link size={14} />等比缩放</span>
    </VideoEditEffectSection>
    <VideoEditEffectSection id="opacity" title="不透明度" {...switchProps('opacity')}>
    <SingleProperty property="opacity" clip={clip} frame={frame} gesture={gesture} />
    </VideoEditEffectSection>
  </>
}

/** 片段固有效果（PR 的“运动 / 不透明度 / 音量”）：按片段类型只出现能生效的几节。 */
export function VideoEditClipPropertySections({ clip, frame, gesture }: { clip: VideoEditClip; frame: Frame; gesture: Gesture }): React.ReactElement {
  const picture = clip.kind !== 'audio'
  const motion = picture && clip.kind !== 'adjustment' && clip.kind !== 'text'
  const sound = clip.kind === 'video' || clip.kind === 'audio'
  const switchProps = (section: VideoEditIntrinsicSection) => ({ enabled: !clip.disabledIntrinsicSections?.includes(section), onEnabledChange: (enabled: boolean): void => { gesture.finish(); gesture.commit({ disabledIntrinsicSections: enabled ? (clip.disabledIntrinsicSections ?? []).filter(value => value !== section) : [...(clip.disabledIntrinsicSections ?? []), section] }) } })
  return <>
    {clip.kind === 'text' && <VideoEditEffectSection id="text" title="文字" {...switchProps('text')}>
      <div className="pl-5">
        <UiInput aria-label="画面文字" size="sm" value={clip.text}
          onChange={event => { gesture.begin(); gesture.commit({ text: event.target.value }) }}
          onBlur={() => gesture.finish()}
          onKeyDown={event => { if (event.key === 'Escape' && gesture.active()) { event.preventDefault(); event.stopPropagation(); gesture.cancel(); event.currentTarget.blur() } else if (event.key === 'Enter') event.currentTarget.blur() }} />
      </div>
    </VideoEditEffectSection>}
    {motion && <VideoEditEffectSection id="motion" title="运动" {...switchProps('motion')} info="画面的位置、大小与旋转。也可以在节目监视器里直接拖动画面。"
      actions={<UiIconButton size="xs" aria-label="重置运动" title="重置运动" disabled={isDefault(clip, MOTION)} onClick={() => gesture.commit(resetPatch(clip, MOTION))}><RotateCcw size={12} /></UiIconButton>}>
      {MOTION.map(key => <SingleProperty key={key} property={key} clip={clip} frame={frame} gesture={gesture} />)}
    </VideoEditEffectSection>}
    {picture && clip.kind !== 'text' && <VideoEditEffectSection id="opacity" title="不透明度" {...switchProps('opacity')} info="片段与下方画面叠加时的透明程度。">
      <SingleProperty property="opacity" clip={clip} frame={frame} gesture={gesture} />
    </VideoEditEffectSection>}
    {sound && <VideoEditEffectSection id="audio" title="音频" {...switchProps('audio')} info="片段的音量。">
      <SingleProperty property="volume" clip={clip} frame={frame} gesture={gesture} />
    </VideoEditEffectSection>}
  </>
}
