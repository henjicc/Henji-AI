import { expect, it, vi } from 'vitest'
import { GENERIC_FONT_FACES, type FontFaceInfo } from '../core/fonts/catalog'
import { loadFontLibrary, readFontPayload } from './fonts'
const native = vi.hoisted(() => ({ read: vi.fn(), faces: [] as FontFaceInfo[] }))
vi.mock('./runtime', () => ({ getPlatform: () => ({ fonts: { list: async () => ({ faces: native.faces, revision: 1 }), readFace: native.read, onChanged: () => () => undefined }, settings: { get: async () => null } }) }))
it('大字体字节缓存按内存淘汰旧预览；热项复用，淘汰项可重新读取', async () => {
  const a = { ...GENERIC_FONT_FACES[0], id: 'a'.repeat(64), family: 'A', fullName: 'A', localizedFamily: 'A', aliases: [] }; const b = { ...a, id: 'b'.repeat(64), family: 'B', fullName: 'B', localizedFamily: 'B' }
  native.faces = [a, b]; await loadFontLibrary()
  native.read.mockImplementation(async (id: string) => ({ face: id === a.id ? a : b, bytes: new Uint8Array(33 * 1024 * 1024) }))
  await readFontPayload(a); await readFontPayload(a); expect(native.read).toHaveBeenCalledTimes(1)
  await readFontPayload(b); await readFontPayload(b); expect(native.read).toHaveBeenCalledTimes(2)
  await readFontPayload(a); expect(native.read).toHaveBeenCalledTimes(3)
})
