/**
 * 各 AI 供应商适配器（PPIO / Fal / ModelScope / KIE / APIMart / Grsai / Bailian / Volcengine）。
 *
 * 分发方式是注册表而不是静态 `switch`（见 docs/task/模型SDK抽离/重要记录.md 记录 005）：
 * `registerProvider(id, adapter)` 把一个供应商适配器登记进内存 Map，`resolveProvider(id)` /
 * `executeGenerate` / `executeContinuePolling` 按 id 查表分发。这是为「新增供应商无需改这个
 * 文件本身的 switch 分支」的可扩展性铺路——本任务（2.3）只做这一层机制改造，8 个内置供应商
 * 的行为与迁移前完全一致，全部在本文件底部自注册。
 */
import { AiRuntimeError } from '../runtime/AiRuntimeError'
import type {
  ProviderContinuePollingInput,
  ProviderExecutionInput,
  ProviderExecutionResult,
} from '../types/runtime'
import {
  BUILTIN_PROVIDER_IDS,
  type BuiltinProviderId,
  type ProviderId,
} from '../types/model'

export { resolvePpioMediaRewriteMode, type PpioMediaRewriteMode } from './ppio-media'
export { testProviderConnection } from './connection'
export { fetchProvider } from './provider-fetch'
export {
  buildApiMartEndpoints,
  markApiMartEndpointReachable,
  resetApiMartEndpointPreference,
  warmApiMartEndpointPreference,
} from './endpoints/apimart'
export {
  buildGrsaiEndpoints,
  markGrsaiEndpointReachable,
  resetGrsaiEndpointPreference,
  warmGrsaiEndpointPreference,
} from './endpoints/grsai'

export interface ProviderAdapter {
  execute(input: ProviderExecutionInput): Promise<ProviderExecutionResult>
  continuePolling(input: ProviderContinuePollingInput): Promise<ProviderExecutionResult>
}

const registry = new Map<ProviderId, ProviderAdapter>()
let builtinProvidersInitialized = false

/**
 * 内置 provider 在首次使用注册表时惰性装入，而不是在模块加载阶段执行注册调用。
 * 这样模块可被消费方安全 tree-shake，`sideEffects: false` 不会丢失仅靠副作用保留的初始化代码。
 */
function ensureBuiltinProvidersInitialized(): void {
  if (builtinProvidersInitialized) return
  for (const providerId of BUILTIN_PROVIDER_IDS) {
    registry.set(providerId, builtinProviders[providerId])
  }
  builtinProvidersInitialized = true
}

/**
 * 登记一个供应商适配器。
 *
 * 同一 id 重复注册会抛 `provider_already_registered`，避免扩展意外覆盖内置供应商。
 * 测试或插件卸载时应在 `finally`/`afterEach` 调用 `unregisterProvider` 清理自己的唯一 id。
 */
export function registerProvider(id: ProviderId, adapter: ProviderAdapter): void {
  ensureBuiltinProvidersInitialized()
  if (typeof id !== 'string' || id.trim().length === 0) {
    throw new AiRuntimeError('invalid_provider_id', 'Provider id must be a non-empty string')
  }
  if (registry.has(id)) {
    throw new AiRuntimeError('provider_already_registered', `Provider already registered: ${id}`)
  }
  registry.set(id, adapter)
}

/** 注销指定供应商；存在并删除时返回 `true`，未登记时返回 `false`。 */
export function unregisterProvider(id: ProviderId): boolean {
  ensureBuiltinProvidersInitialized()
  return registry.delete(id)
}

/** 返回当前已登记 provider id 的快照；修改返回数组不会影响注册表。 */
export function listProviders(): ProviderId[] {
  ensureBuiltinProvidersInitialized()
  return [...registry.keys()]
}

/** 按 id 查找已登记的供应商适配器；找不到时抛 `unknown_provider`，不静默返回 `undefined`。 */
export function resolveProvider(id: ProviderId): ProviderAdapter {
  ensureBuiltinProvidersInitialized()
  const adapter = registry.get(id)
  if (!adapter) {
    throw new AiRuntimeError('unknown_provider', `Unknown provider: ${id}`)
  }
  return adapter
}

export async function executeGenerate(
  providerId: ProviderId,
  input: ProviderExecutionInput
): Promise<ProviderExecutionResult> {
  return await resolveProvider(providerId).execute(input)
}

export async function executeContinuePolling(
  providerId: ProviderId,
  input: ProviderContinuePollingInput
): Promise<ProviderExecutionResult> {
  return await resolveProvider(providerId).continuePolling(input)
}

// ---------------------------------------------------------------------------
// 内置供应商自注册
// ---------------------------------------------------------------------------

import * as apimart from './apimart'
import * as bailian from './bailian'
import * as fal from './fal'
import * as grsai from './grsai'
import * as kie from './kie'
import * as modelscope from './modelscope'
import * as ppio from './ppio'
import * as volcengine from './volcengine'

const builtinProviders: Record<BuiltinProviderId, ProviderAdapter> = {
  apimart,
  bailian,
  volcengine,
  ppio,
  kie,
  modelscope,
  fal,
  grsai,
}
