import { z } from 'zod'
import type { AudioEffectInstance } from './effects/audioEffectChain'

/**
 * 基本声音（参照 Audition 的“基本声音”面板）：按声音类型给出几组“一个开关 + 一个量”的常用处理，
 * 背后换算成内置效果链（`essentialSoundEffects`），音频编辑与剪辑片段共用这一份换算，预览与导出都按它处理。
 * - 修复：减少杂色（RNNoise）、降低隆隆声（高通）、消除嗡嗡声（50/60 Hz 陷波）、消除齿音；
 *   减少混响与人声分离用本地模型离线算好（音频编辑的“编辑后声音”里预先处理），不在实时链里。
 * - 透明度：动态（压缩）、均衡预设、增强语音（低沉 / 高亮嗓音）。
 * - 创意：混响。响度：自动匹配到目标响度（测量后记下增益），末尾加限幅防削波。剪辑音量：整体增益。
 * 量统一 0–100；关着或量为 0 的项不进效果链（不改变声音）。
 */

const amount = z.number().finite().min(0).max(100)
const toggle = z.object({ enabled: z.boolean(), amount }).strict()

export const ESSENTIAL_SOUND_TYPES = ['dialogue', 'music', 'sound_effect', 'ambience'] as const
export const ESSENTIAL_SOUND_EQ_PRESETS = ['podcast', 'broadcast', 'warm', 'bright', 'thin_voice', 'telephone'] as const
export const ESSENTIAL_SOUND_REVERB_PRESETS = ['room', 'studio', 'hall', 'outdoor'] as const

export const essentialSoundSettingsSchema = z.object({
  type: z.enum(ESSENTIAL_SOUND_TYPES),
  repair: z.object({
    noise: toggle, rumble: toggle, hum: toggle.extend({ mains: z.union([z.literal(50), z.literal(60)]) }).strict(), deEss: toggle,
    /** 本地模型离线处理（音频编辑里预先处理成“编辑后声音”）；剪辑片段上不可用。 */
    reverb: toggle, isolate: toggle,
  }).partial().strict().optional(),
  clarity: z.object({
    dynamics: toggle,
    eq: toggle.extend({ preset: z.enum(ESSENTIAL_SOUND_EQ_PRESETS) }).strict(),
    enhance: z.object({ enabled: z.boolean(), voice: z.enum(['low', 'high']) }).strict(),
  }).partial().strict().optional(),
  creative: z.object({ reverb: toggle.extend({ preset: z.enum(ESSENTIAL_SOUND_REVERB_PRESETS) }).strict() }).partial().strict().optional(),
  /** 自动匹配响度：targetLufs 目标，gainDb 是按测量结果算出的补偿增益（点“自动匹配”时测量并记下）。 */
  loudness: z.object({ enabled: z.boolean(), targetLufs: z.number().finite().min(-40).max(-5), gainDb: z.number().finite().min(-40).max(40) }).strict().optional(),
  volume: z.object({ gainDb: z.number().finite().min(-24).max(24) }).strict().optional(),
}).strict()
export type EssentialSoundSettings = z.infer<typeof essentialSoundSettingsSchema>
export type EssentialSoundType = EssentialSoundSettings['type']
export type EssentialSoundEqPreset = typeof ESSENTIAL_SOUND_EQ_PRESETS[number]
export type EssentialSoundReverbPreset = typeof ESSENTIAL_SOUND_REVERB_PRESETS[number]

/** 新设为“对话”时的起点：常用的几项打开、量适中，其余关着。 */
export function defaultEssentialSound(type: EssentialSoundType): EssentialSoundSettings {
  if (type !== 'dialogue') return { type, loudness: { enabled: false, targetLufs: type === 'music' ? -16 : -20, gainDb: 0 } }
  return {
    type,
    repair: { noise: { enabled: false, amount: 50 }, rumble: { enabled: true, amount: 30 }, hum: { enabled: false, amount: 60, mains: 50 }, deEss: { enabled: false, amount: 40 }, reverb: { enabled: false, amount: 50 }, isolate: { enabled: false, amount: 100 } },
    clarity: { dynamics: { enabled: false, amount: 40 }, eq: { enabled: false, amount: 50, preset: 'podcast' }, enhance: { enabled: false, voice: 'low' } },
    creative: { reverb: { enabled: false, amount: 20, preset: 'room' } },
    loudness: { enabled: false, targetLufs: -16, gainDb: 0 },
  }
}

type Params = Record<string, number | string | boolean>
const effect = (key: string, id: string, params: Params, strength = 1): AudioEffectInstance => ({ id: `essential:${key}`, builtin: { id, params }, amount: strength })
const scale = (value: number): number => value / 100

