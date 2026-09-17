import { ipcRenderer } from 'electron'
import type { ApplicationHostPlatform } from '../../src/core/application-control/localHostContracts'

export function createApplicationControlApi(invoke: <T>(channel: string, payload?: unknown) => Promise<T>): ApplicationHostPlatform {
  const listen = <T>(channel: string, handler: (payload: T) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: T): void => handler(payload)
    ipcRenderer.on(channel, listener)
    return () => { ipcRenderer.removeListener(channel, listener) }
  }
  return {
    publishContext: input => invoke('application:host:context', input),
    registerHost: input => invoke('application:host:register', input),
    complete: input => invoke('application:host:complete', input),
    onRequest: handler => listen('application:host:request', handler),
    onCancel: handler => listen('application:host:cancel', handler),
    onRevoke: handler => listen('application:host:revoke', handler),
  }
}
