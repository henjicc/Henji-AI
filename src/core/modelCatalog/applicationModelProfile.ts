import {
  createAIClient,
  createModelIndex,
  createModelCapabilityDiscovery,
  LLM_MODEL_CATALOG_ENTRIES,
  type AIClient,
  type CapabilityDiscoveryItem,
  type GenerationPack,
  type ModelCapabilityDiscovery,
  type ModelCapabilityQuery,
  type ModelRuntimeDefinition,
  type RuntimeContext,
} from '@henjicc/ai-sdk'
import apimartProviderPack from '@henjicc/ai-sdk/provider-packs/apimart'
import bailianProviderPack from '@henjicc/ai-sdk/provider-packs/bailian'
import falProviderPack from '@henjicc/ai-sdk/provider-packs/fal'
import falMultiAngleTools from '@henjicc/ai-sdk/tool-packs/fal-multi-angle-tools'
import grsaiProviderPack from '@henjicc/ai-sdk/provider-packs/grsai'
import kieProviderPack from '@henjicc/ai-sdk/provider-packs/kie'
import modelscopeProviderPack from '@henjicc/ai-sdk/provider-packs/modelscope'
import ppioProviderPack from '@henjicc/ai-sdk/provider-packs/ppio'
import volcengineProviderPack from '@henjicc/ai-sdk/provider-packs/volcengine'

export const HENJI_GENERATION_PROVIDER_IDS = [
  'volcengine',
  'bailian',
  'grsai',
  'ppio',
  'modelscope',
  'apimart',
  'kie',
  'fal',
] as const

export const HENJI_GENERATION_PROVIDER_PACKS: readonly GenerationPack[] = [
  volcengineProviderPack,
  bailianProviderPack,
  grsaiProviderPack,
  ppioProviderPack,
  modelscopeProviderPack,
  apimartProviderPack,
  kieProviderPack,
  falProviderPack,
]

/** 运行时额外装载的受控工具模型；不进入普通模型选择器与能力发现。 */
export const HENJI_GENERATION_EXECUTION_PACKS: readonly GenerationPack[] = [
  ...HENJI_GENERATION_PROVIDER_PACKS,
  falMultiAngleTools,
]

/**
 * Henji-AI 的产品选择门禁。这里只声明 provider pack 组合，不复制模型 ID 或能力表；
 * 模型、上传、执行适配和能力画像继续从 pack 中的真实 schema 派生。
 */
export function assertHenjiGenerationSelection(
  packs: readonly GenerationPack[]
): readonly ModelRuntimeDefinition[] {
  const expectedProviders = new Set<string>(HENJI_GENERATION_PROVIDER_IDS)
  const selectedProviders = new Set(packs.flatMap((pack) => pack.providers.map((provider) => provider.id)))
  const models = packs.flatMap((pack) => pack.models)
  const modelIds = new Set(models.map((model) => model.meta.id))

  if (
    selectedProviders.size !== expectedProviders.size ||
    [...expectedProviders].some((providerId) => !selectedProviders.has(providerId))
  ) {
    throw new Error(
      `Henji generation provider selection mismatch: expected ${[...expectedProviders].join(', ')}, ` +
      `received ${[...selectedProviders].join(', ') || '(none)'}`
    )
  }
  if (models.length !== 105 || modelIds.size !== 105) {
    throw new Error(
      `Henji generation model selection mismatch: expected 105 unique models, ` +
      `received ${models.length} entries/${modelIds.size} unique`
    )
  }
  for (const model of models) {
    if (!selectedProviders.has(model.meta.provider)) {
      throw new Error(`Henji generation model ${model.meta.id} has unselected provider ${model.meta.provider}`)
    }
  }
  return models
}

export const HENJI_GENERATION_MODELS = assertHenjiGenerationSelection(HENJI_GENERATION_PROVIDER_PACKS)

const henjiGenerationModelIndex = createModelIndex(HENJI_GENERATION_MODELS)

export function getHenjiGenerationModel(modelId: string): ModelRuntimeDefinition | undefined {
  return henjiGenerationModelIndex.get(modelId)
}

/** 生产客户端显式使用 modular 模式；chat/LLM 仍由同一个根 client 提供。 */
export function createHenjiAIClient(runtime: RuntimeContext): AIClient {
  return createAIClient({
    runtime,
    generation: { mode: 'modular', packs: HENJI_GENERATION_EXECUTION_PACKS },
  })
}

/**
 * 应用统一能力发现入口。筛选只作用于本应用已选的 105 个生成模型和真实 LLM 目录，
 * 不会隐式引入默认目录之外的 Fal 工具 pack。
 */
export const henjiModelCapabilityDiscovery: ModelCapabilityDiscovery = createModelCapabilityDiscovery({
  generationPacks: HENJI_GENERATION_PROVIDER_PACKS,
  llmEntries: LLM_MODEL_CATALOG_ENTRIES,
})

export function searchHenjiModelCapabilities(
  query: ModelCapabilityQuery
): readonly CapabilityDiscoveryItem[] {
  return henjiModelCapabilityDiscovery.search(query)
}
