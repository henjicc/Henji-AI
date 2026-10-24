import { useMemo, useState } from 'react'
import { Dropdown, UiCurveEditor, UiFormRow, UiInlineStatus, UiSegmented, UiSwitch, type UiCurvePoint } from '@/components/ui'
import { UI_PROPERTY_INSET_CLASS } from '@/components/ui/styleTokens'
import { VideoEditEffectSection } from './VideoEditEffectSection'
import NumberInput from '@/components/ui/NumberInput'
import type { VideoEditClip, VideoEditSequence } from '@/core/videoEdit/document'
import { videoEditClipAudioMode, videoEditClipPitchStretchOutOfRange, videoEditClipSourceSpanSeconds, videoEditClipSpeedSupported, videoEditClipSpeedValue } from '@/core/videoEdit/clipSpeed'
import type { VideoEditSpeedChange } from '@/core/videoEdit/clipSpeedEdits'
import { videoEditTimeRemapSchema, videoEditTimeRemapSpeedAtSource, VIDEO_EDIT_TIME_REMAP_MAX_POINTS, type VideoEditFrameInterpolation, type VideoEditTimeRemap } from '@/core/videoEdit/timeRemap'
import { VIDEO_EDIT_TIME_REMAP_PRESETS, VIDEO_EDIT_TIME_REMAP_PRESET_IDS, videoEditTimeRemapPreset, type VideoEditTimeRemapPreset } from '@/core/videoEdit/timeRemapRamps'
import { videoEditPickRelations } from '@/core/videoEdit/timelineSelection'
import { videoEditFps } from '@/core/videoEdit/time'
import { executeVideoEditTimelineEdit } from '../application/videoEditTimeline'
import type { VideoEditInstance } from '../application/videoEditService'

/** 曲线纵轴：10%–1000% 对数刻度，100% 在正中。 */
const SPEED_LOG_RANGE = 1
const toY = (speed: number): number => Math.max(0, Math.min(1, (Math.log10(speed) + SPEED_LOG_RANGE) / (2 * SPEED_LOG_RANGE)))
const toSpeed = (y: number): number => 10 ** (y * 2 * SPEED_LOG_RANGE - SPEED_LOG_RANGE)
/** 横轴是片段用到的素材（0 开头、1 结尾）；界面画的点之间一律缓入缓出（与剪映曲线变速一致）。 */
function curveFromPoints(points: readonly UiCurvePoint[], spanSeconds: number): VideoEditTimeRemap {
  const span = Math.max(1, Math.round(spanSeconds * 1e6))
  const placed = new Map<number, { offsetUs: number; speed: number; interpolation: 'ease' }>()
  for (const point of [...points].sort((a, b) => a.x - b.x)) {
    const offsetUs = Math.round(Math.max(0, Math.min(1, point.x)) * span)
    placed.set(offsetUs, { offsetUs, speed: Math.round(toSpeed(point.y) * 10000) / 10000, interpolation: 'ease' })
  }
  return videoEditTimeRemapSchema.parse({ points: [...placed.values()].slice(0, VIDEO_EDIT_TIME_REMAP_MAX_POINTS) })
}

/**
 * 时间重映射（对标 PR 时间重映射与剪映曲线变速）：速度曲线、预设、补帧与变调。写入全部走时间线的速度编辑
 * （与“速度/持续时间”对话框、助手的 time_remap 属性与 ramp_video_edit_clip_speed 同一入口），一次编辑一次撤销；
 * 片段用到的素材不变，时长随曲线变化，按链接选择同时改链接的声音。
 */
