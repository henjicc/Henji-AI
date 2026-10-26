import { useRef } from 'react'
import { Dropdown, UiButton, UiFieldLayoutContext, UiFormRow, UiGroup, UiSegmented, UiSwitch, UI_TEXT_META_CLASS } from '@/components/ui'
import { ParamField, type ParamGesture } from '@/components/ui/params/ParamField'
import type { ParamFieldSpec } from '@/components/ui/params/fieldSpec'
import NumberInput from '@/components/ui/NumberInput'
import {
  defaultEssentialSound, ESSENTIAL_SOUND_EQ_PRESETS, ESSENTIAL_SOUND_REVERB_PRESETS,
  type EssentialSoundEqPreset, type EssentialSoundReverbPreset, type EssentialSoundSettings, type EssentialSoundType,
} from '@/core/audio/essentialSound'

/**
 * 基本声音面板的内容（参照 Audition 的“基本声音”）：先选声音类型，再按“响度 / 修复 / 透明度 / 创意 / 剪辑音量”几组，
 * 每项一个开关加一个量。只负责显示与手势，写入交给宿主（音频编辑写作品、剪辑写片段）。
 * offline：宿主能离线跑本地模型时才显示“减少混响”“人声分离”。
 */
export interface EssentialSoundControlsProps {
  value: EssentialSoundSettings | undefined
  onChange: (next: EssentialSoundSettings | undefined) => void
  /** 连续拖动开始：返回结束 / 取消（合成一步撤销）。 */
  gesture: () => { finish: () => void; cancel: () => void }
  offline?: boolean
  disabled?: boolean
  /** 自动匹配响度：宿主测量后写回增益。 */
  onMatchLoudness?: (targetLufs: number) => void
  matching?: boolean
  /** 上次测得的积分响度（显示用）。 */
  measuredLufs?: number
}

const TYPES: Array<{ value: EssentialSoundType; label: string }> = [{ value: 'dialogue', label: '对话' }, { value: 'music', label: '音乐' }, { value: 'sound_effect', label: '音效' }, { value: 'ambience', label: '环境' }]
const EQ_LABELS: Record<EssentialSoundEqPreset, string> = { podcast: '播客语音', broadcast: '广播', warm: '温暖', bright: '明亮', thin_voice: '加厚单薄的嗓音', telephone: '电话' }
const REVERB_LABELS: Record<EssentialSoundReverbPreset, string> = { room: '房间', studio: '录音棚', hall: '大厅', outdoor: '户外' }
const TARGETS = [{ value: -14, label: '-14 LUFS · 短视频平台' }, { value: -16, label: '-16 LUFS · 播客' }, { value: -23, label: '-23 LUFS · 广播电视' }]

type Toggle = { enabled: boolean; amount: number }
const AMOUNT: Omit<ParamFieldSpec, 'key' | 'title' | 'bindingKeys'> = { source: 'builtin', type: 'number', min: 0, max: 100, step: 1, control: 'slider', default: 50, animatable: false } as Omit<ParamFieldSpec, 'key' | 'title' | 'bindingKeys'>

