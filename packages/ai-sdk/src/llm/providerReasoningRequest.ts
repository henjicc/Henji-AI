import type { LlmReasoningConfig, LlmReasoningEffort } from './reasoning'
import type { LlmApiProtocol } from './providerProtocolCore'

/**
 * 把项目统一的「思考模式」设置翻译成各供应商实际接受的请求字段。
 *
 * 为什么需要这一层：项目对用户只暴露一个「关闭 / 低 / 中 / 高 / 极高 / 最高」的下拉，但各家
 * 供应商的写法各不相同——字段名有 `reasoning_effort`、`reasoning.effort`、`thinking`、`enable_thinking`，
 * 取值集合从 3 档到 7 档不等，能不能关也不一样（Kimi K3 写死始终思考）。
 * 资料出处见 `docs/llm-adaptation/README.md` 的「思考参数速查」表与各供应商文档。
 *
 * 同一家在 Chat Completions 与 Responses 下的写法也不同：Responses 的强度字段是 `reasoning.effort`，
 * 顶层 `reasoning_effort` 等 Chat 写法会被静默忽略（不报错，但开关和强度都不生效）。所以每条规则按协议
 * 分两份；只登记了 Chat 写法的供应商在 Responses 下走 Responses 通用写法。
 *
 * 没登记的供应商走通用兜底：只发 OpenAI 事实标准字段（Chat 为 `reasoning_effort`，Responses 为
 * `reasoning.effort`），不发任何某一家的私有字段（`thinking`、`enable_thinking` 发给不认识它的网关可能直接 400）。
 * 调用方都先用模型的 `capabilities.reasoning` 兜一层，所以兜底只会命中用户明确标了「支持思考」的模型。
 */

/** 用户可选强度，从低到高。 */
const EFFORT_SCALE: readonly LlmReasoningEffort[] = ['low', 'medium', 'high', 'xhigh', 'max']

/**
 * 把统一强度落到某家实际支持的档位上：取不超过用户选择的最高一档，
 * 用户选得比对方最低档还低时取最低档。这样"调高一定不会变低"的直觉始终成立。
 */
function pickEffort(
  effort: LlmReasoningEffort,
  supported: readonly LlmReasoningEffort[]
): LlmReasoningEffort {
  const target = EFFORT_SCALE.indexOf(effort)
  let picked = supported[0]
  for (const candidate of supported) {
    if (EFFORT_SCALE.indexOf(candidate) <= target) picked = candidate
  }
  return picked
}

type ReasoningBodyBuilder = (reasoning: LlmReasoningConfig, body: Record<string, unknown>) => Record<string, unknown>

interface ProviderReasoningRule {
  chat: ReasoningBodyBuilder
  /** 省略时走 Responses 通用写法。 */
  responses?: ReasoningBodyBuilder
  /** 请求体里可能残留、且与本规则冲突的字段，写入前先删掉；省略时 Responses 删全部思考字段，Chat 不删。 */
  strip?: readonly string[]
}

const CHAT_FIELDS = ['thinking', 'reasoning_effort'] as const
const ALL_REASONING_FIELDS = ['thinking', 'reasoning_effort', 'reasoning', 'enable_thinking'] as const

function modelOf(body: Record<string, unknown>): string {
  return typeof body.model === 'string' ? body.model.toLowerCase() : ''
}

/** DeepSeek 官方映射表（思考模式页）：medium、xhigh 映射为 high；照表显式换算，档位不靠服务端兜底。 */
const DEEPSEEK_EFFORT: Readonly<Record<LlmReasoningEffort, string>> = { low: 'low', medium: 'high', high: 'high', xhigh: 'high', max: 'max' }
/** 智谱 Responses（创建 Response 的 ReasoningConfig）：low、medium 映射为 high，xhigh 映射为 max。 */
const BIGMODEL_RESPONSES_EFFORT: Readonly<Record<LlmReasoningEffort, string>> = { low: 'high', medium: 'high', high: 'high', xhigh: 'max', max: 'max' }
const FIVE_LEVELS: readonly LlmReasoningEffort[] = ['low', 'medium', 'high', 'xhigh', 'max']

/**
 * 未登记供应商的兜底：只发 OpenAI 事实标准字段，关闭时什么都不发。
 *
 * 关闭时不发 `none` 之类的值——那是部分供应商的取值，不是通用约定。
 */
const defaultChatBody: ReasoningBodyBuilder = reasoning => (
  reasoning.enabled ? { reasoning_effort: reasoning.effort } : {}
)
const defaultResponsesBody: ReasoningBodyBuilder = reasoning => (
  reasoning.enabled ? { reasoning: { effort: reasoning.effort } } : {}
)

