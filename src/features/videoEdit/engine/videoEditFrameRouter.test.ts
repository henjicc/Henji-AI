import { describe, expect, it, vi } from 'vitest'
import type { VideoEditMedia } from '@/core/videoEdit/document'
import { VideoEditFrameCache } from './videoEditFrameCache'
import { VideoEditFrameRouter, type VideoEditNativeCapableBackend } from './videoEditFrameRouter'
import type { VideoEditAudioChunk, VideoEditFrameSeeker, VideoEditFrameSource } from './videoEditFrameSource'
import { VideoEditNativeFailure } from './videoEditNativeFailure'

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
  it('原生不是主路径时：浏览器能完整解的文件整体走浏览器，并复用询问时打开的同一次解析；决定只做一次并记日志', async () => {
    const browser = fakeBackend('browser'); const native = fakeBackend('native'); const log = vi.fn()
    const router = new VideoEditFrameRouter(browser, native, { nativeAvailable: true }, log, false)
    const first = router.open(media()); const second = router.open(media())
    expect((await first.ready).codec).toBe('browser'); expect((await second.ready).codec).toBe('browser')
    expect(browser.log).toEqual(['open browser-1 a', 'open browser-2 a']); expect(native.log).toEqual([])
    expect(log).toHaveBeenCalledOnce()
    expect(log).toHaveBeenCalledWith('info', expect.any(String), 'video_edit.decode.backend.selected', { mediaId: 'a', backend: 'browser', browser: 'decodes', nativeAvailable: true })
    router.release(first.key); router.release(second.key)
    expect(browser.log.slice(2)).toEqual(['release browser-1', 'release browser-2'])
  })

  it('原生不是主路径时只有原生能解（浏览器解不了或读不了）走原生，询问用的浏览器解析立即释放；同一文件的定位器也走原生', async () => {
    const browser = fakeBackend('browser', { decodable: false }); const native = fakeBackend('native')
    const router = new VideoEditFrameRouter(browser, native, { nativeAvailable: true }, () => {}, false)
    const opened = router.open(media())
    expect((await opened.ready).codec).toBe('native')
    expect(browser.log).toEqual(['open browser-1 a', 'release browser-1'])
    expect((await router.seeker(media(), new VideoEditFrameCache(1), vi.fn()).sample(0, 0)).hit).toBe(true)
    router.release(opened.key); expect(native.log).toEqual(['open native-1 a', 'seeker', 'release native-1'])
    // A file the browser cannot even read (moved, MXF) is asked again on its next open.
    const unreadable = fakeBackend('browser', { unreadable: true })
    const again = new VideoEditFrameRouter(unreadable, fakeBackend('native'), { nativeAvailable: true }, () => {}, false)
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

  it('原生是主路径（默认）时不询问浏览器，直接走原生', async () => {
    const browser = fakeBackend('browser'); const native = fakeBackend('native')
    const router = new VideoEditFrameRouter(browser, native, { nativeAvailable: true })
    expect((await router.open(media()).ready).codec).toBe('native'); expect(browser.log).toEqual([])
  })

  it('决定前就释放的打开不会再打开底层后端；关闭时释放未被使用的询问解析', async () => {
    const browser = fakeBackend('browser'); const router = new VideoEditFrameRouter(browser, fakeBackend('native'), { nativeAvailable: true }, () => {}, false)
    const opened = router.open(media()); router.release(opened.key)
    await expect(opened.ready).rejects.toThrow('预览已关闭')
    expect(browser.log).toEqual(['open browser-1 a'])
    router.dispose(); expect(browser.log).toEqual(['open browser-1 a', 'release browser-1'])
    const seeker = new VideoEditFrameRouter(fakeBackend('browser'), undefined, { nativeAvailable: false }).seeker(media(), new VideoEditFrameCache(1), vi.fn())
    await seeker.dispose(); await expect(seeker.sample(0, 0)).rejects.toThrow('预览解码已关闭')
  })
})

