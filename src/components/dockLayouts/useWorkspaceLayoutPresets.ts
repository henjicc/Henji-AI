import { useEffect, useState, useSyncExternalStore } from 'react'
import type { DockviewApi, SerializedDockview } from 'dockview-react'
import { workspaceLayoutController, type WorkspaceLayoutSnapshot } from '@/services/workspaceLayouts/workspaceLayoutService'

const boundApis = new WeakSet<DockviewApi>()
export interface WorkspaceLayoutPresets extends WorkspaceLayoutSnapshot {
  apply(id: string): Promise<void>
  saveAs(name: string): Promise<string>
  rename(id: string, name: string): Promise<void>
  remove(id: string): Promise<void>
  overwrite(id?: string): Promise<void>
  resetActive(): Promise<void>
  retrySave(): Promise<void>
}

/** 绑定与菜单订阅分离，多个入口不会重复恢复布局或重复订阅 Dockview。 */
export function bindWorkspaceLayoutDock(workspaceId: string, api: DockviewApi, options: {
  beforeApply?: () => void
  afterApply?: (layout: SerializedDockview) => void
  onRestored?: () => void
  capture?: () => SerializedDockview
  capturePreset?: () => SerializedDockview
  onError: (error: unknown) => void
}): () => void {
  const controller = workspaceLayoutController(workspaceId)
  if (boundApis.has(api)) throw new Error('停靠布局已经绑定')
  boundApis.add(api)
  let disposed = false
  let applying = false
  let lastCapture = ''
  let timer: ReturnType<typeof setTimeout> | undefined
  let detach = (): void => {}
  let unsubscribe = (): void => {}
  const capture = options.capture ?? (() => api.toJSON())
  const apply = (layout: SerializedDockview, restoring = false): void => {
    clearTimeout(timer); timer = undefined; applying = true
    try {
      if (!restoring) options.beforeApply?.()
      api.fromJSON(layout, { reuseExistingPanels: true })
      options.afterApply?.(layout)
      lastCapture = JSON.stringify(capture())
    } finally { applying = false }
  }
  // 默认布局立即可见；异步配置读取完成前不订阅保存，避免空白初始布局覆盖用户配置。
  const initial = controller.getSnapshot()
  apply(initial.current, true)
  // 切换与重置预设随时可用（配置读失败时也能恢复默认布局）；只有自动保存要等配置读完。
  detach = controller.attach(apply, options.capturePreset ?? capture)
  const connect = (): void => {
    if (disposed) return
    if (controller.getSnapshot().current !== initial.current) apply(controller.getSnapshot().current, true)
    options.onRestored?.()
    const event = api.onDidLayoutChange(() => {
      if (applying) return
      const serialized = JSON.stringify(capture())
      if (serialized === lastCapture) return
      lastCapture = serialized
      clearTimeout(timer)
      timer = setTimeout(() => { timer = undefined; void controller.updateCurrent(capture()).catch(options.onError) }, 200)
    })
    unsubscribe = () => event.dispose()
  }
  if (initial.ready) connect()
  else void controller.load().then(connect).catch(options.onError)
  return () => {
    disposed = true; unsubscribe(); detach(); boundApis.delete(api)
    if (timer !== undefined) { clearTimeout(timer); void controller.updateCurrent(capture()).catch(options.onError) }
  }
}

export function useWorkspaceLayoutPresets(workspaceId: string, dockApi?: DockviewApi | null): WorkspaceLayoutPresets {
  const controller = workspaceLayoutController(workspaceId)
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const [bindingError, setBindingError] = useState<string | null>(null)
  useEffect(() => { void controller.load().catch(() => undefined) }, [controller])
  useEffect(() => {
    if (!dockApi || boundApis.has(dockApi)) return
    setBindingError(null)
    return bindWorkspaceLayoutDock(workspaceId, dockApi, { onError: () => setBindingError('布局无法恢复或保存，请重试。') })
  }, [workspaceId, dockApi])
  return {
    ...snapshot,
    error: bindingError ?? snapshot.error,
    apply: (id: string) => controller.apply(id),
    saveAs: (name: string) => controller.saveAs(name),
    rename: (id: string, name: string) => controller.rename(id, name),
    remove: (id: string) => controller.remove(id),
    overwrite: (id?: string) => controller.overwrite(id),
    resetActive: () => controller.resetActive(),
    retrySave: () => controller.retrySave(),
  }
}