const PROVIDER_REASONING_RULES: Readonly<Record<string, ProviderReasoningRule>> = {
  // MiMo 没有强度分级：Chat 用 thinking 开关，Responses 只有开（high）与关（none）。
  mimo: {
    strip: ALL_REASONING_FIELDS,
    chat: reasoning => ({ thinking: { type: reasoning.enabled ? 'enabled' : 'disabled' } }),
    responses: reasoning => ({ reasoning: { effort: reasoning.enabled ? 'high' : 'none' } }),
  },
  // 硅基流动的思考开关与原厂不同；强度字段只发送给端点文档明确列举的模型。
  siliconflow: {
    strip: CHAT_FIELDS,
    chat: (reasoning, body) => ({
      enable_thinking: reasoning.enabled,
      ...(reasoning.enabled && [
        'deepseek-ai/deepseek-v4-flash', 'pro/deepseek-ai/deepseek-v4', 'pro/zai-org/glm-5.2',
      ].includes(modelOf(body))
        ? { reasoning_effort: reasoning.effort === 'xhigh' || reasoning.effort === 'max' ? 'max' : 'high' }
        : {}),
    }),
  },
  // DeepSeek：Chat 用 thinking 开关加 reasoning_effort；Responses 只认 reasoning.effort，none 即关闭。
  deepseek: {
    strip: ALL_REASONING_FIELDS,
    chat: reasoning => (reasoning.enabled
      ? { thinking: { type: 'enabled' }, reasoning_effort: DEEPSEEK_EFFORT[reasoning.effort] }
      : { thinking: { type: 'disabled' } }),
    responses: reasoning => ({ reasoning: { effort: reasoning.enabled ? DEEPSEEK_EFFORT[reasoning.effort] : 'none' } }),
  },

  // Kimi K3 系列（K3、K3.1 Pro 与 Highspeed）：始终思考、官方没有关闭开关，只有 low / high / max 三档。
  // 用户选「关闭」时退到最低档，而不是假装关掉——这一点在供应商预设的说明里也写了。
  kimi: {
    strip: CHAT_FIELDS,
    chat: (reasoning, body) => {
      const model = modelOf(body)
      if (model === 'kimi-k3' || model.startsWith('kimi-k3.1-pro')) {
        return { reasoning_effort: reasoning.enabled ? pickEffort(reasoning.effort, ['low', 'high', 'max']) : 'low' }
      }
      if (model === 'kimi-k2.6') return { thinking: { type: reasoning.enabled ? 'enabled' : 'disabled' } }
      if (model === 'kimi-k2.7-code') return { thinking: { type: 'enabled', keep: 'all' } }
      return {}
    },
  },

  // 智谱 GLM Chat：GLM-5.3 传 thinking.type='disabled' 会直接请求失败（官方迁移说明写明），
  // 而 GLM-5V-Turbo 不传即为关闭。所以关闭时整段不发，让两个模型各自走默认。
  // Responses 下 GLM-5.3 可以关：reasoning.effort 为 none 即放弃思考。
  bigmodel: {
    chat: reasoning => (reasoning.enabled
      ? { thinking: { type: 'enabled' }, reasoning_effort: pickEffort(reasoning.effort, ['low', 'high', 'max']) }
      : {}),
    responses: reasoning => ({ reasoning: { effort: reasoning.enabled ? BIGMODEL_RESPONSES_EFFORT[reasoning.effort] : 'none' } }),
  },

  // 火山引擎：Chat 的 reasoning_effort 与项目档位重合的五档直接透传，关闭用 thinking 开关。
  // Responses 开关仍是 thinking，强度改为 reasoning.effort；thinking 为 disabled 时
  // reasoning.effort 只接受 minimal、其余取值会报错，所以关闭时不发强度。
  volcengine: {
    strip: ALL_REASONING_FIELDS,
    chat: reasoning => (reasoning.enabled
      ? { thinking: { type: 'enabled' }, reasoning_effort: pickEffort(reasoning.effort, FIVE_LEVELS) }
      : { thinking: { type: 'disabled' } }),
    responses: reasoning => (reasoning.enabled
      ? { thinking: { type: 'enabled' }, reasoning: { effort: pickEffort(reasoning.effort, FIVE_LEVELS) } }
      : { thinking: { type: 'disabled' } }),
  },

  // MiniMax M3.1 Flash：五档、省略即 max，发 none 会 400，所以「关闭」退到最低档。
  // M3 默认不思考，Responses 下发任意非 none 档位才开启（官方说明不调节深度）。
  minimax: {
    chat: (reasoning, body) => {
      if (modelOf(body) !== 'minimax-m3.1-flash') return defaultChatBody(reasoning, body)
      return { reasoning_effort: reasoning.enabled ? pickEffort(reasoning.effort, FIVE_LEVELS) : 'low' }
    },
    responses: (reasoning, body) => {
      if (modelOf(body) === 'minimax-m3.1-flash') {
        return { reasoning: { effort: reasoning.enabled ? pickEffort(reasoning.effort, FIVE_LEVELS) : 'low' } }
      }
      return defaultResponsesBody(reasoning, body)
    },
  },

  // 阿里云百炼：布尔开关，没有强度分级；官方写明 enable_thinking 在 Chat 与 Responses 下都适用。
  bailian: {
    chat: reasoning => ({ enable_thinking: reasoning.enabled }),
    responses: reasoning => ({ enable_thinking: reasoning.enabled }),
  },

  // Groq GPT-OSS：只接受 low / medium / high；不支持 reasoning_format。
  // include_reasoning 是独立的返回控制开关，关闭时不再发送 reasoning_effort。
  // GPT-OSS 不能关闭思考，关闭时只隐藏思考内容；Qwen3.8-27B 收 reasoning_effort: none，能真正关掉。
  groq: {
    chat: (reasoning, body) => {
      if (reasoning.enabled) return { reasoning_effort: pickEffort(reasoning.effort, ['low', 'medium', 'high']), include_reasoning: true }
      return modelOf(body) === 'qwen/qwen3.8-27b' ? { reasoning_effort: 'none' } : { include_reasoning: false }
    },
  },
}

