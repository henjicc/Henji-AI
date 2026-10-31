import type { ReactNode } from 'react'
import { RotateCcw } from 'lucide-react'
import { Dropdown, UiFormRow, UiGroup, UiIconButton, UiSegmented, UiSwitch } from '@/components/ui'
import NumberInput from '@/components/ui/NumberInput'
import { videoEditExportEncodingSchema, videoEditExportLevels, type VideoEditExportCapabilities, type VideoEditExportEncoding } from '@/core/videoEdit/exportEncoding'
import { NVENC_PRESETS, SOFTWARE_PRESETS, adjustVideoEditExportEncoding, nvencOf } from './videoEditExportUi'

type Encoding = VideoEditExportEncoding
type Field = keyof Encoding

interface Props {
  encoding: Encoding
  codec: 'avc' | 'hevc'
  /** 目标码率在设置顶层，按码率压制与直接编码共用这一个值。 */
  bitrateMbps: number
  capabilities?: VideoEditExportCapabilities
  /** 所选预设经序列解析与设备适配后的编码设置；没有时不提供逐项恢复。 */
  baseline?: Encoding
  changed: readonly Field[]
  busy: boolean
  onChange: (encoding: Encoding) => void
  onBitrateChange: (bitrateMbps: number) => void
}

export function VideoEditExportEncodingFields({ encoding: e, codec, bitrateMbps, capabilities, baseline, changed, busy, onChange, onBitrateChange }: Props): React.ReactElement {
  const nvenc = nvencOf(e.encoder)
  const set = <K extends Field>(field: K, value: Encoding[K]): void => onChange(adjustVideoEditExportEncoding(e, { ...e, [field]: value }, codec))
  const encoderCapability = capabilities?.encoders[e.encoder]
  const codecEncoders = codec === 'avc' ? ['h264_nvenc', 'libx264'] as const : ['hevc_nvenc', 'libx265'] as const
  // 逐项恢复走与手动修改同一套连带调整；结果仍不合法（如软件编码器配硬件速度档、编码器与视频格式不符）就不提供这一项的恢复。
  const restored = (field: Field): Encoding | undefined => {
    if (!baseline || !changed.includes(field)) return undefined
    const candidate = adjustVideoEditExportEncoding(e, { ...e, [field]: baseline[field] }, codec)
    const usable = (codecEncoders as readonly string[]).includes(candidate.encoder) && capabilities?.encoders[candidate.encoder].supported !== false
    return usable && videoEditExportEncodingSchema.safeParse(candidate).success ? candidate : undefined
  }
  const row = (field: Field, label: string, info: string, control: ReactNode, unavailable?: string): ReactNode => {
    const restore = restored(field)
    return <UiFormRow key={field} label={label} info={unavailable ? `${unavailable} ${info}` : info} density="compact"
      trailing={restore ? <UiIconButton size="xs" aria-label={`恢复${label}为预设值`} tooltip="恢复为预设值" disabled={busy} onClick={() => onChange(restore)}><RotateCcw /></UiIconButton> : null}>{control}</UiFormRow>
  }
  const select = <T extends string>(label: string, value: T, options: { value: T; label: string; disabled?: boolean; tooltip?: string }[], onSelect: (value: T) => void): ReactNode => <Dropdown<T> ariaLabel={label} size="sm" className="w-full" value={value} options={options} onSelect={onSelect} disabled={busy} minWidthStrategy="none" />
  const number = (label: string, value: number, onValue: (value: number) => void, options: { min: number; max: number; step?: number; precision?: number; unit?: string; disabled?: boolean }): ReactNode => <div className="flex min-w-0 items-center gap-1">
    <NumberInput size="sm" ariaLabel={label} value={value} min={options.min} max={options.max} step={options.step ?? 1} precision={options.precision ?? 0} disabled={busy || options.disabled} widthClassName="min-w-0 flex-1" onChange={onValue} />
    {options.unit && <span className="shrink-0 text-xs text-text2">{options.unit}</span>}
  </div>
  const encoders = codecEncoders.map(value => {
    const capability = capabilities?.encoders[value]
    const reason = !capability ? undefined : !capability.supported ? capability.reason ?? '此设备无法使用该编码器。' : e.tenBit && !capability.tenBit ? '此设备上这个编码器不支持 10 位输出；请先关闭 10 位输出。' : undefined
    return { value, label: nvencOf(value) ? 'NVIDIA 硬件' : value === 'libx264' ? '软件 x264' : '软件 x265', disabled: Boolean(reason), tooltip: reason }
  })
  const presets = nvenc
    ? NVENC_PRESETS.map(value => ({ value, label: value === 'p1' ? 'P1 · 最快' : value === 'p7' ? 'P7 · 最精细' : value.toUpperCase() }))
    : SOFTWARE_PRESETS.map(value => ({ value, label: value === 'ultrafast' ? `${value} · 最快` : value === 'placebo' ? `${value} · 最慢` : value }))
  const profiles = (codec === 'hevc' ? ['auto', 'main', 'main10'] as const : ['auto', 'baseline', 'main', 'high', 'high10'] as const).map(value => {
    const tenBitOnly = value === 'high10' || value === 'main10'
    const mismatch = value !== 'auto' && tenBitOnly !== e.tenBit
    return { value, label: value === 'auto' ? '自动' : value === 'high10' ? 'High 10' : value === 'main10' ? 'Main 10' : value[0].toUpperCase() + value.slice(1), disabled: mismatch, tooltip: mismatch ? e.tenBit ? '10 位输出需要 10 位规格。' : '只有开启 10 位输出时才能用 10 位规格。' : undefined }
  })
  const levels = (videoEditExportLevels(codec) as readonly Encoding['level'][]).map(value => ({ value, label: value === 'auto' ? '自动' : value }))
  const quality = e.rateControl === 'quality'
  return <>
    <UiGroup title="编码" titleTone="compact">
      {row('encoder', '编码器', '硬件编码速度快；软件编码慢一些，同样画质下文件通常更小。', select('编码器', e.encoder, encoders, value => set('encoder', value)))}
      {row('preset', '速度', '越慢压得越精细，同样画质下文件更小。', select('编码速度', e.preset, presets, value => set('preset', value)))}
      {row('profile', '规格', '决定哪些播放设备能解码；不确定时选自动。', select('编码规格', e.profile, profiles, value => set('profile', value)))}
      {row('level', '级别', '限制分辨率与码率上限，兼容较旧的播放设备；不确定时选自动。', select('编码级别', e.level, levels, value => set('level', value)))}
    </UiGroup>
    <UiGroup title="码率控制" titleTone="compact">
      {row('rateControl', '方式', '按画质：画面越复杂文件越大，画质稳定；按码率：文件大小可预估。两遍分析更慢，码率分配更均匀。', select('码率控制方式', e.rateControl, [
        { value: 'quality', label: '按画质' }, { value: 'vbr', label: 'VBR 可变码率' }, { value: 'cbr', label: 'CBR 恒定码率' }, { value: 'two_pass', label: '两遍分析' },
      ], value => set('rateControl', value)))}
      {quality && row('quality', '画质数值', `越小越清晰、文件越大。${nvenc ? '硬件编码 28' : '软件编码 20'} 左右已接近视觉无损。`, number('画质数值', e.quality, value => set('quality', value), { min: nvenc ? 1 : 0, max: 51 }))}
      {!quality && <UiFormRow key="bitrate" label="目标码率" info="平均每秒写入的数据量，决定文件大小。" density="compact" trailing={null}>{number('目标码率 Mbps', bitrateMbps, onBitrateChange, { min: Math.min(.1, bitrateMbps), max: Math.max(200, bitrateMbps), step: 1, precision: 1, unit: 'Mbps' })}</UiFormRow>}
      {e.rateControl !== 'cbr' && row('maxBitrateMbps', '最大码率', '限制画面突然变复杂时的峰值码率；0 表示不限制。', number('最大码率 Mbps', e.maxBitrateMbps, value => set('maxBitrateMbps', value), { min: 0, max: 400, step: 1, precision: 1, unit: 'Mbps' }))}
      {row('bufferMbps', '码率缓冲', '峰值码率能持续多久；0 表示按最大码率的两倍（恒定码率按目标码率），未限制最大码率时由编码器决定。', number('码率缓冲 Mb', e.bufferMbps, value => set('bufferMbps', value), { min: 0, max: 800, step: 1, precision: 1, unit: 'Mb' }))}
    </UiGroup>
    <UiGroup title="关键帧与 B 帧" titleTone="compact">
      {row('keyframeSeconds', '关键帧间隔', '越短，播放器拖动定位越快，文件略大。', number('关键帧间隔秒', e.keyframeSeconds, value => set('keyframeSeconds', value), { min: .1, max: 20, step: .5, precision: 1, unit: '秒' }))}
      {row('bFrames', 'B 帧', '提高压缩率；0 关闭。', number('B 帧数量', e.bFrames, value => set('bFrames', value), { min: 0, max: nvenc ? 4 : 16, disabled: e.profile === 'baseline' }), e.profile === 'baseline' ? 'Baseline 规格不支持 B 帧。' : undefined)}
      {row('lookaheadFrames', '前瞻帧数', '提前分析的帧数，越多码率分配越合理，压制越慢；0 关闭。', number('前瞻帧数', e.lookaheadFrames, value => set('lookaheadFrames', value), { min: 0, max: nvenc ? 32 : 250 }))}
    </UiGroup>
    <UiGroup title="自适应量化" titleTone="compact">
      {row('spatialAq', '空间', '把码率多分给细节丰富的区域。', <UiSwitch aria-label="空间自适应量化" checked={e.spatialAq} disabled={busy} onCheckedChange={value => set('spatialAq', value)} />)}
      {row('temporalAq', '时间', '把码率多分给长时间不变的画面。', <UiSwitch aria-label="时间自适应量化" checked={e.temporalAq} disabled={busy || !nvenc} onCheckedChange={value => set('temporalAq', value)} />, !nvenc ? '只有 NVIDIA 硬件编码支持。' : undefined)}
    </UiGroup>
    <UiGroup title="色彩" titleTone="compact">
      {row('colorRange', '范围', '常规视频用有限范围；完整范围在部分播放器里会偏灰或过亮。', <UiSegmented ariaLabel="色彩范围" size="sm" value={e.colorRange} disabled={busy} options={[{ value: 'limited', label: '有限' }, { value: 'full', label: '完整' }]} onChange={value => set('colorRange', value)} />)}
      {row('colorMatrix', '矩阵', '高清与 4K 视频用 BT.709。', <UiSegmented ariaLabel="色彩矩阵" size="sm" value={e.colorMatrix} disabled={busy} options={[{ value: 'bt709', label: 'BT.709' }, { value: 'bt2020nc', label: 'BT.2020' }, { value: 'smpte170m', label: 'BT.601' }]} onChange={value => set('colorMatrix', value)} />)}
      {row('tenBit', '10 位输出', '渐变更平滑；不会增加画面本身没有的色彩，部分设备无法播放。', <UiSwitch aria-label="10 位输出" checked={e.tenBit} disabled={busy || encoderCapability?.tenBit === false && !e.tenBit} onCheckedChange={value => set('tenBit', value)} />, encoderCapability?.tenBit === false ? '此设备的所选编码器不支持 10 位输出。' : undefined)}
    </UiGroup>
  </>
}
