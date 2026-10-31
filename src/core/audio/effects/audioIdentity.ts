import { z } from 'zod'

// 两次等声迁移按时间倒序回溯，整条链只需比较三个历史时点，避免逐效果组合别名。
export const AUDIO_IDENTITY_PHASES = ['current', 'equalizer-modes', 'audio-merge'] as const
export type AudioIdentityPhase = typeof AUDIO_IDENTITY_PHASES[number]
const identityValueSchema = z.looseObject({
  id: z.string(), params: z.record(z.string(), z.unknown()),
  curves: z.record(z.string(), z.array(z.looseObject({ time: z.number(), value: z.unknown(), interpolation: z.string() }))).optional(),
})
const identityJson = z.string().refine(value => {
  try { return identityValueSchema.safeParse(JSON.parse(value)).success } catch { return false }
}, '音频身份内容无效')
export const audioIdentityAliasesSchema = z.array(z.object({
  phase: z.enum(['audio-merge', 'equalizer-modes']), current: identityJson, previous: identityJson,
}).strict())
export type AudioIdentityAliases = z.infer<typeof audioIdentityAliasesSchema>
export interface AudioIdentityBuiltin {
  id: string; params: Readonly<Record<string, unknown>>; identityAliases?: AudioIdentityAliases
}

export function audioIdentityJson(value: unknown): string {
  return JSON.stringify(value, (_key, entry: unknown) => entry && typeof entry === 'object' && !Array.isArray(entry)
    ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b))) : entry)
}

/** 别名的前提是声音参数仍与迁移结果相同；编辑后的效果不能借旧身份命中缓存。 */
export function audioBuiltinIdentity<T extends AudioIdentityBuiltin>(builtin: T, phase: AudioIdentityPhase = 'current'): Omit<T, 'identityAliases'> {
  const { identityAliases, ...current } = builtin
  let value = current
  if (phase !== 'current') for (const alias of [...(identityAliases ?? [])].reverse()) {
    if (phase === 'equalizer-modes' && alias.phase === 'audio-merge') continue
    if (audioIdentityJson(value) === alias.current) value = JSON.parse(alias.previous) as typeof current
  }
  return value
}

export function rememberAudioBuiltinIdentity<T extends AudioIdentityBuiltin>(previous: T, current: T, phase: Exclude<AudioIdentityPhase, 'current'>): T {
  const before = audioIdentityJson(audioBuiltinIdentity(previous)), after = audioIdentityJson(audioBuiltinIdentity(current))
  if (before === after) return current
  return { ...current, identityAliases: [...(previous.identityAliases ?? []), { phase, current: after, previous: before }] }
}

export function audioEffectsIdentity(effects: readonly { builtin: AudioIdentityBuiltin; amount: number }[], phase: AudioIdentityPhase = 'current'): unknown[] {
  return effects.map(({ builtin, amount }) => ({ builtin: audioBuiltinIdentity(builtin, phase), amount }))
}
