import { z } from 'zod'
import type { AudioEffectInstance } from '../audio/effects/audioEffectChain'
import { essentialSoundEffects, essentialSoundOfflineStages, essentialSoundSettingsSchema, type EssentialSoundSettings } from '../audio/essentialSound'
import { videoEditBuiltinEffectIssue, videoEditBuiltinEffectMedia } from '../videoEdit/builtinEffects'

/*
 * 音频编辑的效果链（效果控件，2026-10-26 用户确认的重构）：一串有顺序的效果，从上到下依次处理录音本身（源时间，
 * 和剪辑里片段的效果控件一样），剪辑区间只决定播放哪些部分。效果从不改变时长；改时长的去重念、压停顿、删语气词、删呼吸
 * 属于剪辑（文字稿里的自动粗剪）。
 *
 * 效果分两类：
 * - 实时效果（内置效果、不含本地模型项的基本声音）：逐样本确定性处理，与剪辑片段的音频效果同一份实现（`src/core/audio/effects`）；
 * - 整段处理的效果（去除口水音、呼吸声、人声分离 / 去混响、第三方插件）：要先对整段录音分析或交给外部处理器，结果按内容缓存。
 *
 * 第一阶段的处理方式：链里最后一个“整段处理”的效果及其之前的全部效果，在主进程按顺序处理录音并逐项缓存（改第 k 个只重算
 * k 往后）；之后剩下的实时效果在试听时边播边算、导出时同一份代码离线处理。最末是固定的“输出”（音量、自动匹配响度、限幅），
 * 作用在剪好的整条声音上。
 *
 * 本文件主进程与渲染层共用，只用相对导入。
 */

export const AUDIO_EDIT_MAX_CHAIN_ITEMS = 32
const frame = z.number().int().nonnegative()
const rangeList = (maxLength: number) => z.array(z.object({ startFrame: frame, endFrame: frame }).strict()
  .refine(range => range.endFrame > range.startFrame && range.endFrame - range.startFrame <= maxLength, '范围无效')).max(20000)
const id = z.string().min(1).max(100)
const name = z.string().trim().min(1).max(200)

const builtinItemSchema = z.object({
  id, kind: z.literal('builtin'), name, enabled: z.boolean(), amount: z.number().finite().min(0).max(1),
  builtin: z.object({ id: z.string().min(1).max(64), params: z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/), z.union([z.number().finite(), z.boolean(), z.string().max(4096)])) }).strict(),
}).strict()
const essentialItemSchema = z.object({ id, kind: z.literal('essential'), enabled: z.boolean(), settings: essentialSoundSettingsSchema }).strict()
/** 去除口水音：analyzed 为是否已按当前位置之前的声音检测过；clicks 为检测出的咔嗒范围（源采样帧，单处不超过 1 秒）。 */
const mouthDeclickItemSchema = z.object({ id, kind: z.literal('mouth_declick'), enabled: z.boolean(), sensitivity: z.number().finite().min(0).max(100), analyzed: z.boolean(), clicks: rangeList(48000) }).strict()
/** 呼吸声：把检测到的全部呼吸统一减弱或静音（不改时长；删掉呼吸属于粗剪）。 */
const breathItemSchema = z.object({ id, kind: z.literal('breath'), enabled: z.boolean(), mode: z.enum(['attenuate', 'mute']), reductionDb: z.number().finite().min(-40).max(0), analyzed: z.boolean(), breaths: rangeList(48000 * 10) }).strict()
/** 人声分离 / 去混响：本地模型处理，按 amount（0–1）与处理前的声音混合。 */
const separationItemSchema = z.object({ id, kind: z.literal('separation'), enabled: z.boolean(), mode: z.enum(['isolate', 'dereverb']), amount: z.number().finite().min(0).max(1) }).strict()
/** 第三方插件：pluginId 为宿主插件目录里的标识；parameters 为插件参数名到 0–1 归一化值。 */
const pluginItemSchema = z.object({ id, kind: z.literal('plugin'), name, enabled: z.boolean(), pluginId: z.string().min(1).max(200), parameters: z.record(z.string(), z.number().min(0).max(1)) }).strict()

