import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ directory: '', register: vi.fn() }))
vi.mock('../image/path-utils', () => ({ getUploadsDir: () => state.directory }))
vi.mock('../image/source', () => ({ normalizeLocalSource: (source: string) => source }))
vi.mock('../media-recycle/queue', () => ({ registerOwnedMedia: state.register }))
vi.mock('../logging', () => ({ createMainLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }))
import { resolveLocalMediaPath } from './shared'
beforeEach(async () => { vi.resetAllMocks(); state.directory = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-remote-')) })
afterEach(async () => { vi.unstubAllGlobals(); await fs.rm(state.directory, { recursive: true, force: true }) })
function response(chunks: Uint8Array[], headers: Record<string, string> = {}) {
  return new Response(new ReadableStream({ start(controller) { chunks.forEach(chunk => controller.enqueue(chunk)); controller.close() } }), { headers })
}
it('远程源从流落盘，不调用 arrayBuffer；本地路径仍直接返回', async () => {
  const result = response([new Uint8Array([1, 2]), new Uint8Array([3])])
  const arrayBuffer = vi.spyOn(result, 'arrayBuffer')
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(result))
  const target = await resolveLocalMediaPath('https://example.test/file.mp4')
  expect([...await fs.readFile(target)]).toEqual([1, 2, 3])
  expect(arrayBuffer).not.toHaveBeenCalled(); expect(state.register).toHaveBeenCalledWith(target)
  expect(await resolveLocalMediaPath(target)).toBe(target)
})
it.each(['header', 'stream'])('%s 超出预算时拒绝并清理文件', async kind => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([new Uint8Array([1, 2, 3])], kind === 'header' ? { 'content-length': '3' } : {})))
  await expect(resolveLocalMediaPath('https://example.test/large.mp4', undefined, { maxBytes: 2 })).rejects.toThrow('上限')
  expect(await fs.readdir(state.directory)).toEqual([]); expect(state.register).not.toHaveBeenCalled()
})
it('取消请求和慢速响应总超时均有界结束，部分写入不注册', async () => {
  const controller = new AbortController()
  vi.stubGlobal('fetch', vi.fn((_url, options: { signal: AbortSignal }) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }))))
  const pending = resolveLocalMediaPath('https://example.test/pending.mp4', controller.signal)
  controller.abort(new Error('关闭来源')); await expect(pending).rejects.toThrow('关闭来源')
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ReadableStream({ start(stream) { stream.enqueue(new Uint8Array([1])) } }))))
  await expect(resolveLocalMediaPath('https://example.test/slow.mp4', undefined, { timeoutMs: 20 })).rejects.toThrow()
  expect(await fs.readdir(state.directory)).toEqual([]); expect(state.register).not.toHaveBeenCalled()
})
it('注册失败清理未发布文件，错误不吞掉', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([new Uint8Array([1])])))
  state.register.mockRejectedValue(new Error('登记失败'))
  await expect(resolveLocalMediaPath('https://example.test/file.mp4')).rejects.toThrow('登记失败')
  expect(await fs.readdir(state.directory)).toEqual([])
})
