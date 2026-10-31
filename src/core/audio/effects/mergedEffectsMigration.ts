import { rememberAudioBuiltinIdentity, type AudioIdentityBuiltin } from './audioIdentity'
import { essentialSoundEffects, type EssentialSoundSettings } from '../essentialSound'

/** 音频效果合并的逐版本迁移：冻结来源默认值，参数与曲线只改键，不重新采样。 */
interface Rule { id: string; mode: string | null; prefix: string; name: string; defaults: Record<string, unknown> }
const RULES: Readonly<Record<string, Rule>> = {
  polarity_invert: { id: "gain_balance", mode: null, prefix: "", name: "反相", defaults: {"channels": "both"} },
  compressor: { id: "compressor", mode: "single", prefix: "", name: "压缩器", defaults: {"amount": 40, "speed": "normal", "makeup": true} },
  multiband_compressor: { id: "compressor", mode: "multi", prefix: "multi_", name: "多段压缩器", defaults: {"low_crossover": 200, "high_crossover": 3000, "low_amount": 30, "mid_amount": 30, "high_amount": 30, "output": 0} },
  delay: { id: "delay_echo", mode: "delay", prefix: "delay_", name: "延迟", defaults: {"left_delay": 0, "right_delay": 0, "mix": 100} },
  echo: { id: "delay_echo", mode: "echo", prefix: "echo_", name: "回声", defaults: {"delay": 250, "feedback": 35, "mix": 30, "tone": 8000, "ping_pong": false} },
  parametric_eq: { id: "equalizer", mode: "parametric", prefix: "simple_", name: "参数均衡", defaults: {"preset": "none", "low": 0, "mid": 0, "high": 0} },
  eq_bands: { id: "equalizer", mode: "parametric", prefix: "", name: "参数均衡器", defaults: {"hp_on": false, "hp_frequency": 80, "low_gain": 0, "low_frequency": 120, "band1_gain": 0, "band1_frequency": 250, "band1_q": 30, "band2_gain": 0, "band2_frequency": 1000, "band2_q": 30, "band3_gain": 0, "band3_frequency": 4000, "band3_q": 30, "high_gain": 0, "high_frequency": 8000, "lp_on": false, "lp_frequency": 16000} },
  graphic_eq: { id: "equalizer", mode: "graphic", prefix: "graphic_", name: "图形均衡器（10 段）", defaults: {"band_31": 0, "band_63": 0, "band_125": 0, "band_250": 0, "band_500": 0, "band_1k": 0, "band_2k": 0, "band_4k": 0, "band_8k": 0, "band_16k": 0, "output": 0} },
  notch: { id: "audio_filter", mode: "notch", prefix: "notch_", name: "陷波滤波器", defaults: {"frequency": 1000, "width": 50, "depth": -30} },
  high_pass: { id: "audio_filter", mode: "high_pass", prefix: "high_pass_", name: "高通（去低频）", defaults: {"frequency": 80, "slope": "gentle"} },
  low_pass: { id: "audio_filter", mode: "low_pass", prefix: "low_pass_", name: "低通（去高频）", defaults: {"frequency": 8000, "slope": "gentle"} },
  chorus: { id: "modulation", mode: "chorus", prefix: "chorus_", name: "和声", defaults: {"rate": 0.8, "depth": 40, "voices": 2, "mix": 40} },
  flanger: { id: "modulation", mode: "flanger", prefix: "flanger_", name: "镶边", defaults: {"rate": 0.3, "depth": 60, "feedback": 40, "mix": 50} },
  phaser: { id: "modulation", mode: "phaser", prefix: "phaser_", name: "移相器", defaults: {"rate": 0.5, "depth": 60, "stages": "8", "feedback": 30, "mix": 50} },
}
const NAMES: Readonly<Record<string, string>> = { gain_balance: '增益与声道', compressor: '压缩器', delay_echo: '延迟与回声', equalizer: '均衡器', audio_filter: '滤波', modulation: '调制' }
type RecordValue = Record<string, unknown>
const record = (value: unknown): value is RecordValue => !!value && typeof value === 'object' && !Array.isArray(value)

/** 可用于文档迁移及旧预设的读取；已经有方式的压缩器不重复转换。 */
export function migrateAudioEffectInstance<T extends { id: string; params: Readonly<Record<string, unknown>> }>(instance: T): T {
  const rule = RULES[instance.id]
  if (!rule || instance.id === 'compressor' && instance.params.mode !== undefined) return structuredClone(instance)
  const key = (name: string): string => instance.id === 'polarity_invert' && name === 'channels' ? 'invert' : rule.prefix + name
  const params = Object.fromEntries(Object.entries({ ...rule.defaults, ...instance.params }).map(([name, value]) => [key(name), structuredClone(value)]))
  if (rule.mode) params.mode = rule.mode
  const curves = (instance as T & { curves?: RecordValue }).curves
  const current = { ...structuredClone(instance), id: rule.id, params, ...(curves ? { curves: Object.fromEntries(Object.entries(curves).map(([name, points]) => [key(name), structuredClone(points)])) } : {}) }
  return rememberAudioBuiltinIdentity(instance, current, 'audio-merge')
}

