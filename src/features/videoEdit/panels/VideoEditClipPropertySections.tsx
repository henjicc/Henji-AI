import { RotateCcw, AlignHorizontalJustifyStart, AlignHorizontalJustifyCenter, AlignHorizontalJustifyEnd, AlignVerticalJustifyStart, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd } from 'lucide-react'
import { UiIconButton, UiInput, UiPropertyUnit } from '@/components/ui'
import { UI_PROPERTY_INSET_CLASS } from '@/components/ui/styleTokens'
import NumberInput from '@/components/ui/NumberInput'
import type { VideoEditClip, VideoEditComposition, VideoEditIntrinsicSection } from '@/core/videoEdit/document'
import { videoEditClipPropertyBounds, videoEditClipPropertyDefault, type VideoEditClipPropertyKey } from '../application/videoEditClipProperties'
import { VideoEditEffectSection } from './VideoEditEffectSection'
import { VideoEditPropertyRow } from './VideoEditPropertyRow'
import type { useVideoEditClipPropertyGesture } from './useVideoEditClipPropertyGesture'
import { videoEditClipValue } from '@/core/videoEdit/keyframes'
import { VideoEditKeyframeNavigator, VideoEditKeyframeStopwatch, type VideoEditKeyframeControlProps } from './VideoEditKeyframeControls'
import { layoutVideoEditText } from '@/core/videoEdit/text'
import { videoEditClipToFrame } from '@/core/videoEdit/clipGeometry'

type Gesture = ReturnType<typeof useVideoEditClipPropertyGesture>
type Frame = Pick<VideoEditComposition, 'width' | 'height'> & { playhead: number }

/**
 * 读数按 PR 的单位显示：位置是序列像素（画面中心为宽高的一半），缩放 / 不透明度 / 音量是百分比，旋转是度。
 * 文档里存的仍是归一化数值，换算只发生在界面上。
 */
interface PropertyView { key: VideoEditClipPropertyKey; label: string; unit?: string; step: number; precision: number; toDisplay: (value: number, frame: Frame) => number; fromDisplay: (value: number, frame: Frame) => number }
const percent = { toDisplay: (value: number) => value * 100, fromDisplay: (value: number) => value / 100, unit: '%', step: 1, precision: 1 }
const VIEWS: Record<VideoEditClipPropertyKey, PropertyView> = {
  x: { key: 'x', label: '水平位置', step: 1, precision: 1, toDisplay: (value, frame) => frame.width / 2 + value * frame.width, fromDisplay: (value, frame) => (value - frame.width / 2) / frame.width },
  y: { key: 'y', label: '垂直位置', step: 1, precision: 1, toDisplay: (value, frame) => frame.height / 2 + value * frame.height, fromDisplay: (value, frame) => (value - frame.height / 2) / frame.height },
  scale: { key: 'scale', label: '缩放', ...percent },
  rotation: { key: 'rotation', label: '旋转', unit: '°', step: 1, precision: 1, toDisplay: value => value, fromDisplay: value => value },
  anchorX: { key: 'anchorX', label: '锚点水平', ...percent },
  anchorY: { key: 'anchorY', label: '锚点垂直', ...percent },
  opacity: { key: 'opacity', label: '不透明度', ...percent },
  volume: { key: 'volume', label: '音量', ...percent },
}

/** 属性行（重要记录 019）：多维属性合成一行（位置的 X、Y，锚点的水平、垂直），一个秒表管整行。 */
interface PropertyRowView { label: string; tooltip: string; keys: readonly VideoEditClipPropertyKey[] }
const ROWS = {
  position: { label: '位置', tooltip: '运动锚点在序列里的像素位置，宽高的一半是居中。', keys: ['x', 'y'] },
  scale: { label: '缩放', tooltip: '画面大小，100% 为原始适配大小。', keys: ['scale'] },
  rotation: { label: '旋转', tooltip: '画面绕运动锚点旋转的角度。', keys: ['rotation'] },
  anchor: { label: '锚点', tooltip: '旋转和缩放的支点，50% 为画面中心。', keys: ['anchorX', 'anchorY'] },
  opacity: { label: '不透明度', tooltip: '0% 完全透明，100% 完全不透明。', keys: ['opacity'] },
  volume: { label: '音量', tooltip: '片段音量，100% 为原始音量，0% 静音，最高 200%。', keys: ['volume'] },
} as const satisfies Record<string, PropertyRowView>
const MOTION_ROWS: readonly PropertyRowView[] = [ROWS.position, ROWS.scale, ROWS.rotation, ROWS.anchor]
const MOTION: readonly VideoEditClipPropertyKey[] = MOTION_ROWS.flatMap(row => row.keys)

