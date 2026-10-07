import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import path from 'node:path'
import { GENERIC_FONT_FACES } from '../../../../src/core/fonts/catalog'
import type { InternalFace } from './scanner'
import type { FontWorkerRequest } from './worker'
import { FontService } from './service'
const boundary = vi.hoisted(() => ({ faces: [] as InternalFace[], requests: [] as FontWorkerRequest[], watchers: new Map<string, (event: string, name: string) => void>(), workers: [] as Array<Map<string, (reply: unknown) => void>>, send: vi.fn(), close: vi.fn(), terminate: vi.fn(), failedImport: false }))
vi.mock('electron', () => ({ app: { getPath: () => 'unused' }, BrowserWindow: { getAllWindows: () => [{ webContents: { send: boundary.send } }] } }))
vi.mock('node:fs', () => ({ watch: (directory: string, _options: unknown, callback: (event: string, name: string) => void) => { boundary.watchers.set(directory, callback); return { on: vi.fn(), close: boundary.close } } }))
vi.mock('../logging', () => ({ createMainLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }))
vi.mock('node:worker_threads', () => ({ Worker: class {
  private readonly listeners = new Map<string, (reply: unknown) => void>()
  constructor() { boundary.workers.push(this.listeners) }
  on(event: string, callback: (reply: unknown) => void) { this.listeners.set(event, callback); return this }
  unref() {}
  terminate() { boundary.terminate(); return Promise.resolve(0) }
  postMessage(request: FontWorkerRequest) {
    boundary.requests.push(request)
    queueMicrotask(() => this.listeners.get('message')?.({ id: request.id, ...(request.kind === 'import' && boundary.failedImport ? { error: 'bad font' } : { result: request.kind === 'read' ? new Uint8Array([1]) : { faces: boundary.faces, failures: [] } }) }))
  }
} }))
const library = path.resolve('node_modules/.cache/t63-library-test')
let service: FontService
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }); vi.clearAllMocks(); boundary.requests = []; boundary.workers = []; boundary.watchers.clear(); boundary.failedImport = false
  boundary.faces = [{ face: { ...GENERIC_FONT_FACES[0], id: 'a'.repeat(64), family: 'TestFont', fullName: 'TestFont', aliases: [], imported: false }, path: path.resolve('node_modules/.cache/system-fonts/font.ttf'), index: 0, signature: '1:0' }]
  service = new FontService(library)
})
afterEach(() => { service.dispose(); vi.useRealTimers() })
it('目录缓存在主线程复用；目录新增和字体修改防抖刷新，缓存文件不会触发重扫', async () => {
  const first = await service.list(); expect(first.faces[0]).not.toHaveProperty('path'); await service.list(); expect(boundary.requests).toHaveLength(1)
  boundary.watchers.get(library)!('change', 'catalog-cache.json'); await service.list(); expect(boundary.requests).toHaveLength(1)
  const root = path.dirname(boundary.faces[0].path); boundary.watchers.get(root)!('rename', 'new-folder'); boundary.watchers.get(root)!('change', 'font.ttf')
  boundary.send.mockClear(); vi.advanceTimersByTime(199); expect(boundary.send).not.toHaveBeenCalled(); vi.advanceTimersByTime(1); expect(boundary.send).toHaveBeenCalledTimes(1)
  await service.list(); expect(boundary.requests).toHaveLength(2)
  vi.advanceTimersByTime(60_000); await service.list(); expect(boundary.requests).toHaveLength(3)
})
it('读取只能通过已枚举的 ID；批量导入部分失败也刷新已有成功结果', async () => {
  await expect(service.readFace('unknown')).rejects.toThrow('不存在')
  expect((await service.readFace('a'.repeat(64))).bytes).toEqual(new Uint8Array([1]))
  boundary.faces = [...boundary.faces, { ...boundary.faces[0], face: { ...boundary.faces[0].face, id: 'b'.repeat(64), imported: true } }]; boundary.failedImport = true
  await expect(service.importFiles(['native-selected.ttf'])).rejects.toThrow('bad font')
  expect((await service.list()).faces.some(face => face.id === 'b'.repeat(64))).toBe(true)
})
it('旧扫描线程延迟退出不能拒绝已重建线程中的请求', async () => {
  await service.list(); const old = boundary.workers[0]
  old.get('error')!(new Error('crashed'))
  const pending = service.list(); expect(boundary.workers).toHaveLength(2)
  old.get('exit')!(1)
  await expect(pending).resolves.toMatchObject({ faces: [expect.objectContaining({ family: 'TestFont' })] })
})
