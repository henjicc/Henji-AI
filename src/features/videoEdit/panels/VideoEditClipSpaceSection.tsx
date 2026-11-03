import NumberInput from '@/components/ui/NumberInput'
import Dropdown from '@/components/ui/Dropdown'
import { UiColorInput, UiSwitch } from '@/components/ui'
import { EffectSection } from '@/components/effects/EffectSection'
import type { VideoEditClip } from '@/core/videoEdit/document'
import { SPACE_EMISSION_MAX, SPACE_LIGHT_INTENSITY_MAX, SPACE_THICKNESS_MAX, type SpaceLightKind, type SpaceMaterial } from '@/core/videoEdit/spatialSchema'
import { SPATIAL_LIGHT_DEFAULTS } from '@/core/videoEdit/spatialLights'
import { videoEditClipValue } from '@/core/videoEdit/keyframes'
import { VideoEditPropertyRow } from './VideoEditPropertyRow'
import type { useVideoEditClipPropertyGesture } from './useVideoEditClipPropertyGesture'

type Gesture = ReturnType<typeof useVideoEditClipPropertyGesture>

const MATERIALS: ReadonlyArray<{ value: SpaceMaterial['preset']; label: string }> = [
  { value: 'picture', label: '画面' }, { value: 'matte', label: '磨砂' }, { value: 'metal', label: '金属' },
  { value: 'thin-film', label: '薄膜金属' }, { value: 'acrylic', label: '亚克力' }, { value: 'glass', label: '实心玻璃' },
]
const LIGHT_KINDS: ReadonlyArray<{ value: SpaceLightKind; label: string }> = [
  { value: 'spot', label: '聚光' }, { value: 'directional', label: '平行光' }, { value: 'point', label: '点光' }, { value: 'area', label: '面光' },
]

/** 数值行：拖动期间实时预览、松手一步撤销（与运动、不透明度同一套手势）；缺省值时重置按钮不可用。 */
function NumberRow({ label, tooltip, value, fallback, min, max, step, precision, onChange, gesture }: {
  label: string; tooltip: string; value: number; fallback: number; min: number; max: number; step: number; precision: number
  onChange: (value: number) => void; gesture: Gesture
}): React.ReactElement {
  return <VideoEditPropertyRow label={label} tooltip={tooltip} reset={{ label: `重置${label}`, disabled: value === fallback, onReset: () => onChange(fallback) }}>
    <NumberInput ariaLabel={label} increaseLabel={`增加${label}`} decreaseLabel={`减少${label}`} size="sm" value={value} min={min} max={max} step={step} precision={precision}
      onScrubStart={gesture.begin} onScrubEnd={cancelled => { if (cancelled) gesture.cancel(); else gesture.finish() }}
      onChange={next => { if (gesture.active() || next !== value) onChange(next) }} />
  </VideoEditPropertyRow>
}

/**
 * 片段在三维里的表现（受光、材质、厚度、阴影、发光）与灯光片段的灯：只在开了空间的画面片段与灯光片段上出现。
 * 与助手的 video_edit.clip.space_* / light_* 属性是同一组字段。
 */