/** 一个数值读数：拖动期间实时预览，松手只记一步撤销，Esc 回到拖动前；输入与步进各算一步。行末的单位挂进单位道，各行右缘对齐。 */
function PropertyNumber({ view, clip, frame, gesture, last }: { view: PropertyView; clip: VideoEditClip; frame: Frame; gesture: Gesture; last: boolean }): React.ReactElement {
  const value = view.toDisplay(videoEditClipValue({ ...clip, disabledIntrinsicSections: [] }, view.key, frame.playhead), frame)
  const bounds = videoEditClipPropertyBounds(view.key)
  const factor = 10 ** view.precision
  return <span className="flex shrink-0 items-center">
    <NumberInput ariaLabel={view.label} increaseLabel={`增加${view.label}`} decreaseLabel={`减少${view.label}`} size="sm" value={value} min={view.toDisplay(bounds.min, frame)} max={view.toDisplay(bounds.max, frame)} step={view.step} precision={view.precision} widthClassName="w-14" align="right"
      onScrubStart={gesture.begin} onScrubEnd={cancelled => { if (cancelled) gesture.cancel(); else gesture.finish() }}
      onChange={next => { if (gesture.active() || Math.round(next * factor) !== Math.round(value * factor)) gesture.commit({ [view.key]: view.fromDisplay(next, frame) }) }} />
    <UiPropertyUnit hanging={last}>{view.unit}</UiPropertyUnit>
  </span>
}

function resetPatch(clip: VideoEditClip, keys: readonly VideoEditClipPropertyKey[]): Partial<Record<VideoEditClipPropertyKey, number>> {
  return Object.fromEntries(keys.map(key => [key, videoEditClipPropertyDefault(clip, key)]))
}
const isDefault = (clip: VideoEditClip, keys: readonly VideoEditClipPropertyKey[]): boolean => keys.every(key => (clip[key] ?? 0.5) === videoEditClipPropertyDefault(clip, key) && !clip.curves?.[key]?.length)

/** 一行属性：秒表列、名称（开了动画后悬停出关键帧导航）、右对齐的读数；重置在名称上的右键菜单。 */
function PropertyRow({ row, clip, frame, gesture }: { row: PropertyRowView; clip: VideoEditClip; frame: Frame; gesture: Gesture }): React.ReactElement {
  const values = row.keys.map(key => videoEditClipValue({ ...clip, disabledIntrinsicSections: [] }, key, frame.playhead))
  const changed = row.keys.some((key, index) => values[index] !== videoEditClipPropertyDefault(clip, key))
  const reset = (): void => gesture.commit(resetPatch(clip, row.keys))
  const keyframes: VideoEditKeyframeControlProps = {
    label: row.label, channels: row.keys.map((key, index) => ({ key, points: clip.curves?.[key], value: values[index] })), time: frame.playhead - clip.start, duration: clip.duration,
    onChange: changes => {
      const own = !gesture.active(); if (own) gesture.begin()
      for (const [key, points] of Object.entries(changes)) gesture.keyframes(key as VideoEditClipPropertyKey, points)
      if (own) gesture.finish()
    },
    onDisable: () => { gesture.begin(); for (const key of row.keys) gesture.keyframes(key, []); gesture.commit(Object.fromEntries(row.keys.map((key, index) => [key, values[index]]))); gesture.finish() },
    onSeek: time => gesture.seek(clip.start + time), onBegin: gesture.begin, onFinish: gesture.finish, onCancel: gesture.cancel,
  }
  return <VideoEditPropertyRow label={row.label} tooltip={row.tooltip} data-video-edit-property-row={row.label} reset={{ label: `重置${row.label}`, disabled: !changed, onReset: reset }}
    leading={<VideoEditKeyframeStopwatch {...keyframes} />} labelTrailing={<VideoEditKeyframeNavigator {...keyframes} />}>
    {row.keys.map((key, index) => <PropertyNumber key={key} view={VIEWS[key]} clip={clip} frame={frame} gesture={gesture} last={index === row.keys.length - 1} />)}
  </VideoEditPropertyRow>
}

function switchProps(clip: VideoEditClip, gesture: Gesture, section: VideoEditIntrinsicSection) {
  return { enabled: !clip.disabledIntrinsicSections?.includes(section), onEnabledChange: (enabled: boolean): void => { gesture.finish(); gesture.commit({ disabledIntrinsicSections: enabled ? (clip.disabledIntrinsicSections ?? []).filter(value => value !== section) : [...(clip.disabledIntrinsicSections ?? []), section] }) } }
}
function MotionReset({ clip, gesture }: { clip: VideoEditClip; gesture: Gesture }): React.ReactElement {
  return <UiIconButton size="2xs" aria-label="重置运动" tooltip="重置运动" disabled={isDefault(clip, MOTION)} onClick={() => gesture.commit(resetPatch(clip, MOTION))}><RotateCcw /></UiIconButton>
}

