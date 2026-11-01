import { beforeEach, expect, it, vi } from 'vitest'
import { GENERIC_FONT_FACES } from '@/core/fonts/catalog'
import { captureTextFontSnapshot } from './textFontSnapshot'
const mock = vi.hoisted(() => ({ revision: 1, read: vi.fn(), faces: [] as import('@/core/fonts/catalog').FontFaceInfo[] }))
vi.mock('./fonts', async importOriginal => ({ ...await importOriginal<typeof import('./fonts')>(), loadFontLibrary: async () => ({ revision: mock.revision, faces: mock.faces }) }))
vi.mock('./runtime', () => ({ getPlatform: () => ({ fonts: { readFace: mock.read } }) }))
beforeEach(() => {
  mock.revision = 1
  const base = { ...GENERIC_FONT_FACES[0], id: 'regular', family: 'Arial', fullName: 'Arial', localizedFamily: 'Arial', aliases: [] }
  mock.faces = [base, { ...base, id: 'bold', weight: 700, fullName: 'Arial Bold', variation: { wght: 700 } }]
  mock.read.mockReset().mockImplementation(async id => ({ face: mock.faces.find(face => face.id === id), bytes: new Uint8Array([1, 2, 3]) }))
})
it('宿主按冻结策略选中的字体 ID 读取，并转交字重变体', async () => {
  const snapshot = await captureTextFontSnapshot('win32')
  const payload = await snapshot.read({ family: 'sans-serif', weight: 700, id: 'bold' })
  expect(mock.read).toHaveBeenCalledWith('bold')
  expect(payload?.variations).toEqual({ wght: 700 })
  expect(snapshot.faces).toEqual(mock.faces)
  expect(await snapshot.read({ family: 'unknown', id: 'unknown' })).toBeUndefined()
  snapshot.close()
  await expect(snapshot.read({ family: 'Arial', id: 'regular' })).rejects.toThrow('释放')
})
it('固定快照在目录变化后仍读取同一清单，包括尚未读取的字体', async () => {
  const faces = mock.faces
  const sources = Object.fromEntries(faces.map(face => [face.id, { face, path: 'font.ttf', index: 0, signature: '3:0' }]))
  const snapshot = await captureTextFontSnapshot('win32', Promise.resolve({ revision: 1, faces, sources }))
  mock.read.mockImplementation(async id => ({ face: faces.find(face => face.id === id), bytes: new Uint8Array([1, 2, 3]) }))
  const first = await snapshot.read({ family: 'Arial', id: 'regular' })
  mock.revision++; mock.faces = []
  const later = await snapshot.read({ family: 'Arial', weight: 700, id: 'bold' })
  const again = await snapshot.read({ family: 'Arial', id: 'regular' })
  expect(later?.variations).toEqual({ wght: 700 })
  expect(again?.bytes).toEqual(first?.bytes)
  expect(again?.bytes).not.toBe(first?.bytes)
  expect(mock.read.mock.calls).toEqual([['regular', sources.regular], ['bold', sources.bold]])
  snapshot.close()
})
it('读取失败允许重试；租约关闭后拒收迟到字节', async () => {
  const snapshot = await captureTextFontSnapshot('win32')
  mock.read.mockRejectedValueOnce(new Error('读取失败'))
  await expect(snapshot.read({ family: 'Arial', id: 'regular' })).rejects.toThrow('读取失败')
  expect(await snapshot.read({ family: 'Arial', id: 'regular' })).toBeDefined()
  let finish!: (payload: unknown) => void
  mock.read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const pending = snapshot.read({ family: 'Arial', id: 'regular' })
  snapshot.close()
  finish({ face: mock.faces[0], bytes: new Uint8Array([1]) })
  await expect(pending).rejects.toThrow('释放')
})
