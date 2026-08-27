import { catalog } from './catalog'
import {
  createGenerationClientCore,
  type GenerationClient,
  type GenerationClientProviderRegistration,
} from './generation/core'
import {
  executeContinuePolling,
  executeGenerate,
  listProviders,
  registerProvider,
  testProviderConnection,
  unregisterProvider,
} from './providers'
import type { RuntimeContext } from './runtime/RuntimeContext'
import type { ModelRuntimeDefinition, ProviderId } from './types/model'
import { preprocessRequestBody } from './upload/preprocess'

export * from './generation/core'

/**
 * 兼容入口的配置：`models` 与 `providers` 仍在默认 99 模型/8 供应商上追加。
 * 需要真正零内置依赖或严格选择模型时，请改用 `generation/core`。
 */
export interface CreateGenerationClientConfig {
  runtime: RuntimeContext
  providers?: readonly GenerationClientProviderRegistration[]
  models?: readonly ModelRuntimeDefinition[]
}

/**
 * 创建默认含 99 个生成模型的兼容客户端。
 *
 * 这里仅负责装配旧的全量 catalog 与进程级 provider registry；所有目录、请求、取消和
 * 生命周期行为都委托 `generation/core` 的唯一生成内核。
 */
export function createGenerationClient(config: CreateGenerationClientConfig): GenerationClient {
  const ownedProviderIds = registerClientProviders(config.providers ?? [])
  try {
    const customById = new Map((config.providers ?? []).map((provider) => [provider.id, provider]))
    const providers = listProviders().map((providerId): GenerationClientProviderRegistration => {
      const custom = customById.get(providerId)
      return {
        id: providerId,
        adapter: {
          execute: async (input) => await executeGenerate(providerId, input),
          continuePolling: async (input) => await executeContinuePolling(providerId, input),
        },
        preprocess: custom?.preprocess ?? (async (input) => await preprocessRequestBody(
          input.providerId,
          input.route,
          input.body,
          input.runtime,
          input.params,
          input.model.runtimeConstraints,
          input.requestId,
          input.signal
        )),
        testConnection: custom?.testConnection ?? (
          async (runtime) => await testProviderConnection(providerId, runtime)
        ),
      }
    })

    return createGenerationClientCore({
      runtime: config.runtime,
      models: [...catalog, ...(config.models ?? [])],
      providers,
      onDispose: () => {
        for (const providerId of ownedProviderIds) unregisterProvider(providerId)
      },
    })
  } catch (error) {
    for (const providerId of ownedProviderIds) unregisterProvider(providerId)
    throw error
  }
}

function registerClientProviders(
  registrations: readonly GenerationClientProviderRegistration[]
): ProviderId[] {
  const registered: ProviderId[] = []
  try {
    for (const registration of registrations) {
      registerProvider(registration.id, registration.adapter)
      registered.push(registration.id)
    }
    return registered
  } catch (error) {
    for (const providerId of registered) unregisterProvider(providerId)
    throw error
  }
}
