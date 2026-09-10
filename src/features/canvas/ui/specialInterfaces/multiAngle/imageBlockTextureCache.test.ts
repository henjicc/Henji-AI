import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ files: new Map<string, string>(), pixel: 1, failRead: false, failWrite: false,
  bake: vi.fn(() => ({ left: 'data:image/png;base64,AQ==', right: 'data:image/png;base64,Ag==', top: 'data:image/png;base64,Aw==', bottom: 'data:image/png;base64,BA==', back: 'data:image/png;base64,BQ==' })) }))
vi.mock('./imageBlockTextures', () => ({ sampleImageBlock: () => new Uint8ClampedArray([state.pixel, 2, 3, 255]), bakeImageBlockTextures: state.bake }))
vi.mock('@/utils/dataPath', () => ({ getThumbnailsPath: async () => '/cache' }))
vi.mock('@/core/logging', () => ({ createLogger: () => ({ debug: vi.fn(), warn: vi.fn() }) }))
vi.mock('@/platform/desktopApi', () => ({
  isDesktopShell: () => true, join: async (...parts: string[]) => parts.join('/'), mkdir: async () => {},
  exists: async (path: string) => state.files.has(path),
  readTextFile: async (path: string) => { if (state.failRead) throw new Error('read failed'); return state.files.get(path)! },
  writeTextFile: async (path: string, text: string) => { if (state.failWrite) throw new Error('write failed'); state.files.set(path, text) },
}))
const image = { naturalWidth: 300, naturalHeight: 600 } as HTMLImageElement
beforeEach(() => { vi.resetModules(); vi.stubGlobal('crypto', webcrypto); state.files.clear(); state.pixel = 1; state.failRead = false; state.failWrite = false; state.bake.mockClear() })
afterEach(() => { vi.unstubAllGlobals() })

describe('图片块共享与持久缓存', () => {
  it('同内容并发只烘焙一次，再打开画布立即复用；清空内存后从磁盘恢复', async () => {
    const cache = await import('./imageBlockTextureCache')
    const [first, second] = await Promise.all([cache.getImageBlockAppearance('one', image), cache.getImageBlockAppearance('two', image)])
    expect(first.textures).toBe(second.textures)
    expect(state.bake).toHaveBeenCalledTimes(1)
    expect(cache.peekImageBlockAppearance('one')).toBe(first)
    await cache.getImageBlockAppearance('one', image)
    vi.resetModules()
    const reopened = await import('./imageBlockTextureCache')
    expect(await reopened.getImageBlockAppearance('one', image)).toEqual(first)
    expect(state.bake).toHaveBeenCalledTimes(1)
  })
  it('同一地址图片内容或比例变化会失效，不返回旧贴图', async () => {
    const cache = await import('./imageBlockTextureCache')
    await cache.getImageBlockAppearance('one', image)
    state.pixel = 8
    await cache.getImageBlockAppearance('one', image)
    const next = await cache.getImageBlockAppearance('one', { naturalWidth: 600, naturalHeight: 300 } as HTMLImageElement)
    expect(next.aspect).toBe(2)
    expect(state.bake).toHaveBeenCalledTimes(3)
  })
  it('损坏缓存重建；读写失败不阻止显示或内存复用', async () => {
    let cache = await import('./imageBlockTextureCache')
    await cache.getImageBlockAppearance('one', image)
    for (const key of state.files.keys()) state.files.set(key, '{broken')
    vi.resetModules(); cache = await import('./imageBlockTextureCache')
    await cache.getImageBlockAppearance('one', image)
    expect(state.bake).toHaveBeenCalledTimes(2)
    state.failRead = true; state.failWrite = true
    vi.resetModules(); cache = await import('./imageBlockTextureCache')
    await expect(cache.getImageBlockAppearance('one', image)).resolves.toMatchObject({ aspect: 0.5 })
    await cache.getImageBlockAppearance('one', image)
    expect(state.bake).toHaveBeenCalledTimes(3)
  })
  it('内存有上限，淘汰后仍可从持久缓存恢复', async () => {
    const cache = await import('./imageBlockTextureCache')
    for (let i = 1; i <= 55; i++) { state.pixel = i; await cache.getImageBlockAppearance(`image-${i}`, image) }
    expect(cache.peekImageBlockAppearance('image-1')).toBeUndefined()
    expect(cache.peekImageBlockAppearance('image-55')).toBeDefined()
    expect(state.files.size).toBeLessThanOrEqual(256)
  })
})