/** 片段、音轨、主轨、录制基线与口播链里的 builtin 共用同一个转换。 */
export function migrateAudioMergedEffects<T>(content: T): T {
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk)
    if (!record(value)) return value
    const result: RecordValue = Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, walk(entry)]))
    if (record(value.essentialSound)) result.essentialSound = rememberEssentialSoundIdentity(value.essentialSound)
    if (value.kind === 'essential' && record(value.settings)) result.settings = rememberEssentialSoundIdentity(value.settings)
    if (record(value.builtin) && typeof value.builtin.id === 'string' && record(value.builtin.params)) {
      const sourceId = value.builtin.id
      result.builtin = migrateAudioEffectInstance({ ...value.builtin, id: sourceId, params: value.builtin.params })
      if (value.name === RULES[sourceId]?.name || sourceId === 'gain_balance' && value.name === '增益与声道平衡') result.name = NAMES[(result.builtin as { id: string }).id] ?? value.name
    }
    // 旋钮引用效果实例的参数键，必须与该实例一起换名；控制点与输出量纲保持不变。
    if (Array.isArray(value.effects) && Array.isArray(result.knobs)) {
      const effects = value.effects.filter(record)
      result.knobs = result.knobs.map(knob => !record(knob) || !Array.isArray(knob.mappings) ? knob : {
        ...knob, mappings: knob.mappings.map((mapping: unknown) => {
          if (!record(mapping) || typeof mapping.parameter !== 'string') return mapping
          const builtin = effects.find(effect => effect.id === mapping.effectId)?.builtin
          if (!record(builtin) || typeof builtin.id !== 'string' || !record(builtin.params)) return mapping
          const rule = RULES[builtin.id]
          if (!rule || builtin.id === 'compressor' && builtin.params.mode !== undefined) return mapping
          return { ...mapping, parameter: builtin.id === 'polarity_invert' && mapping.parameter === 'channels' ? 'invert' : rule.prefix + mapping.parameter }
        }),
      })
    }
    return result
  }
  return walk(content) as T
}

/** 本机效果库 v3 → v4：收藏与预设引用同时迁移，多个来源合并成一个收藏。 */
export function migrateAudioEffectLibraryV3(content: unknown): unknown {
  const migrated = migrateAudioMergedEffects(content)
  if (!record(migrated) || !Array.isArray(migrated.favorites)) return migrated
  return { ...migrated, favorites: [...new Set(migrated.favorites.map((ref: unknown) => {
    if (typeof ref !== 'string' || !ref.startsWith('effect:')) return ref
    const id = ref.slice('effect:'.length)
    return `effect:${RULES[id]?.id ?? id}`
  }))] }
}

/** 剪辑预设包 v11 → v12：旧程序不能把新的方式与效果 ID 当成原算法。 */
export function migrateAudioPresetPackageV11(content: unknown): unknown {
  return { ...migrateAudioMergedEffects(content) as Record<string, unknown>, version: 12 }
}

/** 已合并均衡器的简易参数独立成方式；混用两组参数的已存效果保持原声音。 */
export function migrateAudioEqualizerModes<T>(content: T): T {
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk)
    if (!record(value)) return value
    const next = Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, walk(entry)]))
    if (record(value.builtin) && value.builtin.id === 'equalizer' && record(value.builtin.params)) {
      const params = value.builtin.params
      const curves = record(value.builtin.curves) ? value.builtin.curves : {}
      const hasSimple = Object.keys(params).some(key => key.startsWith('simple_'))
      const active = (defaults: RecordValue, prefix = ''): boolean => Object.entries(defaults).some(([key, fallback]) => {
        const name = prefix + key; const curve = curves[name]
        return params[name] !== undefined && params[name] !== fallback || Array.isArray(curve) && curve.length > 0
      })
      const simple = active(RULES.parametric_eq.defaults, 'simple_')
      const parametric = active(RULES.eq_bands.defaults)
      if (params.mode === undefined || params.mode === 'parametric') {
        const hasParametric = Object.keys(RULES.eq_bands.defaults).some(key => params[key] !== undefined)
        const mode = simple && parametric ? 'combined' : (simple || hasSimple && !hasParametric) && !parametric ? 'simple' : 'parametric'
        next.builtin = rememberAudioBuiltinIdentity(value.builtin as unknown as AudioIdentityBuiltin, { ...next.builtin as unknown as AudioIdentityBuiltin, params: { ...params, mode } }, 'equalizer-modes')
      }
    }
    return next
  }
  return walk(content) as T
}

/** 基本声音的参数本身不改名，但生成的高通和均衡效果表示参与历史声音签名。 */
function rememberEssentialSoundIdentity(value: RecordValue): RecordValue {
  const settings = value as unknown as EssentialSoundSettings
  const aliases = { ...settings.effectIdentityAliases }
  for (const effect of essentialSoundEffects(settings)) {
    const builtin = effect.builtin
    let previous: AudioIdentityBuiltin | undefined
    if (effect.id === 'essential:rumble') previous = { id: 'high_pass', params: { frequency: builtin.params.high_pass_frequency, slope: builtin.params.high_pass_slope } }
    if (effect.id === 'essential:eq') { const { mode: _mode, ...params } = builtin.params; previous = { id: 'eq_bands', params } }
    if (previous && !aliases[effect.id]) aliases[effect.id] = rememberAudioBuiltinIdentity(previous, builtin, 'audio-merge').identityAliases!
  }
  return Object.keys(aliases).length ? { ...structuredClone(value), effectIdentityAliases: aliases } : structuredClone(value)
}
