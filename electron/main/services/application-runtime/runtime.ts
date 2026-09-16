import { ApplicationHostBridge } from './applicationHostBridge'
import { ApplicationToolDispatcher } from './applicationToolDispatcher'
import { McpOperationCoordinator } from './operationCoordinator'
import { McpOperationStore } from './operationStore'
import { recoverPersistedGenerationOperation } from './persistedOperationRecovery'
import type { McpAccess } from './toolCatalog'
import { getDb } from '../db'

const embeddedCallers = new Map<string, McpAccess>()
let externalAuthority: ((id: string) => void) | undefined
let runtime: { host: ApplicationHostBridge; operations: McpOperationCoordinator; embedded: ApplicationToolDispatcher } | undefined

/** 应用生命周期持有账本和宿主；协议适配器只提供调用者授权。 */
export function initializeApplicationRuntime() {
  if (runtime) return runtime
  const operations: McpOperationCoordinator = new McpOperationCoordinator(new McpOperationStore(getDb()),
    record => recoverPersistedGenerationOperation(getDb(), record), () => host.writableEntityTypes())
  const host: ApplicationHostBridge = new ApplicationHostBridge(id => {
    if (embeddedCallers.has(id)) return
    if (!externalAuthority) throw new Error('调用者未获授权。')
    externalAuthority(id)
  }, operations)
  const embedded = new ApplicationToolDispatcher({
    assertActive: id => { if (!embeddedCallers.has(id)) throw new Error('助手操作授权已结束。') },
    access: id => { const access = embeddedCallers.get(id); if (!access) throw new Error('助手操作授权已结束。'); return access },
  }, host, operations, 0, 'embedded')
  runtime = { host, operations, embedded }
  return runtime
}

export function getApplicationRuntime() {
  if (!runtime) throw new Error('应用运行时尚未启动。')
  return runtime
}

export function registerExternalApplicationAuthority(authorize: (id: string) => void): void { externalAuthority = authorize }

export function createEmbeddedApplicationClient(callerId: string, access: McpAccess) {
  const { host, embedded } = getApplicationRuntime()
  if (embeddedCallers.has(callerId)) throw new Error('调用者身份已在使用。')
  embeddedCallers.set(callerId, access)
  return {
    catalog: () => embedded.catalog(callerId).tools,
    call: (name: string, input: Record<string, unknown>, signal: AbortSignal) => embedded.call(callerId, name, input, signal),
    close: () => { embeddedCallers.delete(callerId); host.revoke(callerId) },
  }
}
