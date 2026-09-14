import { ipcRenderer } from 'electron'
import type { McpPlatform } from '../../src/core/application-control/localHostContracts'

export function createMcpApi(invoke: <T>(channel: string, payload?: unknown) => Promise<T>): McpPlatform {
  const listen = <T>(channel: string, handler: (payload: T) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: T): void => handler(payload)
    ipcRenderer.on(channel, listener)
    return () => { ipcRenderer.removeListener(channel, listener) }
  }
  return {
    status: () => invoke('mcp:status'), configure: (input) => invoke('mcp:configure', input),
    authorize: (input) => invoke('mcp:authorize', input), revoke: (input) => invoke('mcp:revoke', input),
    connectionConfig: (input) => invoke('mcp:config', input),
    registerHost: (input) => invoke('mcp:host:register', input), complete: (input) => invoke('mcp:host:complete', input),
    onRequest: (handler) => listen('mcp:host:request', handler), onCancel: (handler) => listen('mcp:host:cancel', handler), onRevoke: (handler) => listen('mcp:host:revoke', handler),
  }
}
