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
