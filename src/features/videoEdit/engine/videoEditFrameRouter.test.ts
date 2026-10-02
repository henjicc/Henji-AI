import { describe, expect, it, vi } from 'vitest'
import type { VideoEditMedia } from '@/core/videoEdit/document'
import { VideoEditFrameCache } from './videoEditFrameCache'
import { VideoEditFrameRouter, type VideoEditNativeCapableBackend } from './videoEditFrameRouter'
import type { VideoEditFrameSeeker, VideoEditFrameSource } from './videoEditFrameSource'

/** A backend that records opens/releases; `decodable` is the browser's answer for the file. */
function fakeBackend(name: string, options: { decodable?: boolean; unreadable?: boolean; reads?: boolean } = {}) {
  const log: string[] = []
  let next = 0
  const source = (key: string): VideoEditFrameSource => ({ codec: name, clipFrames: () => undefined, clipAudio: () => undefined, schedule: async function* () {}, decodable: async () => options.decodable ?? true, ...({ key } as object) })
  const backend: VideoEditNativeCapableBackend & { log: string[] } = {
    log,
    reads: () => options.reads ?? true,
    open: media => {
      const key = `${name}-${++next}`; log.push(`open ${key} ${media.id}`)
      return { key, ready: options.unreadable ? Promise.reject(new Error('404')) : Promise.resolve(source(key)) }
    },
    release: key => { log.push(`release ${key}`) },
    seeker: (): VideoEditFrameSeeker => { log.push('seeker'); return { sample: async () => ({ hit: name === 'native' }), dispose: async () => { log.push('seeker disposed') } } },
  }
  return backend
}
const media = (id = 'a'): VideoEditMedia => ({ id, name: '素材', path: `henji-media://local/${id}`, kind: 'video', width: 1920, height: 1080, durationSeconds: 5 })

