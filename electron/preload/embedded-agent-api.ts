import { ipcRenderer } from 'electron'
import type { EmbeddedAgentPlatform, EmbeddedAgentSnapshot } from '../../src/core/assistant/embeddedAgent'
export function createEmbeddedAgentApi(invoke: <T>(channel: string, payload?: unknown) => Promise<T>): EmbeddedAgentPlatform {
  return {
    snapshot: () => invoke('embedded-agent:snapshot'), models: () => invoke('embedded-agent:models'),
    prompt: (input) => invoke('embedded-agent:prompt', input), cancel: () => invoke('embedded-agent:cancel'),
    newSession: () => invoke('embedded-agent:new'), sessions: () => invoke('embedded-agent:sessions'), openSession: (id) => invoke('embedded-agent:open', id),
    onSnapshot: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, value: EmbeddedAgentSnapshot): void => handler(value)
      ipcRenderer.on('embedded-agent:snapshot', listener)
      return () => { ipcRenderer.removeListener('embedded-agent:snapshot', listener) }
    },
  }
}
