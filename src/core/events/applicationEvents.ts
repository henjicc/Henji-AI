/**
 * 进程内应用事件总线。
 *
 * 这里只传不含密钥、提示词和媒体内容的事实事件，供首次引导等跨界面流程观察。
 * 业务服务不反向依赖具体 UI，也不需要知道当前有没有引导层挂载。
 */
export interface ApplicationEventMap {
  'provider-key-configured': {
    providerId: string
  }
  'provider-key-removed': {
    providerId: string
  }
  'provider-connection-tested': {
    providerId: string
    verified: boolean
  }
  'generation-completed': {
    modelId: string
    providerId?: string
  }
  'workspace-opened': {
    workspaceId: string
  }
}

type ApplicationEventName = keyof ApplicationEventMap
type ApplicationEventListener<TName extends ApplicationEventName> = (
  payload: ApplicationEventMap[TName]
) => void

const listeners = new Map<ApplicationEventName, Set<(payload: never) => void>>()

export function emitApplicationEvent<TName extends ApplicationEventName>(
  name: TName,
  payload: ApplicationEventMap[TName]
): void {
  listeners.get(name)?.forEach((listener) => listener(payload as never))
}

export function subscribeApplicationEvent<TName extends ApplicationEventName>(
  name: TName,
  listener: ApplicationEventListener<TName>
): () => void {
  const registered = listener as (payload: never) => void
  const current = listeners.get(name) ?? new Set<(payload: never) => void>()
  current.add(registered)
  listeners.set(name, current)
  return () => {
    current.delete(registered)
    if (current.size === 0) listeners.delete(name)
  }
}