export function VideoEditClipSpaceSection({ clip, playhead, gesture }: { clip: VideoEditClip; playhead: number; gesture: Gesture }): React.ReactElement | null {
  const commit = (patch: Partial<VideoEditClip>): void => gesture.commit(patch)
  // 位置在画面里的远近与朝向（同助手的 depth / rotation_x / rotation_y，有关键帧时改播放头处那一帧）。
  const placement = (light: boolean): React.ReactElement => <>
    <NumberRow label="深度" tooltip={light ? '灯离画面的远近：正数朝镜头、负数往画面里。' : '靠近或远离画面平面：正数朝镜头、负数往画面里。'} value={videoEditClipValue(clip, 'depth', playhead) ?? 0} fallback={light ? 1.2 : 0}
      min={-20} max={20} step={.05} precision={2} onChange={value => commit({ depth: value })} gesture={gesture} />
    <NumberRow label="上下倾斜" tooltip={light ? '灯向上或向下照。' : '绕水平轴倾斜（度）。'} value={videoEditClipValue(clip, 'rotationX', playhead) ?? 0} fallback={light ? -35 : 0}
      min={-360} max={360} step={1} precision={0} onChange={value => commit({ rotationX: value })} gesture={gesture} />
    <NumberRow label="左右转向" tooltip={light ? '灯向左或向右照。' : '绕竖直轴转向（度）。'} value={videoEditClipValue(clip, 'rotationY', playhead) ?? 0} fallback={light ? -20 : 0}
      min={-360} max={360} step={1} precision={0} onChange={value => commit({ rotationY: value })} gesture={gesture} />
  </>
  if (clip.kind === 'light') {
    const kind = clip.lightKind ?? SPATIAL_LIGHT_DEFAULTS.kind
    return <EffectSection id="space-light" title="灯光" info="照亮整条序列里受光的三维内容；位置是片段的位置与深度，朝向是空间倾斜（缺省朝画面里）。">
      <VideoEditPropertyRow label="种类" tooltip="平行光像阳光、只看朝向；聚光从片段位置照出光锥；点光向四周发光；面光柔和、不投影。">
        <Dropdown ariaLabel="灯光种类" size="sm" value={kind} options={LIGHT_KINDS.map(option => ({ ...option }))} onSelect={value => commit({ lightKind: value })} />
      </VideoEditPropertyRow>
      <VideoEditPropertyRow label="颜色" tooltip="灯光的颜色。">
        <UiColorInput aria-label="灯光颜色" value={clip.lightColor ?? SPATIAL_LIGHT_DEFAULTS.color}
          onChange={event => { gesture.begin(); commit({ lightColor: event.target.value }) }} onBlur={() => gesture.finish()} />
      </VideoEditPropertyRow>
      <NumberRow label="亮度" tooltip="1 是一盏常用的主光；有关键帧时改的是播放头处那一帧。" value={videoEditClipValue(clip, 'lightIntensity', playhead) ?? SPATIAL_LIGHT_DEFAULTS.intensity} fallback={SPATIAL_LIGHT_DEFAULTS.intensity}
        min={0} max={SPACE_LIGHT_INTENSITY_MAX} step={.05} precision={2} onChange={value => commit({ lightIntensity: value })} gesture={gesture} />
      {kind === 'spot' && <NumberRow label="张角" tooltip="聚光光锥的张角（度）。" value={clip.lightAngle ?? SPATIAL_LIGHT_DEFAULTS.angle} fallback={SPATIAL_LIGHT_DEFAULTS.angle}
        min={1} max={170} step={1} precision={0} onChange={value => commit({ lightAngle: value })} gesture={gesture} />}
      {kind !== 'area' && <VideoEditPropertyRow label="投影" tooltip="受光物体与打开“投下阴影”的片段在身后投下阴影。">
        <UiSwitch aria-label="灯光投影" checked={clip.lightCastShadow === true} onCheckedChange={checked => commit({ lightCastShadow: checked || undefined })} />
      </VideoEditPropertyRow>}
      <NumberRow label="软硬" tooltip="阴影与聚光边缘的软硬，越大越柔。" value={clip.lightSoftness ?? SPATIAL_LIGHT_DEFAULTS.softness} fallback={SPATIAL_LIGHT_DEFAULTS.softness}
        min={0} max={1} step={.05} precision={2} onChange={value => commit({ lightSoftness: value })} gesture={gesture} />
      {placement(true)}
    </EffectSection>
  }
  if (clip.spatial?.enabled !== true || clip.kind === 'audio' || clip.kind === 'adjustment') return null
  const material = clip.spaceMaterial ?? { preset: 'picture' as const }
  const thickness = videoEditClipValue(clip, 'spaceThickness', playhead) ?? 0
  return <EffectSection id="space" title="三维" info="片段在三维里的表现：受光、材质、厚度、阴影与发光。">
    <NumberRow label="发光" tooltip="画面自身发出的光，越大光晕越强、越能照亮周围；有关键帧时改的是播放头处那一帧。" value={videoEditClipValue(clip, 'spaceEmission', playhead) ?? 0} fallback={0}
      min={0} max={SPACE_EMISSION_MAX} step={.05} precision={2} onChange={value => commit({ spaceEmission: value || (clip.curves?.spaceEmission?.length ? 0 : undefined) })} gesture={gesture} />
    <VideoEditPropertyRow label="材质" tooltip="画面：保持原样；磨砂、金属、薄膜金属以画面为底色并受光；亚克力、实心玻璃按片段轮廓成形、透出身后的画面。">
      <Dropdown ariaLabel="三维材质" size="sm" value={material.preset} options={MATERIALS.map(option => ({ ...option }))}
        onSelect={value => commit({ spaceMaterial: value === 'picture' ? undefined : { preset: value } as SpaceMaterial })} />
    </VideoEditPropertyRow>
    {material.preset === 'picture' && <VideoEditPropertyRow label="受光" tooltip="被灯光与环境光照亮（画面作底色）。关闭时保持原来的平面画面。">
      <UiSwitch aria-label="受光" checked={clip.spaceLit === true} onCheckedChange={checked => commit({ spaceLit: checked || undefined })} />
    </VideoEditPropertyRow>}
    <NumberRow label="厚度" tooltip="沿片段轮廓向后长出的厚度，1 为一个画面高度；文字常用 0.02–0.06。有关键帧时改的是播放头处那一帧。" value={thickness} fallback={0}
      min={0} max={SPACE_THICKNESS_MAX} step={.005} precision={3} onChange={value => commit({ spaceThickness: value || (clip.curves?.spaceThickness?.length ? 0 : undefined) })} gesture={gesture} />
    {thickness > 0 && <NumberRow label="倒角" tooltip="厚度边缘倒圆（厚度的比例），按最细笔画自动限幅。" value={clip.spaceBevel ?? 0} fallback={0}
      min={0} max={.5} step={.05} precision={2} onChange={value => commit({ spaceBevel: value || undefined })} gesture={gesture} />}
    <VideoEditPropertyRow label="投下阴影" tooltip="被会投影的灯光照到时，在身后的物体上投下阴影。">
      <UiSwitch aria-label="投下阴影" checked={clip.spaceCastShadow === true} onCheckedChange={checked => commit({ spaceCastShadow: checked || undefined })} />
    </VideoEditPropertyRow>
    {(clip.spaceLit === true || material.preset !== 'picture') && <VideoEditPropertyRow label="接收阴影" tooltip="别的物体的阴影落在它上面。">
      <UiSwitch aria-label="接收阴影" checked={clip.spaceReceiveShadow === true} onCheckedChange={checked => commit({ spaceReceiveShadow: checked || undefined })} />
    </VideoEditPropertyRow>}
    {placement(false)}
  </EffectSection>
}
