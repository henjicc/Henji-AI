import type { EmbeddedAgentPlatform } from '@/core/assistant/embeddedAgent'
import type { HenjiEmbeddedAgentApi } from '../../../../electron/preload/api-assistant'
import { unwrapIpcResult } from './ipcResult'
export function createElectronEmbeddedAgent(): EmbeddedAgentPlatform {
  const native = (): HenjiEmbeddedAgentApi => {
    const api = window.henjiNative?.embeddedAgent
    if (!api) throw new Error('智能助手需要桌面应用，请重启后再试。')
    return api
  }
  return {
    snapshot: () => native().snapshot(), models: () => native().models(), prompt: async (input) => unwrapIpcResult(await native().prompt(input)),
    cancel: () => native().cancel(), newSession: () => native().newSession(), sessions: () => native().sessions(),
    openSession: (id) => native().openSession(id), onSnapshot: (handler) => native().onSnapshot(handler),
  }
}