/**
 * 供应商登记键：先认 `providerId`，再退回 `adapter`。
 *
 * 退回 adapter 是为了保住既有行为——用户可以把 DeepSeek 供应商命名成别的 id，
 * 只要适配器仍选 deepseek，思考参数就该照旧生效。
 */
function resolveReasoningKey(providerId: string, adapter?: string): string | null {
  const normalizedProviderId = providerId.trim().toLowerCase()
  if (normalizedProviderId in PROVIDER_REASONING_RULES) return normalizedProviderId
  const normalizedAdapter = adapter?.trim().toLowerCase() ?? ''
  return normalizedAdapter in PROVIDER_REASONING_RULES ? normalizedAdapter : null
}

/** 该供应商是否有专门登记的思考参数写法；false 表示走通用兜底。 */
export function hasProviderReasoningRule(providerId: string, adapter?: string): boolean {
  return resolveReasoningKey(providerId, adapter) !== null
}

/** 按协议取出请求体里实际发出的强度值（Chat 顶层 `reasoning_effort`，Responses `reasoning.effort`）。 */
export function readReasoningEffortField(body: Record<string, unknown>): unknown {
  if (body.reasoning_effort !== undefined) return body.reasoning_effort
  const reasoning = body.reasoning
  return reasoning && typeof reasoning === 'object' && !Array.isArray(reasoning) ? (reasoning as Record<string, unknown>).effort : undefined
}

/** MiMo Responses 不收思考输入项的 summary / encrypted_content，改成 reasoning_text 内容块。 */
function mimoResponsesInput(input: unknown): unknown {
  if (!Array.isArray(input)) return input
  return input.map((item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item
    const value = item as Record<string, unknown>
    if (value.type !== 'reasoning' || !Array.isArray(value.summary)) return value
    const { summary, encrypted_content: _encrypted, ...rest } = value
    return { ...rest, content: summary.map((part: Record<string, unknown>) => ({ type: 'reasoning_text', text: part.text })) }
  })
}

export function applyProviderReasoningRequestBody(
  providerId: string,
  adapter: string | undefined,
  body: Record<string, unknown>,
  reasoning: LlmReasoningConfig | undefined,
  protocol: LlmApiProtocol = 'openai-compatible',
): Record<string, unknown> {
  const key = resolveReasoningKey(providerId, adapter)
  // MiMo 省略思考字段时走服务端默认值，项目统一显式发送，保证两种协议行为一致。
  if (!reasoning && key !== 'mimo') return body
  reasoning ??= { enabled: true, effort: 'high' }
  const rule = key ? PROVIDER_REASONING_RULES[key] : undefined
  const responses = protocol === 'openai-responses'
  const build = responses ? rule?.responses ?? defaultResponsesBody : rule?.chat ?? defaultChatBody
  const clean = { ...body }
  for (const field of rule?.strip ?? (responses ? ALL_REASONING_FIELDS : [])) delete clean[field]
  if (key === 'mimo') {
    // MiMo 思考时采样参数固定为 1 / 0.95；省略可避免用户采样设置造成 400。
    if (reasoning.enabled) {
      delete clean.temperature
      delete clean.top_p
    }
    if (responses && 'input' in clean) clean.input = mimoResponsesInput(clean.input)
  }
  return { ...clean, ...build(reasoning, clean) }
}