export function VideoEditTimeRemapPanel({ instance, sequence, clip, onError }: { instance: VideoEditInstance; sequence: VideoEditSequence; clip: VideoEditClip; onError: (reason: unknown) => void }): React.ReactElement | null {
  const fps = videoEditFps(sequence.frameRate)
  const span = videoEditClipSourceSpanSeconds(clip, fps)
  const remap = clip.timeRemap
  const committed = useMemo(() => remap ? remap.points.filter(point => point.offsetUs <= span * 1e6 + 1).map(point => ({ x: span > 0 ? point.offsetUs / (span * 1e6) : 0, y: toY(point.speed) })) : [], [remap, span])
  const [draft, setDraft] = useState<UiCurvePoint[] | null>(null)
  const points = draft ?? committed
  const preview = useMemo(() => points.length ? curveFromPoints(points, span) : undefined, [points, span])
  if (!videoEditClipSpeedSupported(clip.kind) || clip.frameHold) return null
  const apply = (change: VideoEditSpeedChange): void => {
    try { executeVideoEditTimelineEdit(instance.document.id, sequence.id, { kind: 'speed', clipIds: [clip.id], linked: videoEditPickRelations(instance.linkedSelection !== false), change: { ripple: true, ...change } }) } catch (error) { onError(error) }
  }
  const enable = (on: boolean): void => {
    if (!on) { apply({ timeRemap: null }); return }
    const speed = videoEditClipSpeedValue(clip)
    apply({ timeRemap: { points: [{ offsetUs: 0, speed, interpolation: 'ease' }, { offsetUs: Math.max(1, Math.round(span * 1e6)), speed, interpolation: 'ease' }] } })
  }
  const outOfRange = clip.preservePitch && videoEditClipPitchStretchOutOfRange(clip)
  const stretched = videoEditClipAudioMode(clip) === 'stretch'
  return <VideoEditEffectSection id="time-remap" title="时间重映射"><div className="flex flex-col" data-video-edit-time-remap-panel="">
    <UiFormRow label="速度曲线" density="compact" inline><UiSwitch aria-label="速度曲线" checked={Boolean(remap)} onCheckedChange={enable} /></UiFormRow>
    {remap && <>
      <UiFormRow label="曲线" density="compact" wide info="横向是片段用到的素材，纵向是速度（中线 100%，上 1000%，下 10%）。点击加点，拖动调整，双击删除；时长随曲线变化。">
        <UiCurveEditor label="速度曲线" value={points} defaultValue={committed} sample={preview ? x => toY(videoEditTimeRemapSpeedAtSource(preview, x * span)) : undefined}
          onChange={setDraft} onBegin={() => setDraft(committed)} onCancel={() => setDraft(null)}
          onFinish={() => { setDraft(current => { if (current && JSON.stringify(current) !== JSON.stringify(committed)) apply({ timeRemap: curveFromPoints(current, span) }); return null }) }} />
      </UiFormRow>
      <UiFormRow label="预设" density="compact">
        <Dropdown ariaLabel="速度曲线预设" value="" display="选择预设" options={VIDEO_EDIT_TIME_REMAP_PRESET_IDS.map(id => ({ value: id, label: VIDEO_EDIT_TIME_REMAP_PRESETS[id].label }))} onSelect={(id: string) => { if (id) apply({ timeRemap: videoEditTimeRemapPreset(id as VideoEditTimeRemapPreset, span) }) }} />
      </UiFormRow>
    </>}
    <UiFormRow label="补帧" density="compact" info="慢放时相邻两帧怎样过渡：采样取最近的一帧；混合把相邻两帧按位置混合，慢放更顺但有重影。">
      {/* 光流补帧尚未实现，不出现在界面上；旧数据里的 optical_flow 按帧混合渲染，这里也显示为“混合”。 */}
      <UiSegmented<VideoEditFrameInterpolation> ariaLabel="补帧方式" size="sm" value={(clip.frameInterpolation ?? (sequence.frameBlend ? 'blend' : 'nearest')) === 'nearest' ? 'nearest' : 'blend'} onChange={value => apply({ frameInterpolation: value })}
        options={[{ value: 'nearest', label: '采样' }, { value: 'blend', label: '混合' }]} />
    </UiFormRow>
    <UiFormRow label="变调" density="compact" info="升降音调，不改变速度与时长；+12 高一个八度。">
      <NumberInput ariaLabel="变调半音" size="sm" align="right" value={clip.pitchSemitones ?? 0} min={-24} max={24} step={1} precision={0} onChange={value => apply({ pitchSemitones: value })} />
    </UiFormRow>
    {outOfRange && !stretched && <div className={UI_PROPERTY_INSET_CLASS}><UiInlineStatus tone="warning">速度超出 25%–400%，这段声音不保持音调。</UiInlineStatus></div>}
  </div></VideoEditEffectSection>
}
