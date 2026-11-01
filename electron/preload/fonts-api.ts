import { FONTS_IPC, type FontsPlatform } from '../../src/platform/contracts/fonts'
export function createFontsApi(invoke: <T>(channel: string, payload?: unknown) => Promise<T>, subscribe: (channel: string, listener: (payload: unknown) => void) => () => void): FontsPlatform {
  return { list: fixed => invoke(FONTS_IPC.list, fixed ? { fixed } : undefined), importFiles: () => invoke(FONTS_IPC.importFiles), remove: id => invoke(FONTS_IPC.remove, { id }), readFace: (id, source) => invoke(FONTS_IPC.readFace, { id, source }), onChanged: handler => subscribe(FONTS_IPC.changed, handler) }
}