const TEXT_ALIGNMENTS = [['x', 0, '对齐画面左边', AlignHorizontalJustifyStart], ['x', .5, '对齐画面水平中心', AlignHorizontalJustifyCenter], ['x', 1, '对齐画面右边', AlignHorizontalJustifyEnd], ['y', 0, '对齐画面顶部', AlignVerticalJustifyStart], ['y', .5, '对齐画面垂直中心', AlignVerticalJustifyCenter], ['y', 1, '对齐画面底部', AlignVerticalJustifyEnd]] as const

export function VideoEditTextTransformControls({ clip, frame, gesture }: { clip: VideoEditClip; frame: Frame; gesture: Gesture }): React.ReactElement {
  const align = (axis: 'x' | 'y', target: 0 | .5 | 1): void => {
    const context = document.createElement('canvas').getContext('2d'); if (!context) return
    const layout = layoutVideoEditText(clip, frame, (text, font) => { context.font = font; return context.measureText(text).width })
    const evaluated = { ...clip, ...Object.fromEntries(MOTION.map(key => [key, videoEditClipValue(clip, key, frame.playhead)])) }
    const corners = [[layout.left, layout.top], [layout.left + layout.width, layout.top], [layout.left + layout.width, layout.top + layout.height], [layout.left, layout.top + layout.height]].map(([x, y]) => videoEditClipToFrame(evaluated, frame, frame, x / frame.width, y / frame.height)[axis])
    const edge = target === 0 ? Math.min(...corners) : target === 1 ? Math.max(...corners) : (Math.min(...corners) + Math.max(...corners)) / 2
    gesture.commit({ [axis]: videoEditClipValue(clip, axis, frame.playhead) + target - edge })
  }
  return <>
    <VideoEditEffectSection id="motion" title="运动" {...switchProps(clip, gesture, 'motion')} actions={<MotionReset clip={clip} gesture={gesture} />}>
      <div className={`flex gap-0.5 pb-1 ${UI_PROPERTY_INSET_CLASS}`}>{TEXT_ALIGNMENTS.map(([axis, value, label, Icon]) => <UiIconButton key={label} size="xs" aria-label={label} tooltip={label} onClick={() => align(axis, value)}><Icon /></UiIconButton>)}</div>
      {MOTION_ROWS.map(row => <PropertyRow key={row.label} row={row} clip={clip} frame={frame} gesture={gesture} />)}
    </VideoEditEffectSection>
    <VideoEditEffectSection id="opacity" title="不透明度" {...switchProps(clip, gesture, 'opacity')}>
      <PropertyRow row={ROWS.opacity} clip={clip} frame={frame} gesture={gesture} />
    </VideoEditEffectSection>
  </>
}

/** 片段固有效果（PR 的“运动 / 不透明度 / 音量”）：按片段类型只出现能生效的几节。 */
export function VideoEditClipPropertySections({ clip, frame, gesture }: { clip: VideoEditClip; frame: Frame; gesture: Gesture }): React.ReactElement {
  const picture = clip.kind !== 'audio'
  const motion = picture && clip.kind !== 'adjustment' && clip.kind !== 'text'
  const sound = clip.kind === 'video' || clip.kind === 'audio'
  return <>
    {clip.kind === 'text' && <VideoEditEffectSection id="text" title="文字" {...switchProps(clip, gesture, 'text')}>
      <div className={`py-1 ${UI_PROPERTY_INSET_CLASS}`}>
        <UiInput aria-label="画面文字" size="sm" value={clip.text}
          onChange={event => { gesture.begin(); gesture.commit({ text: event.target.value }) }}
          onBlur={() => gesture.finish()}
          onKeyDown={event => { if (event.key === 'Escape' && gesture.active()) { event.preventDefault(); event.stopPropagation(); gesture.cancel(); event.currentTarget.blur() } else if (event.key === 'Enter') event.currentTarget.blur() }} />
      </div>
    </VideoEditEffectSection>}
    {motion && <VideoEditEffectSection id="motion" title="运动" {...switchProps(clip, gesture, 'motion')} info="画面的位置、大小与旋转。也可以在节目监视器里直接拖动画面。" actions={<MotionReset clip={clip} gesture={gesture} />}>
      {MOTION_ROWS.map(row => <PropertyRow key={row.label} row={row} clip={clip} frame={frame} gesture={gesture} />)}
    </VideoEditEffectSection>}
    {picture && clip.kind !== 'text' && <VideoEditEffectSection id="opacity" title="不透明度" {...switchProps(clip, gesture, 'opacity')} info="片段与下方画面叠加时的透明程度。">
      <PropertyRow row={ROWS.opacity} clip={clip} frame={frame} gesture={gesture} />
    </VideoEditEffectSection>}
    {sound && <VideoEditEffectSection id="audio" title="音频" {...switchProps(clip, gesture, 'audio')} info="片段的音量。">
      <PropertyRow row={ROWS.volume} clip={clip} frame={frame} gesture={gesture} />
    </VideoEditEffectSection>}
  </>
}