describe('运行中原生失败的恢复（3.1）', () => {
  type Picture = { timestamp: number; duration: number; close: () => void; backend: string }
  const picture = (backend: string, timestamp: number): Picture => ({ timestamp, duration: 1 / 60, close: vi.fn(), backend })
  const serviceFailure = (): VideoEditNativeFailure => new VideoEditNativeFailure('素材「素材」的解码暂时中断，请稍后重试；如果一直出现，请重启软件。', 'service', 'PROCESS_EXITED')
  interface Script {
    decodable?: boolean
    frameAt?: (time: number) => Promise<Picture | null>
    frames?: (start: number) => AsyncGenerator<Picture, void, unknown>
    schedule?: (times: readonly number[]) => AsyncGenerator<Picture | null, void, unknown>
    chunks?: () => AsyncGenerator<VideoEditAudioChunk, void, unknown>
  }
  function scripted(name: string, script: Script) {
    const calls: string[] = []
    let resets = 0
    const source: VideoEditFrameSource = {
      codec: name,
      clipFrames: () => ({
        frameAt: time => { calls.push(`frameAt ${time}`); return (script.frameAt ?? (async (at: number) => picture(name, at)))(time) as never },
        frames: start => { calls.push(`frames ${start}`); return (script.frames ?? (async function* () {}))(start) as never },
      }),
      clipAudio: () => ({ chunks: () => { calls.push('chunks'); return (script.chunks ?? (async function* () {}))() } }),
      schedule: times => { calls.push(`schedule ${times.length}`); return (script.schedule ?? (async function* () {}))(times) as never },
      decodable: async () => script.decodable ?? true,
    }
    const backend: VideoEditNativeCapableBackend & { calls: string[]; resets: () => number } = {
      calls, resets: () => resets,
      reads: () => true,
      reset: () => { resets++ },
      open: () => ({ key: `${name}-key`, ready: Promise.resolve(source) }),
      release: () => {},
      seeker: (): VideoEditFrameSeeker => ({ sample: async time => { calls.push(`sample ${time}`); if (name === 'native' && script.frameAt) await script.frameAt(time); return { hit: false } }, dispose: async () => {} }),
    }
    return backend
  }
  const drain = async <T>(generator: AsyncGenerator<T, void, unknown>): Promise<T[]> => { const values: T[] = []; for await (const value of generator) values.push(value); return values }

  it('浏览器能解的文件：原生读取失败时这一次读取立即改由浏览器完成并记日志；冷却期内新读取走浏览器，之后回到原生并记恢复', async () => {
    let now = 0; let failing = true; const log = vi.fn()
    const native = scripted('native', { frameAt: async time => { if (failing) throw serviceFailure(); return picture('native', time) } })
    const browser = scripted('browser', {})
    const router = new VideoEditFrameRouter(browser, native, { nativeAvailable: true }, log, true, () => now)
    const clip = (await router.open(media()).ready).clipFrames()!
    expect(await clip.frameAt(1)).toMatchObject({ backend: 'browser', timestamp: 1 })
    expect(native.resets()).toBe(1)
    expect(log).toHaveBeenCalledWith('warn', expect.any(String), 'video_edit.decode.native.fallback', expect.objectContaining({ mediaId: 'a', kind: 'service', code: 'PROCESS_EXITED', retryInMs: 2000 }))
    expect(await clip.frameAt(2)).toMatchObject({ backend: 'browser' })
    expect(native.calls).toEqual(['frameAt 1'])
    failing = false; now = 2001
    expect(await clip.frameAt(3)).toMatchObject({ backend: 'native' })
    expect(log).toHaveBeenLastCalledWith('info', expect.any(String), 'video_edit.decode.native.restored', { mediaId: 'a', failures: 1 })
  })

  it('只有原生能解的文件：服务故障换新会话重试一次；文件故障与超出预算直接就地报告，不重试', async () => {
    let failures = 1; const log = vi.fn()
    const native = scripted('native', { frameAt: async time => { if (failures-- > 0) throw serviceFailure(); return picture('native', time) } })
    const router = new VideoEditFrameRouter(scripted('browser', { decodable: false }), native, { nativeAvailable: true }, log)
    const clip = (await router.open(media()).ready).clipFrames()!
    expect(await clip.frameAt(1)).toMatchObject({ backend: 'native' })
    expect(native.calls).toEqual(['frameAt 1', 'frameAt 1']); expect(native.resets()).toBe(1)
    expect(log).toHaveBeenCalledWith('warn', expect.any(String), 'video_edit.decode.native.retry', expect.objectContaining({ kind: 'service' }))
    failures = 2
    await expect(clip.frameAt(2)).rejects.toThrow('解码暂时中断')
    const fileFailure = new VideoEditNativeFailure('素材「素材」解码失败，请确认文件可用，或在项目素材中重新定位源文件。', 'file', 'DECODE_FAILED')
    const broken = scripted('native', { frameAt: async () => { throw fileFailure } })
    const budget = new VideoEditNativeFailure('同时读取的视频素材过多，请减少同时显示的视频后重试。', 'budget', 'BUDGET_EXCEEDED')
    const full = scripted('native', { frameAt: async () => { throw budget } })
    for (const [backend, error] of [[broken, fileFailure], [full, budget]] as const) {
      const clipOf = (await new VideoEditFrameRouter(scripted('browser', { decodable: false }), backend, { nativeAvailable: true }).open(media()).ready).clipFrames()!
      await expect(clipOf.frameAt(1)).rejects.toBe(error)
      expect(backend.calls).toEqual(['frameAt 1']); expect(backend.resets()).toBe(0)
    }
  })

  it('播放计划中途失败：已交付的时间不重复，余下的时间由后备继续，每个时间恰好一个结果', async () => {
    const native = scripted('native', { schedule: async function* (times) { yield picture('native', times[0]); yield picture('native', times[1]); throw serviceFailure() } })
    const browser = scripted('browser', { schedule: async function* (times) { for (const time of times) yield picture('browser', time) } })
    const router = new VideoEditFrameRouter(browser, native, { nativeAvailable: true }, () => {})
    const source = await router.open(media()).ready
    const pictures = await drain(source.schedule([0, 1, 2, 3]))
    expect(pictures.map(value => [value && (value as unknown as Picture).backend, value?.timestamp])).toEqual([['native', 0], ['native', 1], ['browser', 2], ['browser', 3]])
    expect(browser.calls).toEqual(['schedule 2'])
  })

  it('顺序读取中途失败：从最后交付的画面续读，重复的画面关闭不交付', async () => {
    const native = scripted('native', { frames: async function* () { yield picture('native', 0); yield picture('native', 0.5); throw serviceFailure() } })
    const repeated = picture('browser', 0.5)
    const browser = scripted('browser', { frames: async function* () { yield repeated; yield picture('browser', 1) } })
    const router = new VideoEditFrameRouter(browser, native, { nativeAvailable: true }, () => {})
    const clip = (await router.open(media()).ready).clipFrames()!
    expect((await drain(clip.frames(0))).map(value => [(value as unknown as Picture).backend, value.timestamp])).toEqual([['native', 0], ['native', 0.5], ['browser', 1]])
    expect(browser.calls).toEqual(['frames 0.5']); expect(repeated.close).toHaveBeenCalledOnce()
  })

  it('冷却期过后，仍在后备上运行的顺序读取与播放计划从下一画面回到原生，并在原生交付首个画面时记恢复', async () => {
    let now = 0; let nativeFails = true; const log = vi.fn()
    const native = scripted('native', {
      frames: async function* (start) { if (nativeFails) throw serviceFailure(); for (let time = start; time < 4; time += 0.5) yield picture('native', time) },
      schedule: async function* (times) { if (nativeFails) throw serviceFailure(); for (const time of times) yield picture('native', time) },
    })
    const browser = scripted('browser', {
      frames: async function* (start) { for (let time = start; time < 4; time += 0.5) { if (time >= 1) now = 2001; yield picture('browser', time) } },
      schedule: async function* (times) { for (const time of times) { if (time >= 2) now = 4001; yield picture('browser', time) } },
    })
    const router = new VideoEditFrameRouter(browser, native, { nativeAvailable: true }, log, true, () => now)
    const source = await router.open(media()).ready
    const reading = source.clipFrames()!.frames(0)
    const first = await reading.next()
    expect(first.value).toMatchObject({ backend: 'browser', timestamp: 0 })
    nativeFails = false
    const rest: Picture[] = []; for await (const value of reading) rest.push(value as unknown as Picture)
    // 0.5 and 1 still come from the browser (the cool-down passes while 1 is read), the rest from native, none repeated.
    expect(rest.map(value => [value.backend, value.timestamp])).toEqual([['browser', 0.5], ['browser', 1], ['native', 1.5], ['native', 2], ['native', 2.5], ['native', 3], ['native', 3.5]])
    expect(native.calls).toEqual(['frames 0', 'frames 1'])
    expect(log).toHaveBeenCalledWith('info', expect.any(String), 'video_edit.decode.native.restored', { mediaId: 'a', failures: 1 })

    nativeFails = true
    const plan = source.schedule([0, 1, 2, 3, 4])
    const head = await plan.next(); nativeFails = false
    const planned = [head.value, ...(await drain(plan))] as unknown as Picture[]
    expect(planned.map(value => [value.backend, value.timestamp])).toEqual([['browser', 0], ['browser', 1], ['browser', 2], ['native', 3], ['native', 4]])
    expect(native.calls.slice(2)).toEqual(['schedule 5', 'schedule 2'])
  })

  it('混音读取失败（尚未交付声音块）时由后备重读同一范围', async () => {
    const block = { timestamp: 0, duration: 1, numberOfFrames: 48000, numberOfChannels: 2, sampleRate: 48000, copyTo: () => {}, close: () => {} } satisfies VideoEditAudioChunk
    const native = scripted('native', { chunks: async function* () { if (block.timestamp === 0) throw serviceFailure(); yield block } })
    const browser = scripted('browser', { chunks: async function* () { yield block } })
    const router = new VideoEditFrameRouter(browser, native, { nativeAvailable: true }, () => {})
    const audio = (await router.open(media()).ready).clipAudio()!
    expect(await drain(audio.chunks(0, 1, 48000))).toEqual([block])
    expect(native.calls).toEqual(['chunks']); expect(browser.calls).toEqual(['chunks'])
  })

  it('原生不可用而浏览器解不了的文件：读取失败给出格式无法播放的用户语言提示', async () => {
    const browser = scripted('browser', { decodable: false, frameAt: async () => { throw new Error('Unsupported codec: apch') } })
    const router = new VideoEditFrameRouter(browser, undefined, { nativeAvailable: false })
    const clip = (await router.open(media()).ready).clipFrames()!
    await expect(clip.frameAt(0)).rejects.toThrow('素材「素材」的格式当前无法播放，请重启软件后重试')
  })

  it('定位器同样恢复：原生定位失败时由浏览器定位器完成', async () => {
    const native = scripted('native', { frameAt: async () => { throw serviceFailure() } })
    const browser = scripted('browser', {})
    const seeker = new VideoEditFrameRouter(browser, native, { nativeAvailable: true }, () => {}).seeker(media(), new VideoEditFrameCache(1), vi.fn())
    expect(await seeker.sample(2, 1)).toEqual({ hit: false })
    expect(native.calls).toEqual(['sample 2']); expect(browser.calls).toEqual(['sample 2'])
    await seeker.dispose()
  })
})

it('路由层不认识的后端名称不出现在用户提示里', async () => {
  const router = new VideoEditFrameRouter(fakeBackend('browser', { decodable: false }), undefined, { nativeAvailable: false, forced: 'native' })
  const error = await router.open(media()).ready.catch((caught: Error) => caught)
  expect(String(error)).not.toMatch(/原生|浏览器|native|browser/i)
})
