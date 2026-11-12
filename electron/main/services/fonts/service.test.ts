import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import path from 'node:path'
import { GENERIC_FONT_FACES } from '../../../../src/core/fonts/catalog'
import type { InternalFace } from './scanner'
import type { FontWorkerRequest } from './worker'
import { FontService } from './service'
import { trashUserFile } from '../recycle/runtime'
vi.mock('../recycle/runtime', () => ({ trashUserFile: vi.fn(async () => { boundary.faces = [] }) }))
const boundary = vi.hoisted(() => ({ faces: [] as InternalFace[], failures: [] as string[], debug: vi.fn(), warn: vi.fn(), error: vi.fn(), requests: [] as FontWorkerRequest[], watchers: new Map<string, (event: string, name: string) => void>(), workers: [] as Array<Map<string, (reply: unknown) => void>>, send: vi.fn(), close: vi.fn(), terminate: vi.fn(), failedImport: false, signature: 'files-1', hold: undefined as Promise<void> | undefined }))
vi.mock('electron', () => ({ app: { getPath: () => 'unused' }, BrowserWindow: { getAllWindows: () => [{ webContents: { send: boundary.send } }] } }))
vi.mock('node:fs', () => ({ watch: (directory: string, _options: unknown, callback: (event: string, name: string) => void) => { boundary.watchers.set(directory, callback); return { on: vi.fn(), close: boundary.close } } }))
vi.mock('../logging', () => ({ createMainLogger: () => ({ info: vi.fn(), debug: boundary.debug, warn: boundary.warn, error: boundary.error }) }))
vi.mock('node:worker_threads', () => ({ Worker: class {
  private readonly listeners = new Map<string, (reply: unknown) => void>()
  constructor() { boundary.workers.push(this.listeners) }
  on(event: string, callback: (reply: unknown) => void) { this.listeners.set(event, callback); return this }
  unref() {}
  terminate() { boundary.terminate(); return Promise.resolve(0) }
  postMessage(request: FontWorkerRequest) {
    boundary.requests.push(request)
    // 结果按收到请求时的目录状态生成；hold 让扫描停在途中。
    const reply = { id: request.id, ...(request.kind === 'import' && boundary.failedImport ? { error: 'bad font' } : { result: request.kind === 'read' ? new Uint8Array([1]) : request.kind === 'inventory' ? boundary.signature : { faces: boundary.faces, failures: boundary.failures, signature: boundary.signature } }) }
    const deliver = (): void => this.listeners.get('message')?.(reply)
    if (request.kind === 'scan' && boundary.hold) void boundary.hold.then(deliver); else queueMicrotask(deliver)
  }
} }))
const library = path.resolve('node_modules/.cache/t63-library-test')
let service: FontService
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }); vi.clearAllMocks(); boundary.requests = []; boundary.workers = []; boundary.watchers.clear(); boundary.failedImport = false; boundary.failures = []; boundary.signature = 'files-1'; boundary.hold = undefined
  boundary.faces = [{ face: { ...GENERIC_FONT_FACES[0], id: 'a'.repeat(64), family: 'TestFont', fullName: 'TestFont', aliases: [], imported: false }, path: path.resolve('node_modules/.cache/system-fonts/font.ttf'), index: 0, signature: '1:0' }]
  service = new FontService(library)
})
afterEach(async () => { await service.dispose(); vi.useRealTimers() })
it('主进程回收导入字体再让 Worker 扫描，系统字体不进入回收服务', async () => {
  await expect(service.remove(boundary.faces[0].face.id)).rejects.toThrow('系统字体')
  expect(trashUserFile).not.toHaveBeenCalled()
  boundary.faces[0].face.imported = true
  boundary.faces[0].face.localizedFamily = 'TestFont'
  boundary.faces[0].path = path.join(library, 'imported.ttf')
  await service.importFiles([])
  const id = boundary.faces[0].face.id
  expect((await service.remove(id)).faces).toEqual([])
  expect(trashUserFile).toHaveBeenCalledWith(path.join(library, 'imported.ttf'), 'TestFont')
})
const kinds = (): string[] => boundary.requests.map(request => request.kind)
const settle = async (ms: number): Promise<void> => { await vi.advanceTimersByTimeAsync(ms); for (let i = 0; i < 10; i++) await Promise.resolve() }
it('监听事件风暴合并成一次清单核对；清单没变不重扫、不广播，缓存文件事件直接忽略', async () => {
  const first = await service.list(); expect(first.faces[0]).not.toHaveProperty('path'); await service.list(); expect(kinds()).toEqual(['scan'])
  boundary.send.mockClear()
  for (const name of ['catalog-cache.json', 'catalog-cache.tmp', '.catalog-cache.json.12345678-1234-1234-1234-123456789abc.tmp']) {
    boundary.watchers.get(library)!('rename', name); boundary.watchers.get(library)!('change', name)
  }
  await settle(1000); await service.list(); expect(kinds()).toEqual(['scan'])
  const root = path.dirname(boundary.faces[0].path)
  for (let index = 0; index < 25; index++) { boundary.watchers.get(root)!('change', 'font.ttf'); boundary.watchers.get(root)!('rename', '') }
  await settle(499); expect(kinds()).toEqual(['scan'])
  await settle(1); expect(kinds()).toEqual(['scan', 'inventory']); expect(boundary.send).not.toHaveBeenCalled()
  await service.list(); expect(kinds()).toEqual(['scan', 'inventory'])
  // 真有新字体：核对发现清单变化，才全量扫描并通知界面一次。
  boundary.signature = 'files-2'; boundary.faces = [...boundary.faces, { ...boundary.faces[0], face: { ...boundary.faces[0].face, id: 'c'.repeat(64) } }]
  boundary.watchers.get(root)!('rename', 'new.ttf'); boundary.watchers.get(root)!('change', 'new.ttf')
  await settle(500); expect(kinds()).toEqual(['scan', 'inventory', 'inventory', 'scan']); expect(boundary.send).toHaveBeenCalledTimes(1)
  expect((await service.list()).faces).toHaveLength(2)
  await settle(60_000); await service.list(); expect(kinds().at(-1)).toBe('inventory')
})
it('扫描进行中又有字体拷入：扫描结束后补核对一次，新字体出现并通知界面', async () => {
  await service.list()
  const root = path.dirname(boundary.faces[0].path), font = boundary.faces[0]
  let open!: () => void; boundary.hold = new Promise(resolve => { open = resolve })
  boundary.signature = 'files-2'; boundary.faces = [font, { ...font, face: { ...font.face, id: 'd'.repeat(64) } }]
  boundary.watchers.get(root)!('rename', 'a.ttf'); await settle(500)
  expect(kinds()).toEqual(['scan', 'inventory', 'scan'])
  boundary.signature = 'files-3'; boundary.faces = [...boundary.faces, { ...font, face: { ...font.face, id: 'e'.repeat(64) } }]
  boundary.watchers.get(root)!('rename', 'b.ttf'); await settle(500)
  boundary.hold = undefined; boundary.send.mockClear(); open(); await settle(0)
  expect(kinds()).toEqual(['scan', 'inventory', 'scan', 'inventory', 'scan'])
  expect(boundary.send).toHaveBeenCalledTimes(2); expect((await service.list()).faces).toHaveLength(3)
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
it('系统目录不可解析候选只记诊断日志，显式导入失败仍保留错误', async () => {
  boundary.failures = ['broken.ttf: Unknown font format']
  expect((await service.list()).faces).toHaveLength(1)
  expect(boundary.debug).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ event: 'fonts.scan.partial', context: { failures: boundary.failures } }))
  expect(boundary.warn).not.toHaveBeenCalled()
  boundary.failedImport = true
  await expect(service.importFiles(['broken.ttf'])).rejects.toThrow('bad font')
  expect(boundary.error).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ event: 'fonts.import.failed' }))
})

it('导出只固定目录清单，不复制或预读任何字体；读取使用固定身份', async () => {
  const snapshot = await service.captureSnapshot()
  expect(kinds()).toEqual(['scan'])
  // 再次导出只核对文件清单，清单没变不重扫。
  await service.captureSnapshot(); expect(kinds()).toEqual(['scan', 'inventory'])
  const face = snapshot.faces[0], source = snapshot.sources[face.id]
  boundary.faces = []
  await service.importFiles([])
  expect((await service.readFace(face.id, source)).face).toEqual(face)
  expect(boundary.requests.at(-1)).toMatchObject({ kind: 'read', face: source, fixed: true })
  await service.dispose()
  expect(boundary.terminate).toHaveBeenCalledOnce()
})
