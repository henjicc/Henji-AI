/** 会话内失败记忆，不落盘、不保存凭据。30 分钟覆盖开通传播期并避免永久误拦。 */
export const PROVIDER_AVAILABILITY_TTL = 30 * 60_000
export interface ProviderAvailabilityFailure {
  code: 'PROVIDER_PRODUCT_NOT_ACTIVATED' | 'PROVIDER_MODEL_ACCESS_DENIED' | 'PROVIDER_INSUFFICIENT_BALANCE'
  providerId: string
  modelId?: string
  message: string
  expiresAt: number
}
const failures = new Map<string, ProviderAvailabilityFailure>()
const listeners = new Set<() => void>()
let expiryTimer: ReturnType<typeof setTimeout> | undefined
const key = (providerId: string, modelId?: string) => JSON.stringify([providerId, modelId ?? null])
function changed(): void {
  clearTimeout(expiryTimer)
  for (const [id, failure] of failures) if (failure.expiresAt <= Date.now()) failures.delete(id)
  if (failures.size && listeners.size) expiryTimer = setTimeout(changed, Math.max(1, Math.min(...[...failures.values()].map(item => item.expiresAt)) - Date.now()))
  for (const listener of listeners) listener()
}
export function subscribeProviderAvailability(listener: () => void): () => void {
  listeners.add(listener); changed()
  return () => { listeners.delete(listener); if (!listeners.size) clearTimeout(expiryTimer) }
}
export function getProviderAvailabilityFailure(providerId: string, modelId: string): ProviderAvailabilityFailure | undefined {
  const account = failures.get(key(providerId))
  const model = failures.get(key(providerId, modelId))
  return account && account.expiresAt > Date.now() ? account : model && model.expiresAt > Date.now() ? model : undefined
}
export function clearProviderAvailability(providerId: string, modelId?: string): void {
  for (const [id, failure] of failures) if (failure.providerId === providerId && (!modelId || !failure.modelId || failure.modelId === modelId)) failures.delete(id)
  changed()
}
/** SDK 的公开错误码可穿过 IPC message；不按英文供应商文案猜测故障。 */
export function rememberProviderFailure(providerId: string, modelId: string, modelName: string, reason: string): ProviderAvailabilityFailure | undefined {
  const match = /\[(provider_product_not_activated|provider_model_access_denied|provider_insufficient_balance)\]/i.exec(reason)
  if (!match) return undefined
  const code = match[1].toUpperCase() as ProviderAvailabilityFailure['code']
  const account = code === 'PROVIDER_INSUFFICIENT_BALANCE'
  const failure: ProviderAvailabilityFailure = { code, providerId, ...(account ? {} : { modelId }),
    message: `${account ? '' : `${modelName}：`}${reason.replace(/\[[a-z_]+\]\s*/gi, '')}`, expiresAt: Date.now() + PROVIDER_AVAILABILITY_TTL }
  failures.set(key(providerId, account ? undefined : modelId), failure); changed()
  return failure
}