export const audioEditChainItemSchema = z.discriminatedUnion('kind', [builtinItemSchema, essentialItemSchema, mouthDeclickItemSchema, breathItemSchema, separationItemSchema, pluginItemSchema])
export const audioEditEffectChainSchema = z.array(audioEditChainItemSchema).max(AUDIO_EDIT_MAX_CHAIN_ITEMS).superRefine((items, ctx) => {
  if (new Set(items.map(item => item.id)).size !== items.length) ctx.addIssue({ code: 'custom', message: '效果引用重复' })
  for (const item of items) {
    if (item.kind !== 'builtin') continue
    if (videoEditBuiltinEffectMedia(item.builtin.id) !== 'audio') ctx.addIssue({ code: 'custom', message: `效果控件只能放音频效果（${item.builtin.id} 不是音频效果）。` })
    const issue = videoEditBuiltinEffectIssue(item.builtin)
    if (issue) ctx.addIssue({ code: 'custom', message: issue })
  }
})
/** 输出：作用在剪好的整条声音上（音量；自动匹配响度时补偿 gainDb 并在末尾限幅到 -1 dB）。 */
export const audioEditOutputSchema = z.object({
  volumeDb: z.number().finite().min(-24).max(24),
  loudness: z.object({ enabled: z.boolean(), targetLufs: z.number().finite().min(-40).max(-5), gainDb: z.number().finite().min(-40).max(40) }).strict().optional(),
}).strict()

export type AudioEditChainItem = z.infer<typeof audioEditChainItemSchema>
export type AudioEditBuiltinChainItem = z.infer<typeof builtinItemSchema>
export type AudioEditMouthDeclickItem = z.infer<typeof mouthDeclickItemSchema>
export type AudioEditBreathItem = z.infer<typeof breathItemSchema>
export type AudioEditSeparationItem = z.infer<typeof separationItemSchema>
export type AudioEditPluginItem = z.infer<typeof pluginItemSchema>
export type AudioEditOutput = z.infer<typeof audioEditOutputSchema>
export { essentialSoundSettingsSchema as audioEditEssentialSoundSchema }

interface ChainOwner { effectChain?: readonly AudioEditChainItem[]; chainBypassed?: boolean; output?: AudioEditOutput }

/** 这一项会不会改变声音（开着且有实际作用）。 */
export function audioEditChainItemActive(item: AudioEditChainItem): boolean {
  if (!item.enabled) return false
  switch (item.kind) {
    case 'builtin': return item.amount > 0
    case 'essential': return essentialSoundEffects(item.settings).length > 0 || essentialSoundOfflineStages(item.settings).length > 0
    case 'mouth_declick': return item.clicks.length > 0
    case 'breath': return item.breaths.length > 0
    case 'separation': return item.amount > 0
    case 'plugin': return true
  }
}

/** 要先整段处理的效果（不能边播边算）。 */
export function audioEditChainItemWholeFile(item: AudioEditChainItem): boolean {
  return item.kind === 'mouth_declick' || item.kind === 'breath' || item.kind === 'separation' || item.kind === 'plugin'
    || (item.kind === 'essential' && essentialSoundOfflineStages(item.settings).length > 0)
}

/** 实际生效的效果（效果控件整体关闭时为空），按处理顺序。 */
export function audioEditActiveChain(project: ChainOwner): AudioEditChainItem[] {
  return project.chainBypassed ? [] : (project.effectChain ?? []).filter(audioEditChainItemActive)
}

/**
 * 分成两段：rendered = 直到最后一个整段处理的效果为止（主进程按顺序处理录音并缓存）；live = 之后的实时效果（边播边算）。
 */
export function splitAudioEditChain(project: ChainOwner): { rendered: AudioEditChainItem[]; live: AudioEditChainItem[] } {
  const active = audioEditActiveChain(project)
  let last = -1
  active.forEach((item, index) => { if (audioEditChainItemWholeFile(item)) last = index })
  return { rendered: active.slice(0, last + 1), live: active.slice(last + 1) }
}

/** 一项在处理时等价的内容（去掉 id 与开关）：缓存键用它，换 id、改名不重算。 */
export function audioEditChainItemRecipe(item: AudioEditChainItem): unknown {
  switch (item.kind) {
    case 'builtin': return ['builtin', item.amount, item.builtin]
    case 'essential': return ['essential', item.settings]
    case 'mouth_declick': return ['mouth_declick-v1', item.clicks]
    case 'breath': return ['breath-v1', item.mode, item.mode === 'mute' ? -120 : item.reductionDb, item.breaths]
    case 'separation': return ['separation-v1', item.mode, item.amount]
    case 'plugin': return ['plugin', item.pluginId, item.parameters]
  }
}

/** 一项换算成的实时效果（内置效果、基本声音）；实例 id 带上这一项的 id，链里放几份基本声音也不会互相串状态。 */
export function audioEditChainItemEffects(item: AudioEditChainItem): AudioEffectInstance[] {
  if (item.kind === 'builtin') return [{ id: item.id, builtin: item.builtin, amount: item.amount }]
  if (item.kind === 'essential') return essentialSoundEffects(item.settings).map(effect => ({ ...effect, id: `${item.id}:${effect.id}` }))
  return []
}

