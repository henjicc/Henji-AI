import { FONTS_IPC, type FontsPlatform } from '../../src/platform/contracts/fonts'
export function createFontsApi(invoke: <T>(channel: string, payload?: unknown) => Promise<T>, subscribe: (channel: string, listener: (payload: unknown) => void) => () => void): FontsPlatform {
  return { list: () => invoke(FONTS_IPC.list), importFiles: () => invoke(FONTS_IPC.importFiles), remove: id => invoke(FONTS_IPC.remove, { id }), readFace: id => invoke(FONTS_IPC.readFace, { id }), onChanged: handler => subscribe(FONTS_IPC.changed, handler) }
}