export function EssentialSoundControls({ value, onChange, gesture, offline = false, disabled = false, onMatchLoudness, matching = false, measuredLufs }: EssentialSoundControlsProps): React.ReactElement {
  const active = useRef<{ finish: () => void; cancel: () => void } | null>(null)
  const latest = useRef(value); latest.current = value
  const begin = (): void => { if (!active.current) active.current = gesture() }
  const finish = (): void => { active.current?.finish(); active.current = null }
  const cancel = (): void => { active.current?.cancel(); active.current = null }
  const patch = (update: (current: EssentialSoundSettings) => EssentialSoundSettings): void => { const current = latest.current; if (current) onChange(update(current)) }
  const gestureFor = (write: (value: number) => void): ParamGesture => ({ begin, finish, cancel, active: () => !!active.current, write: next => write(Number(next)), atomic: next => { begin(); write(Number(next)); finish() } })

  /** 一项“开关 + 量”：开关在名称前，量的滑杆与读数在右，关着时滑杆变暗不可拖。 */
  const toggleRow = (key: string, label: string, info: string, item: Toggle | undefined, set: (next: Toggle) => void, extra?: React.ReactNode): React.ReactElement => {
    const current = item ?? { enabled: false, amount: 50 }
    return <div key={key} className="flex flex-col">
      <UiFormRow label={label} info={info} density="compact" leading={<UiSwitch aria-label={label} checked={current.enabled} disabled={disabled} onCheckedChange={enabled => set({ ...current, enabled })} />}>
        <div className={current.enabled ? '' : 'pointer-events-none opacity-40'} aria-disabled={!current.enabled}>
          <ParamField field={{ ...AMOUNT, key, title: label, bindingKeys: [key] } as ParamFieldSpec} value={current.amount} disabled={disabled || !current.enabled} gesture={gestureFor(amount => set({ ...current, amount }))} />
        </div>
      </UiFormRow>
      {extra && current.enabled && <div className="pb-1 pl-7">{extra}</div>}
    </div>
  }

  if (!value) return <UiGroup titleTone="compact" title="这段声音是什么类型？" description="选好类型后，按常用的处理一项项打开即可。">
    <UiFormRow label="声音类型" density="compact"><UiSegmented ariaLabel="声音类型" size="sm" fullWidth disabled={disabled} value={'' as EssentialSoundType} options={TYPES} onChange={type => onChange(defaultEssentialSound(type))} /></UiFormRow>
  </UiGroup>

  const repair = value.repair ?? {}, clarity = value.clarity ?? {}
  const loudness = value.loudness ?? { enabled: false, targetLufs: -16, gainDb: 0 }
  const dialogue = value.type === 'dialogue'
  return <UiFieldLayoutContext.Provider value="property">
    <div className="flex flex-col" data-essential-sound={value.type}>
      <UiGroup titleTone="compact" labelWidth={96}>
        <UiFormRow label="声音类型" density="compact"><UiSegmented ariaLabel="声音类型" size="sm" fullWidth disabled={disabled} value={value.type} options={TYPES} onChange={type => onChange(type === value.type ? value : { ...defaultEssentialSound(type), volume: value.volume })} /></UiFormRow>
        <div className="flex justify-end"><UiButton size="sm" variant="link" disabled={disabled} onClick={() => onChange(undefined)}>清除声音类型</UiButton></div>
      </UiGroup>

      <UiGroup divided titleTone="compact" title="响度" labelWidth={96}>
        <UiFormRow label="自动匹配" info="测量处理后的整条声音，把平均响度补偿到目标值；末尾自动限幅，峰值不超过 -1 dB。" density="compact"
          leading={<UiSwitch aria-label="自动匹配响度" checked={loudness.enabled} disabled={disabled} onCheckedChange={enabled => patch(current => ({ ...current, loudness: { ...loudness, enabled } }))} />}>
          <Dropdown<number> ariaLabel="目标响度" size="sm" className="w-full" minWidthStrategy="none" disabled={disabled} value={loudness.targetLufs} display={`${loudness.targetLufs} LUFS`} options={TARGETS} onSelect={targetLufs => patch(current => ({ ...current, loudness: { ...loudness, targetLufs } }))} />
        </UiFormRow>
        {loudness.enabled && <div className="flex items-center justify-between gap-2 pl-7">
          <span className={UI_TEXT_META_CLASS}>{measuredLufs !== undefined ? `测得 ${measuredLufs} LUFS，补偿 ${loudness.gainDb > 0 ? '+' : ''}${loudness.gainDb} dB` : loudness.gainDb ? `补偿 ${loudness.gainDb > 0 ? '+' : ''}${loudness.gainDb} dB` : '还没测量'}</span>
          <UiButton size="sm" variant="secondary" disabled={disabled || matching || !onMatchLoudness} onClick={() => onMatchLoudness?.(loudness.targetLufs)}>{matching ? '正在测量…' : '测量并匹配'}</UiButton>
        </div>}
      </UiGroup>

      {dialogue && <UiGroup divided titleTone="compact" title="修复" labelWidth={96}>
        {toggleRow('noise', '减少杂色', '去掉风扇、空调、电流等背景噪声（RNNoise 神经网络降噪），量越大越干净，太大人声会变薄。', repair.noise, noise => patch(current => ({ ...current, repair: { ...current.repair, noise } })))}
        {toggleRow('rumble', '降低隆隆声', '切掉人声以下的低频：桌面震动、脚步、喷麦和空调低频，量越大切得越高。', repair.rumble, rumble => patch(current => ({ ...current, repair: { ...current.repair, rumble } })))}
        {toggleRow('hum', '消除嗡嗡声', '滤掉电源干扰的嗡嗡声及其倍频（国内电网 50 Hz）。', repair.hum, hum => patch(current => ({ ...current, repair: { ...current.repair, hum: { mains: current.repair?.hum?.mains ?? 50, ...hum } } })),
          <UiSegmented ariaLabel="电源频率" size="sm" disabled={disabled} value={String(repair.hum?.mains ?? 50)} options={[{ value: '50', label: '50 Hz' }, { value: '60', label: '60 Hz' }]} onChange={mains => patch(current => ({ ...current, repair: { ...current.repair, hum: { enabled: true, amount: current.repair?.hum?.amount ?? 60, mains: Number(mains) as 50 | 60 } } }))} />)}
        {toggleRow('de_ess', '消除齿音', '压低“嘶”“次”这类刺耳的齿音，其余时候不影响音色。', repair.deEss, deEss => patch(current => ({ ...current, repair: { ...current.repair, deEss } })))}
        {offline && toggleRow('reverb', '减少混响', '去掉房间回声，让声音更干、更靠前。用本地模型离线处理（第一次使用下载约 67 MB），开着时编辑后的声音会重新生成。', repair.reverb, reverb => patch(current => ({ ...current, repair: { ...current.repair, reverb } })))}
        {offline && toggleRow('isolate', '人声分离', '只保留人声，去掉背景音乐和环境声。用本地模型离线处理（第一次使用下载约 67 MB）。', repair.isolate, isolate => patch(current => ({ ...current, repair: { ...current.repair, isolate } })))}
      </UiGroup>}

      {dialogue && <UiGroup divided titleTone="compact" title="透明度" labelWidth={96}>
        {toggleRow('dynamics', '动态', '压缩音量起伏：小声抬起来、大声压下去，听着更平稳、更靠前。', clarity.dynamics, dynamics => patch(current => ({ ...current, clarity: { ...current.clarity, dynamics } })))}
        {toggleRow('eq', '均衡', '套用常用的人声均衡曲线，量控制曲线的强度。', clarity.eq, eq => patch(current => ({ ...current, clarity: { ...current.clarity, eq: { preset: current.clarity?.eq?.preset ?? 'podcast', ...eq } } })),
          <Dropdown<EssentialSoundEqPreset> ariaLabel="均衡预设" size="sm" className="w-full" minWidthStrategy="none" disabled={disabled} value={clarity.eq?.preset ?? 'podcast'} display={EQ_LABELS[clarity.eq?.preset ?? 'podcast']} options={ESSENTIAL_SOUND_EQ_PRESETS.map(preset => ({ value: preset, label: EQ_LABELS[preset] }))} onSelect={preset => patch(current => ({ ...current, clarity: { ...current.clarity, eq: { enabled: true, amount: current.clarity?.eq?.amount ?? 50, preset } } }))} />)}
        <UiFormRow label="增强语音" info="提升人声的清晰度与存在感：低沉的嗓音选“低沉”，偏高亮的嗓音选“高亮”。" density="compact" leading={<UiSwitch aria-label="增强语音" checked={!!clarity.enhance?.enabled} disabled={disabled} onCheckedChange={enabled => patch(current => ({ ...current, clarity: { ...current.clarity, enhance: { voice: current.clarity?.enhance?.voice ?? 'low', enabled } } }))} />}>
          <div className={clarity.enhance?.enabled ? '' : 'pointer-events-none opacity-40'}><UiSegmented ariaLabel="嗓音类型" size="sm" fullWidth disabled={disabled || !clarity.enhance?.enabled} value={clarity.enhance?.voice ?? 'low'} options={[{ value: 'low', label: '低沉' }, { value: 'high', label: '高亮' }]} onChange={voice => patch(current => ({ ...current, clarity: { ...current.clarity, enhance: { enabled: true, voice } } }))} /></div>
        </UiFormRow>
      </UiGroup>}

      <UiGroup divided titleTone="compact" title="创意" labelWidth={96}>
        {toggleRow('reverb_creative', '混响', '加一点空间感，量是混响声的多少。', value.creative?.reverb, reverb => patch(current => ({ ...current, creative: { reverb: { preset: current.creative?.reverb?.preset ?? 'room', ...reverb } } })),
          <Dropdown<EssentialSoundReverbPreset> ariaLabel="混响预设" size="sm" className="w-full" minWidthStrategy="none" disabled={disabled} value={value.creative?.reverb?.preset ?? 'room'} display={REVERB_LABELS[value.creative?.reverb?.preset ?? 'room']} options={ESSENTIAL_SOUND_REVERB_PRESETS.map(preset => ({ value: preset, label: REVERB_LABELS[preset] }))} onSelect={preset => patch(current => ({ ...current, creative: { reverb: { enabled: true, amount: current.creative?.reverb?.amount ?? 20, preset } } }))} />)}
      </UiGroup>

      <UiGroup divided titleTone="compact" title="剪辑音量" labelWidth={96}>
        <UiFormRow label="级别（dB）" info="整条声音的音量，在其他处理之后生效。" density="compact">
          <NumberInput ariaLabel="剪辑音量级别" size="sm" min={-24} max={24} step={0.5} precision={1} align="right" disabled={disabled} value={value.volume?.gainDb ?? 0}
            onChange={gainDb => patch(current => ({ ...current, volume: { gainDb } }))} />
        </UiFormRow>
      </UiGroup>
    </div>
  </UiFieldLayoutContext.Provider>
}