/** 均衡预设（参数均衡器的增益在 amount=100 时的值，按量线性缩放）。 */
const EQ_PRESETS: Record<EssentialSoundEqPreset, Params> = {
  podcast: { hp_on: true, hp_frequency: 80, low_gain: -1, low_frequency: 120, band1_gain: -3, band1_frequency: 300, band2_gain: 2, band2_frequency: 2500, band3_gain: 3, band3_frequency: 5000, high_gain: 2, high_frequency: 10000 },
  broadcast: { hp_on: true, hp_frequency: 70, low_gain: 3, low_frequency: 120, band1_gain: -4, band1_frequency: 350, band2_gain: 3, band2_frequency: 3000, band3_gain: 2, band3_frequency: 6000, high_gain: 3, high_frequency: 12000 },
  warm: { low_gain: 3, low_frequency: 200, band1_gain: -1, band1_frequency: 2500, high_gain: -2, high_frequency: 8000 },
  bright: { band1_gain: -2, band1_frequency: 300, band3_gain: 2, band3_frequency: 5000, high_gain: 4, high_frequency: 7000 },
  thin_voice: { low_gain: 4, low_frequency: 150, band1_gain: 2, band1_frequency: 250, band3_gain: -1, band3_frequency: 4000 },
  telephone: { hp_on: true, hp_frequency: 400, lp_on: true, lp_frequency: 3400, band2_gain: 6, band2_frequency: 1500 },
}
const GAIN_KEYS = ['low_gain', 'band1_gain', 'band2_gain', 'band3_gain', 'high_gain']
function eqParams(preset: EssentialSoundEqPreset, strength: number): Params {
  const params = { ...EQ_PRESETS[preset] }
  for (const key of GAIN_KEYS) if (typeof params[key] === 'number') params[key] = Math.round((params[key] as number) * strength * 2) / 2
  // 电话效果的高低通是效果本身，量只控制中频突出程度；量很小时不再截频。
  if (preset === 'telephone' && strength < 0.2) { params.hp_on = false; params.lp_on = false }
  return params
}
const REVERB_PRESETS: Record<EssentialSoundReverbPreset, { room_size: number; damping: number }> = {
  room: { room_size: 35, damping: 55 }, studio: { room_size: 20, damping: 70 }, hall: { room_size: 80, damping: 35 }, outdoor: { room_size: 60, damping: 85 },
}

/** 这项开着且量大于 0。 */
const on = (item: { enabled: boolean; amount: number } | undefined): item is { enabled: true; amount: number } => !!item?.enabled && item.amount > 0

/**
 * 基本声音换算成的实时效果链（按处理顺序）：先修复（去低频、嗡嗡声、杂色、齿音），再透明度（压缩、均衡、增强），
 * 再创意混响，最后响度补偿与剪辑音量，开了自动匹配响度时末尾限幅到 -1 dB。
 * 减少混响、人声分离不在这里（离线预处理，见 `essentialSoundOfflineStages`）。
 */
export function essentialSoundEffects(settings: EssentialSoundSettings | undefined): AudioEffectInstance[] {
  if (!settings) return []
  const effects: AudioEffectInstance[] = []
  const repair = settings.repair, clarity = settings.clarity
  if (on(repair?.rumble)) effects.push(effect('rumble', 'high_pass', { frequency: Math.round(40 + 1.2 * repair.rumble.amount), slope: repair.rumble.amount > 50 ? 'steep' : 'gentle' }))
  if (on(repair?.hum)) effects.push(effect('hum', 'dehum', { mains: String(repair.hum.mains), harmonics: 5, amount: repair.hum.amount }))
  if (on(repair?.noise)) effects.push(effect('noise', 'noise_reduction', { strength: repair.noise.amount }))
  if (on(repair?.deEss)) effects.push(effect('de_ess', 'de_esser', { amount: repair.deEss.amount, frequency: 6000 }))
  if (on(clarity?.dynamics)) effects.push(effect('dynamics', 'compressor', { amount: Math.round(clarity.dynamics.amount * 0.8), speed: 'normal', makeup: true }))
  if (on(clarity?.eq)) effects.push(effect('eq', 'eq_bands', eqParams(clarity.eq.preset, scale(clarity.eq.amount))))
  if (clarity?.enhance?.enabled) effects.push(effect('enhance', 'vocal_enhancer', { voice: clarity.enhance.voice, amount: 60 }))
  const reverb = settings.creative?.reverb
  if (on(reverb)) effects.push(effect('reverb', 'reverb', { ...REVERB_PRESETS[reverb.preset], mix: Math.round(reverb.amount * 0.5) }))
  const gain = (settings.loudness?.enabled ? settings.loudness.gainDb : 0) + (settings.volume?.gainDb ?? 0)
  if (Math.abs(gain) >= 0.05) effects.push(effect('gain', 'gain_balance', { gain: Math.max(-24, Math.min(24, Math.round(gain * 10) / 10)), balance: 0, mono: false }))
  if (settings.loudness?.enabled) effects.push(effect('limiter', 'limiter', { ceiling: -1, boost: 0 }))
  return effects
}

/** 需要离线预处理的项（本地模型）：减少混响、人声分离；量为混入处理结果的比例 0–1。 */
export function essentialSoundOfflineStages(settings: EssentialSoundSettings | undefined): Array<{ kind: 'dereverb' | 'isolate'; amount: number }> {
  const repair = settings?.repair
  return [
    ...(on(repair?.isolate) ? [{ kind: 'isolate' as const, amount: scale(repair.isolate.amount) }] : []),
    ...(on(repair?.reverb) ? [{ kind: 'dereverb' as const, amount: scale(repair.reverb.amount) }] : []),
  ]
}
