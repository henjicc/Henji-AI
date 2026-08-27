import type { LlmReasoningConfig, LlmReasoningEffort } from './reasoning'

/**
 * 把项目统一的「思考模式」设置翻译成各供应商实际接受的请求字段。
 *
 * 为什么需要这一层：项目对用户只暴露一个「关闭 / 低 / 中 / 高 / 极高 / 最高」的下拉，但七家
 * 供应商的写法各不相同——字段名有 `reasoning_effort`、`thinking`、`enable_thinking` 三种，
 * 取值集合从 3 档到 7 档不等，能不能关也不一样（Kimi K3、GLM-5.3 写死始终思考）。
 * 资料出处见 `docs/llm-adaptation/README.md` 的「思考参数速查」表与各供应商文档。
 *
 * 在此之前，两条发请求的路径都只对 DeepSeek 做了处理，其余供应商的思考模式下拉**发出去的请求里
 * 根本没有对应字段**，改了没有任何效果；而且两条路径给 DeepSeek 发的字段还不一致（原生流式发的是
 * `reasoning: true`，不是官方文档要求的 `thinking` + `reasoning_effort`）。这里收成一份，
 * 两条路径共用。
 *
 * 没登记的供应商走通用兜底：只发 OpenAI 事实标准的 `reasoning_effort`，不发任何某一家的私有字段
 * （`thinking`、`enable_thinking` 都是私有写法，发给不认识它的网关可能直接 400）。
 * 两条路径都在调用前用模型的 `capabilities.reasoning` 兜一层，所以兜底只会命中用户明确标了
 * 「支持思考」的模型。
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

type ReasoningBodyBuilder = (reasoning: LlmReasoningConfig) => Record<string, unknown>

const PROVIDER_REASONING_BODY: Readonly<Record<string, ReasoningBodyBuilder>> = {
  // DeepSeek：官方要求 thinking 与 reasoning_effort 同时传；文档没有列举离散档位，
  // 沿用此前 SDK 路径已有的 high / max 两档映射。
  deepseek: reasoning => (reasoning.enabled
    ? { thinking: { type: 'enabled' }, reasoning_effort: pickEffort(reasoning.effort, ['high', 'max']) }
    : { thinking: { type: 'disabled' } }),

  // Kimi K3：始终思考、官方没有关闭开关，只有 low / high / max 三档。
  // 用户选「关闭」时退到最低档，而不是假装关掉——这一点在供应商预设的说明里也写了。
  kimi: reasoning => ({
    reasoning_effort: reasoning.enabled ? pickEffort(reasoning.effort, ['low', 'high', 'max']) : 'low',
  }),

  // 智谱 GLM：GLM-5.3 传 thinking.type='disabled' 会直接请求失败（官方迁移说明写明），
  // 而 GLM-5V-Turbo 不传即为关闭。所以关闭时整段不发，让两个模型各自走默认，
  // 而不是发一个会让旗舰模型 400 的字段。
  bigmodel: reasoning => (reasoning.enabled
    ? { thinking: { type: 'enabled' }, reasoning_effort: pickEffort(reasoning.effort, ['low', 'high', 'max']) }
    : {}),

  // 火山引擎：reasoning_effort 有 none/minimal/low/medium/high/xhigh/max 七档，
  // 与项目档位重合的五档直接透传，关闭时用 thinking 开关。
  volcengine: reasoning => (reasoning.enabled
    ? {
        thinking: { type: 'enabled' },
        reasoning_effort: pickEffort(reasoning.effort, ['low', 'medium', 'high', 'xhigh', 'max']),
      }
    : { thinking: { type: 'disabled' } }),

  // 阿里云百炼：布尔开关，没有强度分级。
  bailian: reasoning => ({ enable_thinking: reasoning.enabled }),

  // Groq GPT-OSS：只接受 low / medium / high；不支持 reasoning_format。
  // include_reasoning 是独立的返回控制开关，关闭时不再发送 reasoning_effort。
  groq: reasoning => (reasoning.enabled
    ? {
        reasoning_effort: pickEffort(reasoning.effort, ['low', 'medium', 'high']),
        include_reasoning: true,
      }
    : { include_reasoning: false }),

  // 小米 MiMo、MiniMax：官方文档只约定了思考内容怎么回传，没有给出请求侧的开关或强度字段，
  // 因此不下发任何字段。等文档补齐再加，不要凭字段名相似猜。
}

/**
 * 未登记供应商的兜底：只发 OpenAI 事实标准字段，关闭时什么都不发。
 *
 * 关闭时不发 `reasoning_effort: 'none'` 之类的值——那是火山引擎的私有取值，不是通用约定。
 */
const defaultReasoningBody: ReasoningBodyBuilder = reasoning => (
  reasoning.enabled ? { reasoning_effort: reasoning.effort } : {}
)

/**
 * 供应商登记键：先认 `providerId`，再退回 `adapter`。
 *
 * 退回 adapter 是为了保住既有行为——用户可以把 DeepSeek 供应商命名成别的 id，
 * 只要适配器仍选 deepseek，思考参数就该照旧生效。
 */
function resolveReasoningKey(providerId: string, adapter?: string): string | null {
  const normalizedProviderId = providerId.trim().toLowerCase()
  if (normalizedProviderId in PROVIDER_REASONING_BODY) return normalizedProviderId
  const normalizedAdapter = adapter?.trim().toLowerCase() ?? ''
  return normalizedAdapter in PROVIDER_REASONING_BODY ? normalizedAdapter : null
}

/** 该供应商是否有专门登记的思考参数写法；false 表示走通用兜底。 */
export function hasProviderReasoningRule(providerId: string, adapter?: string): boolean {
  return resolveReasoningKey(providerId, adapter) !== null
}

export function applyProviderReasoningRequestBody(
  providerId: string,
  adapter: string | undefined,
  body: Record<string, unknown>,
  reasoning: LlmReasoningConfig | undefined
): Record<string, unknown> {
  if (!reasoning) return body
  const key = resolveReasoningKey(providerId, adapter)
  const build = key ? PROVIDER_REASONING_BODY[key] : defaultReasoningBody
  return { ...body, ...build(reasoning) }
}
