import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ root: '', exec: vi.fn(), owned: vi.fn() }))
vi.mock('node:child_process', () => ({ execFile: mocks.exec }))
vi.mock('../appPaths', () => ({ getProgramStoreDir: () => mocks.root }))
vi.mock('../media-recycle/queue', () => ({ registerOwnedMedia: mocks.owned }))
vi.mock('../video/ffmpeg-loader', () => ({ loadFfmpegPath: async () => 'ffmpeg', loadFfprobePath: async () => 'ffprobe' }))
import { probeLocalMedia, writeVideoPoster } from './probe'

beforeEach(async () => { mocks.root = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-poster-')); vi.clearAllMocks() })
afterEach(async () => { await fs.rm(mocks.root, { recursive: true, force: true }) })
it('失败清理半成品、重新生成原子发布并登记归属，同 key 并发只写一次', async () => {
  let fail = true
  mocks.exec.mockImplementation((_binary: string, args: string[], _options: unknown, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
    void fs.writeFile(args.at(-1)!, fail ? 'partial' : 'complete').then(() => callback(fail ? new Error('encoder failed') : null, '', ''))
  })
  await expect(writeVideoPoster('source.mp4', 'key', 3)).rejects.toThrow('encoder failed')
  expect(await fs.readdir(mocks.root)).toEqual([])
  fail = false
  const [one, two] = await Promise.all([writeVideoPoster('source.mp4', 'key', 3), writeVideoPoster('source.mp4', 'key', 3)])
  expect(one.posterPath).toBe(two.posterPath)
  expect(await fs.readFile(one.posterPath, 'utf8')).toBe('complete')
  expect(mocks.exec).toHaveBeenCalledTimes(2)
  expect(mocks.exec.mock.calls[1][1]).toEqual(expect.arrayContaining(['-f', 'image2']))
  expect(mocks.owned).toHaveBeenCalledWith(one.posterPath, 'source.mp4')
  await expect(writeVideoPoster('source.mp4', 'key', 3)).resolves.toMatchObject({ cacheHit: true })
})

it('只把 ffprobe 的结构化 INVALIDDATA 结论标为格式拒绝', async () => {
  mocks.exec.mockImplementation((_binary, args, _options, callback) => {
    expect(args).toContain('-show_error')
    callback(Object.assign(new Error('process exit'), { code: 1 }), JSON.stringify({ error: { code: -1094995529 } }), '')
  })
  await expect(probeLocalMedia('invalid.mp4')).rejects.toMatchObject({ name: 'MediaProbeFormatError', code: 'MEDIA_FORMAT_UNSUPPORTED' })
})

it.each(['ENOENT', 'EACCES', 'ETIMEDOUT', 1])('ffprobe 启动或执行失败 %s 保留错误身份与原始码，不判为格式错误', async code => {
  const source = path.join(mocks.root, 'voice.ts')
  mocks.exec.mockImplementation((_binary, _args, _options, callback) => {
    callback(Object.assign(new Error(`暂时无法打开 '${source}'`), { name: 'ProbeExecutionError', code }), '', '')
  })
  const error = await probeLocalMedia(source).catch(value => value)
  expect(error).toMatchObject({ name: 'ProbeExecutionError', code })
  expect(error.message).not.toContain(source)
})

it('ffprobe 与海报失败只脱敏真实路径，保留选项、数字和 json 诊断', async () => {
  const source = path.join(mocks.root, 'video.mp4')
  mocks.exec.mockImplementation((_binary, args, _options, callback) => {
    const pending = args.at(-1)
    callback(Object.assign(new Error(`json -y -i 1 3 '${source}' '${pending}'`), { code: 'EIO' }), '', `json -i 1 3 '${source}'`)
  })
  for (const operation of [() => probeLocalMedia(source), () => writeVideoPoster(source, 'failure', 3)]) {
    const error = await operation().catch(value => value)
    expect(error.message).toContain('json -y -i 1 3')
    expect(error.message).toContain('json -i 1 3')
    expect(error.message).not.toContain(mocks.root)
    expect(error).toMatchObject({ code: 'EIO' })
  }
})