/** 输出一节换算成的实时效果：音量（含响度补偿），开了自动匹配响度时末尾限幅 -1 dB。 */
export function audioEditOutputEffects(output: AudioEditOutput | undefined): AudioEffectInstance[] {
  if (!output) return []
  const gain = (output.loudness?.enabled ? output.loudness.gainDb : 0) + output.volumeDb
  const effects: AudioEffectInstance[] = []
  if (Math.abs(gain) >= 0.05) effects.push({ id: 'output:gain', amount: 1, builtin: { id: 'gain_balance', params: { gain: Math.max(-24, Math.min(24, Math.round(gain * 10) / 10)), balance: 0, mono: false } } })
  if (output.loudness?.enabled) effects.push({ id: 'output:limiter', amount: 1, builtin: { id: 'limiter', params: { ceiling: -1, boost: 0 } } })
  return effects
}

/** 边播边算的部分（试听与导出共用）：链末尾的实时效果，再接输出一节。 */
export function audioEditRealtimeEffects(project: ChainOwner): AudioEffectInstance[] {
  return [...splitAudioEditChain(project).live.flatMap(audioEditChainItemEffects), ...audioEditOutputEffects(project.output)]
}

/** 新建效果项的默认值。 */
export function createAudioEditChainItem(kind: Exclude<AudioEditChainItem['kind'], 'builtin' | 'plugin'>, extra?: { mode?: 'isolate' | 'dereverb' }): AudioEditChainItem {
  const itemId = crypto.randomUUID()
  switch (kind) {
    case 'essential': return { id: itemId, kind, enabled: true, settings: { type: 'dialogue', repair: { rumble: { enabled: true, amount: 30 } } } }
    case 'mouth_declick': return { id: itemId, kind, enabled: true, sensitivity: 50, analyzed: false, clicks: [] }
    case 'breath': return { id: itemId, kind, enabled: true, mode: 'attenuate', reductionDb: -12, analyzed: false, breaths: [] }
    case 'separation': return { id: itemId, kind, enabled: true, mode: extra?.mode ?? 'dereverb', amount: 1 }
  }
}

/** 基本声音作为效果链里的一项时不含整段处理与输出的部分（人声分离、去混响是单独的效果，音量与响度在“输出”）。 */
export function audioEditEssentialItemSettings(settings: EssentialSoundSettings): EssentialSoundSettings {
  const { loudness: _loudness, volume: _volume, ...rest } = settings
  if (!rest.repair) return rest
  const { isolate: _isolate, reverb: _reverb, ...repair } = rest.repair
  return { ...rest, repair }
}

/**
 * 版本 4 → 5：把分散的效果字段合成一条有序效果链，顺序与旧版实际处理顺序一致（声音不变）：
 * 基本声音里的人声分离 / 去混响 → 口水音修复 → 试听时启用的 VST3 插件 → 基本声音其余各项 → 效果组；
 * 基本声音的剪辑音量与自动匹配响度移到“输出”。
 */
export function migrateAudioEditEffectsToChain(content: Record<string, unknown>): Record<string, unknown> {
  const next = structuredClone(content)
  const chain: AudioEditChainItem[] = []
  const essential = essentialSoundSettingsSchema.safeParse(next.essentialSound).data
  for (const stage of essentialSoundOfflineStages(essential)) chain.push({ id: `migrated-${stage.kind}`, kind: 'separation', enabled: true, mode: stage.kind, amount: stage.amount })
  const clicks = next.mouthClicks as { enabled: boolean; sensitivity: number; clicks: Array<{ startFrame: number; endFrame: number }> } | undefined
  if (clicks) chain.push({ id: 'migrated-mouth-declick', kind: 'mouth_declick', enabled: clicks.enabled, sensitivity: clicks.sensitivity, analyzed: true, clicks: clicks.clicks })
  const processors = Array.isArray(next.processorChain) ? next.processorChain as Array<{ id: string; enabled: boolean; parameters?: Record<string, number> }> : []
  for (const processor of processors) chain.push({ id: `migrated-plugin-${chain.length}`, kind: 'plugin', name: 'VST3 插件', enabled: processor.enabled && next.vstEnabled === true, pluginId: processor.id, parameters: processor.parameters ?? {} })
  if (essential) chain.push({ id: 'migrated-essential', kind: 'essential', enabled: true, settings: audioEditEssentialItemSettings(essential) })
  const bypassed = next.effectsBypassed === true
  for (const effect of Array.isArray(next.effects) ? next.effects as Array<Omit<AudioEditBuiltinChainItem, 'kind'>> : []) chain.push({ ...effect, kind: 'builtin', enabled: effect.enabled && !bypassed })
  for (const key of ['effects', 'effectsBypassed', 'essentialSound', 'mouthClicks', 'processorChain', 'vstEnabled']) delete next[key]
  if (chain.length) next.effectChain = chain
  if (essential?.volume || essential?.loudness) next.output = { volumeDb: essential.volume?.gainDb ?? 0, ...(essential.loudness ? { loudness: essential.loudness } : {}) }
  return next
}