describe('剪辑渲染的解码路由', () => {
  it('原生声音接通前：浏览器能完整解的文件整体走浏览器，并复用询问时打开的同一次解析；决定只做一次并记日志', async () => {
    const browser = fakeBackend('browser'); const native = fakeBackend('native'); const log = vi.fn()
    const router = new VideoEditFrameRouter(browser, native, { nativeAvailable: true }, log)
    const first = router.open(media()); const second = router.open(media())
    expect((await first.ready).codec).toBe('browser'); expect((await second.ready).codec).toBe('browser')
    expect(browser.log).toEqual(['open browser-1 a', 'open browser-2 a']); expect(native.log).toEqual([])
    expect(log).toHaveBeenCalledOnce()
    expect(log).toHaveBeenCalledWith('info', expect.any(String), 'video_edit.decode.backend.selected', { mediaId: 'a', backend: 'browser', browser: 'decodes', nativeAvailable: true })
    router.release(first.key); router.release(second.key)
    expect(browser.log.slice(2)).toEqual(['release browser-1', 'release browser-2'])
  })

  it('只有原生能解（浏览器解不了或读不了）走原生，询问用的浏览器解析立即释放；同一文件的定位器也走原生', async () => {
    const browser = fakeBackend('browser', { decodable: false }); const native = fakeBackend('native')
    const router = new VideoEditFrameRouter(browser, native, { nativeAvailable: true })
    const opened = router.open(media())
    expect((await opened.ready).codec).toBe('native')
    expect(browser.log).toEqual(['open browser-1 a', 'release browser-1'])
    expect((await router.seeker(media(), new VideoEditFrameCache(1), vi.fn()).sample(0, 0)).hit).toBe(true)
    router.release(opened.key); expect(native.log).toEqual(['open native-1 a', 'seeker', 'release native-1'])
    // A file the browser cannot even read (moved, MXF) is asked again on its next open.
    const unreadable = fakeBackend('browser', { unreadable: true })
    const again = new VideoEditFrameRouter(unreadable, fakeBackend('native'), { nativeAvailable: true })
    expect((await again.open(media('b')).ready).codec).toBe('native'); expect((await again.open(media('b')).ready).codec).toBe('native')
    expect(unreadable.log.filter(entry => entry.startsWith('open'))).toHaveLength(2)
  })

  it('原生不可用或读不到本地文件时不询问，直接用浏览器；诊断强制的后端不询问也不替换', async () => {
    const browser = fakeBackend('browser'); const native = fakeBackend('native', { reads: false })
    expect((await new VideoEditFrameRouter(browser, undefined, { nativeAvailable: false }).open(media()).ready).codec).toBe('browser')
    expect((await new VideoEditFrameRouter(browser, native, { nativeAvailable: true }).open(media()).ready).codec).toBe('browser')
    expect(browser.log).toEqual(['open browser-1 a', 'open browser-2 a'])
    const forcedNative = new VideoEditFrameRouter(fakeBackend('browser'), fakeBackend('native'), { nativeAvailable: true, forced: 'native' })
    expect((await forcedNative.open(media()).ready).codec).toBe('native')
    await expect(new VideoEditFrameRouter(fakeBackend('browser'), undefined, { nativeAvailable: false, forced: 'native' }).open(media()).ready).rejects.toThrow('当前无法播放')
    const forcedBrowser = fakeBackend('browser', { decodable: false })
    expect((await new VideoEditFrameRouter(forcedBrowser, fakeBackend('native'), { nativeAvailable: true, forced: 'browser' }).open(media()).ready).codec).toBe('browser')
    expect(forcedBrowser.log).toEqual(['open browser-1 a'])
  })

  it('原生成为主路径后不询问浏览器；原生打开失败后此文件后续改用后备解码，浏览器确定解不了或强制时不换', async () => {
    const browser = fakeBackend('browser'); const native = fakeBackend('native'); const log = vi.fn()
    const router = new VideoEditFrameRouter(browser, native, { nativeAvailable: true }, log, true)
    expect((await router.open(media()).ready).codec).toBe('native'); expect(browser.log).toEqual([])
    router.nativeFailed(media(), new Error('服务退出')); await Promise.resolve(); await Promise.resolve()
    expect((await router.open(media()).ready).codec).toBe('browser')
    expect(log).toHaveBeenLastCalledWith('warn', expect.any(String), 'video_edit.decode.native.fallback', { mediaId: 'a', error: '服务退出' })
    const onlyNative = new VideoEditFrameRouter(fakeBackend('browser', { decodable: false }), fakeBackend('native'), { nativeAvailable: true })
    expect((await onlyNative.open(media()).ready).codec).toBe('native')
    onlyNative.nativeFailed(media(), new Error('x')); await Promise.resolve(); await Promise.resolve()
    expect((await onlyNative.open(media()).ready).codec).toBe('native')
  })

  it('决定前就释放的打开不会再打开底层后端；关闭时释放未被使用的询问解析', async () => {
    const browser = fakeBackend('browser'); const router = new VideoEditFrameRouter(browser, fakeBackend('native'), { nativeAvailable: true })
    const opened = router.open(media()); router.release(opened.key)
    await expect(opened.ready).rejects.toThrow('预览已关闭')
    expect(browser.log).toEqual(['open browser-1 a'])
    router.dispose(); expect(browser.log).toEqual(['open browser-1 a', 'release browser-1'])
    const seeker = new VideoEditFrameRouter(fakeBackend('browser'), undefined, { nativeAvailable: false }).seeker(media(), new VideoEditFrameCache(1), vi.fn())
    await seeker.dispose(); await expect(seeker.sample(0, 0)).rejects.toThrow('预览解码已关闭')
  })
})

it('路由层不认识的后端名称不出现在用户提示里', async () => {
  const router = new VideoEditFrameRouter(fakeBackend('browser', { decodable: false }), undefined, { nativeAvailable: false, forced: 'native' })
  const error = await router.open(media()).ready.catch((caught: Error) => caught)
  expect(String(error)).not.toMatch(/原生|浏览器|native|browser/i)
})
