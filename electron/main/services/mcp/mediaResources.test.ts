import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const state = vi.hoisted(() => ({ root: '', rows: new Map<string, { file_path: string }>(), project: null as unknown }))
vi.mock('../db', () => ({ getDb: () => ({ prepare: (sql: string) => ({ get: (id: string) => state.rows.get(`${sql.includes('assets') ? 'asset' : 'generation.result'}:${id}`) }) }) }))
vi.mock('../image/path-utils', () => ({ getDataRootDir: () => state.root }))
vi.mock('../logging', () => ({ createMainLogger: () => ({ debug: vi.fn(), warn: vi.fn() }) }))
vi.mock('../storyboard-projects', () => ({ getStoryboardProject: (id: string) => id === 'project' ? state.project : null }))
vi.mock('../storyboard-project-validation', () => ({ resolveStoryboardProjectMediaSchema: () => [] }))
vi.mock('../../protocol', () => ({
  isPathWithinAllowedMediaRoots: (value: string) => { const relative = path.relative(state.root, value); return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative)) },
  inferMimeFromPath: (value: string) => ({ '.png': 'image/png', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg' })[path.extname(value)] ?? 'application/octet-stream',
}))
import { readMcpMediaResource } from './mediaResources'

let directory: string
beforeAll(async () => { directory = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-mcp-media-')); state.root = path.join(directory, 'allowed'); await fs.mkdir(state.root) })
afterAll(async () => { await fs.rm(directory, { recursive: true, force: true }) })
beforeEach(() => { state.rows.clear(); state.project = null })

describe('稳定业务引用的媒体读取', () => {
  it.each(['generation.result', 'asset', 'canvas.node'] as const)('读取 %s 正式关联字节、末页及 EOF', async (kind) => {
    const filename = path.join(state.root, `${kind}.mp4`)
    await fs.writeFile(filename, Buffer.from([1, 2, 3, 4, 5]))
    const id = kind === 'canvas.node' ? 'project:node' : 'result'
    state.rows.set(`${kind}:${id}`, { file_path: filename })
    state.project = { nodesJson: JSON.stringify([{ id: 'node', type: 'video', position: { x: 0, y: 0 }, data: { videoUrl: '__img_ref__:0' } }]), edgesJson: '[]', viewportJson: '{"x":0,"y":0,"zoom":1}', historyJson: JSON.stringify({ past: [], future: [], imagePool: [filename] }) }
    const first = await readMcpMediaResource({ ref: { kind, id }, length: 3 })
    expect(first).toEqual({ mimeType: 'video/mp4', base64: 'AQID', offset: 0, byteLength: 3, totalBytes: 5, eof: false })
    expect(await readMcpMediaResource({ ref: { kind, id }, offset: 3, length: 3 })).toMatchObject({ base64: 'BAU=', byteLength: 2, eof: true })
    expect(await readMcpMediaResource({ ref: { kind, id }, offset: 5 })).toMatchObject({ base64: '', byteLength: 0, eof: true })
    await expect(readMcpMediaResource({ ref: { kind, id }, offset: 6 })).rejects.toThrow()
  })
  it('历史多结果按已保存顺序选择，块长度不超过 256 KiB', async () => {
    const filename = path.join(state.root, 'second.mp3'); await fs.writeFile(filename, Buffer.alloc(300_000, 7))
    state.rows.set('generation.result:result', { file_path: `missing.png|||${filename}` })
    const result = await readMcpMediaResource({ ref: { kind: 'generation.result', id: 'result' }, outputIndex: 1 })
    expect(result).toMatchObject({ mimeType: 'audio/mpeg', byteLength: 262144, totalBytes: 300000, eof: false })
  })
  it('当前任务及旧历史均只按完整主键读取保存结果，未保存任务不猜其他历史', async () => {
    const filename = path.join(state.root, 'task.png'); await fs.writeFile(filename, 'task')
    for (const id of ['current-task', 'old-history']) {
      state.rows.set(`generation.result:${id}`, { file_path: filename })
      expect(await readMcpMediaResource({ ref: { kind: 'generation.result', id } })).toMatchObject({ base64: 'dGFzaw==' })
    }
    await expect(readMcpMediaResource({ ref: { kind: 'generation.result', id: 'unsaved-task' } })).rejects.toMatchObject({ code: 'MEDIA_NOT_PERSISTED' })
    await expect(readMcpMediaResource({ ref: { kind: 'generation.result', id: 'current-task' }, offset: 8 })).rejects.toMatchObject({ code: 'MEDIA_RANGE_OUT_OF_BOUNDS' })
  })
  it('画布关联媒体按正式遍历去重，包括预览与输入，不冒充只返回生成输出', async () => {
    const a = path.join(state.root, 'a.png'); const b = path.join(state.root, 'b.png')
    await fs.writeFile(a, 'a'); await fs.writeFile(b, 'b')
    state.project = { nodesJson: JSON.stringify([{ id: 'node', type: 'image', position: { x: 0, y: 0 }, data: { imageUrl: a, previewImageUrl: a, mediaInputs: { image: [b] } } }]), edgesJson: '[]', viewportJson: '{"x":0,"y":0,"zoom":1}', historyJson: '{"past":[],"future":[],"imagePool":[]}' }
    expect(await readMcpMediaResource({ ref: { kind: 'canvas.node', id: 'project:node' }, outputIndex: 1 })).toMatchObject({ base64: 'Yg==' })
  })
  it.each([{ outputIndex: -1 }, { outputIndex: 0.5 }, { offset: -1 }, { offset: 1.5 }, { offset: Infinity }, { length: 0 }, { length: 262145 }, { length: 1.5 }])('拒绝非法范围 %j', async (range) => {
    await expect(readMcpMediaResource({ ref: { kind: 'asset', id: 'x' }, ...range })).rejects.toThrow()
  })
  it('拒绝未知类型、输入路径/URL和多余参数，不把引用当路径', async () => {
    await expect(readMcpMediaResource({ ref: { kind: 'file', id: '/secret.png' } })).rejects.toThrow()
    for (const id of ['https://example.test/a.png', path.join(state.root, 'a.png')]) await expect(readMcpMediaResource({ ref: { kind: 'asset', id } })).rejects.toThrow()
    await expect(readMcpMediaResource({ ref: { kind: 'asset', id: 'x' }, path: '/secret.png' } as Parameters<typeof readMcpMediaResource>[0])).rejects.toThrow()
  })
  it('拒绝远程代理、根目录逃逸、非媒体和错误序号', async () => {
    for (const file_path of ['https://example.test/a.png', path.join(directory, 'secret.png'), path.join(state.root, 'secret.txt')]) {
      if (!file_path.startsWith('http')) await fs.writeFile(file_path, 'secret')
      state.rows.set('asset:x', { file_path })
      await expect(readMcpMediaResource({ ref: { kind: 'asset', id: 'x' } })).rejects.toThrow()
    }
    await expect(readMcpMediaResource({ ref: { kind: 'asset', id: 'x' }, outputIndex: 1 })).rejects.toThrow()
  })
  it('真实目录链接指向授权根外仍拒绝', async () => {
    const outside = path.join(directory, 'outside'); await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'secret.png'), 'secret')
    const link = path.join(state.root, 'link'); await fs.symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir')
    state.rows.set('asset:x', { file_path: path.join(link, 'secret.png') })
    await expect(readMcpMediaResource({ ref: { kind: 'asset', id: 'x' } })).rejects.toMatchObject({ code: 'MEDIA_ACCESS_DENIED' })
  })
})
