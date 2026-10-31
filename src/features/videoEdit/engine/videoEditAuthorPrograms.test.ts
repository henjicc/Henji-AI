import { LoadedFontFaces } from '@/platform/fontFaces'
import { GENERIC_FONT_FACES } from '@/core/fonts/catalog'
import { afterEach, expect, it, vi } from 'vitest'
import type { GpuDevice } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import { VideoEditAuthorPrograms } from './videoEditAuthorPrograms'

const { load, runtimeDispose, constructed } = vi.hoisted(() => ({ load: vi.fn(), runtimeDispose: vi.fn(), constructed: vi.fn() }))
vi.mock('./videoEditAuthorModule', () => ({ loadAuthorModule: load }))
vi.mock('./videoEditAuthorRuntime', () => ({ VideoEditAuthorRuntime: class {
  constructor() { constructed() }
  dispose = runtimeDispose
  observeElements() { return [] }
} }))
afterEach(() => { vi.restoreAllMocks(); vi.resetAllMocks() })
const bundle = () => ({ code: 'export const name="test"', map: '', locations: { layers: {} } })

it('shares concurrent requests for the same instance and disposes its module once', async () => {
  const dispose = vi.fn()
  load.mockResolvedValue({ name: 'test', draw() {}, dispose })
  const pool = new VideoEditAuthorPrograms({} as GpuDevice)
  const program = await pool.inspect(bundle())
  const [first, second] = await Promise.all([pool.instance('clip', program), pool.instance('clip', program)])
  expect(first).toBe(second)
  expect(constructed).toHaveBeenCalledOnce()
  await Promise.all([pool.dispose(), pool.dispose()])
  expect(runtimeDispose).toHaveBeenCalledOnce()
  expect(dispose).toHaveBeenCalledOnce()
})

it('revokes module URLs even if an instance disposer fails', async () => {
  const revoke = vi.spyOn(URL, 'revokeObjectURL')
  const dispose = vi.fn()
  load.mockResolvedValue({ name: 'test', draw() {}, dispose })
  runtimeDispose.mockRejectedValue(new Error('cleanup'))
  const pool = new VideoEditAuthorPrograms({} as GpuDevice)
  await pool.instance('clip', await pool.inspect(bundle()))
  await expect(pool.dispose()).rejects.toThrow('作者渲染会话释放失败')
  expect(dispose).toHaveBeenCalledOnce()
  expect(revoke).toHaveBeenCalledOnce()
})

it('can retry a failed module import and releases its failed URL', async () => {
  const revoke = vi.spyOn(URL, 'revokeObjectURL')
  load.mockRejectedValueOnce(new Error('import')).mockResolvedValue({ name: 'test', draw() {} })
  const pool = new VideoEditAuthorPrograms({} as GpuDevice), source = bundle()
  await expect(pool.inspect(source)).rejects.toThrow('import')
  await pool.inspect(source)
  expect(load).toHaveBeenCalledTimes(2)
  expect(revoke).toHaveBeenCalledOnce()
  await pool.dispose()
  expect(revoke).toHaveBeenCalledTimes(2)
})

it('bounds unused module history while retaining a visible instance', async () => {
  const dispose = vi.fn()
  load.mockImplementation(async () => ({ name: 'test', draw() {}, dispose }))
  const pool = new VideoEditAuthorPrograms({} as GpuDevice)
  const first = await pool.inspect(bundle())
  const active = await pool.instance('clip', first)
  for (let index = 0; index < 35; index++) await pool.inspect(bundle())
  expect(dispose).toHaveBeenCalledTimes(4)
  expect(await pool.instance('clip', first)).toBe(active)
  expect(runtimeDispose).not.toHaveBeenCalled()
  await pool.dispose()
  expect(dispose).toHaveBeenCalledTimes(36)
})

it('前瞻模块加载挂起时，当前帧的实例读取不排在加载后面', async () => {
  load.mockResolvedValue({ name: 'current', draw() {} })
  const pool = new VideoEditAuthorPrograms({} as GpuDevice)
  const program = await pool.inspect(bundle()), current = await pool.instance('clip', program)
  let finish!: (value: { name: string; draw(): void }) => void
  load.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const future = pool.inspect(bundle())
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  expect(await pool.instance('clip', program)).toBe(current)
  finish({ name: 'future', draw() {} }); await future; await pool.dispose()
})


it('输出 frameKey 使用真实作者参数与原生尺寸，非法声明回退而不绘制', async () => {
  const draw = vi.fn(), frameKey = vi.fn((_p, width, height, info) => [width, height, info.renderScale ?? 1])
  load.mockResolvedValue({ name: '原生', createWebGPU: () => ({ draw }), frameKey })
  const pool = new VideoEditAuthorPrograms({} as GpuDevice), program = await pool.inspect(bundle())
  const info = { time: 1, frameDuration: 1 / 30, clip: { time: 1, duration: 4 } }
  try {
    const full = await pool.frameKey(program, { width: 1920, height: 1080 }, {}, info, undefined, false, 1, {}, {})
    const half = await pool.frameKey(program, { width: 1920, height: 1080 }, {}, info, undefined, false, 2, {}, {})
    expect(frameKey.mock.lastCall?.slice(1, 3)).toEqual([960, 540])
    expect(half?.digest).not.toBe(full?.digest)
    frameKey.mockImplementationOnce(() => Number.NaN as never)
    expect((await pool.frameKey(program, { width: 1920, height: 1080 }, {}, info, undefined, false, 1, {}, {}))?.fallback).toContain('frame-key-error')
    expect(draw).not.toHaveBeenCalled()
  } finally { await pool.dispose() }
})

it('多层作者的输出 frameKey 只执行声明，完整环境由输出键覆盖', async () => {
  const layers = vi.fn(() => [{ id: 'a', draw() {} }, { id: 'b', draw() {} }]), frameKey = vi.fn(() => 'still')
  load.mockResolvedValue({ name: '多层', layers, frameKey })
  const pool = new VideoEditAuthorPrograms({} as GpuDevice), program = await pool.inspect({ ...bundle(), apiVersion: 7 })
  try {
    const key = await pool.frameKey(program, { width: 100, height: 100 }, {}, { time: 0, frameDuration: 1 / 30, clip: { time: 0, duration: 3 } }, undefined, false, 1, {}, {})
    expect(key?.digest).toBeDefined(); expect(frameKey).toHaveBeenCalledOnce(); expect(layers).not.toHaveBeenCalled()
  } finally { await pool.dispose() }
})

it('Worker 字体变化后同一程序重建实例，不能沿用旧字体的内部层纹理', async () => {
  load.mockResolvedValue({ name: '字体', draw() {} })
  vi.stubGlobal('FontFace', class { async load() { return this } })
  const fonts = new LoadedFontFaces({ add() {}, delete() {} } as unknown as FontFaceSet)
  const pool = new VideoEditAuthorPrograms({} as GpuDevice), program = await pool.inspect(bundle())
  try {
    const first = await pool.instance('clip', program)
    expect(await pool.instance('clip', program)).toBe(first)
    await fonts.load({ face: { ...GENERIC_FONT_FACES[0], id: 'worker-font' }, bytes: new Uint8Array([1]) })
    expect(await pool.instance('clip', program)).not.toBe(first)
    expect(runtimeDispose).toHaveBeenCalledOnce()
  } finally { await pool.dispose(); fonts.dispose(); vi.unstubAllGlobals() }
})
