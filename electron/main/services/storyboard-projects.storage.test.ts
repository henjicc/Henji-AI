import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeSchema } from './db'
import { getStoryboardProject, upsertStoryboardProject, updateStoryboardProjectViewport, renameStoryboardProject,
  type StoryboardProjectWriteDto } from './storyboard-projects'
import { CanvasProjectRecordError } from '../../../src/core/canvas/projectRecordCodec'

const storage = vi.hoisted(() => ({ current: null as Database.Database | null }))
vi.mock('./db', async (original) => ({ ...await original<typeof import('./db')>(), getDb: () => {
  if (!storage.current) throw new Error('测试数据库未初始化')
  return storage.current
} }))
vi.mock('./project-covers', () => ({ clearProjectCover: vi.fn() }))
vi.mock('./logging', () => ({ createMainLogger: () => ({ debug: vi.fn(), error: vi.fn() }) }))

function record(): StoryboardProjectWriteDto {
  return { id: 'protected', name: '原件', createdAt: 1, updatedAt: 2, nodeCount: 0,
    nodesJson: '[]', edgesJson: '[]', viewportJson: '{"x":0,"y":0,"zoom":1}',
    historyJson: '{"past":[],"future":[],"imagePool":[]}' }
}
// 原生驱动使用 Electron ABI；精确入口见既有 test-assistant-persistence.cjs 的启动方式。
describe.skipIf(!process.versions.electron)('正式工程服务与临时真实SQLite的数据保护', () => {
  let directory: string
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'henji-protected-project-'))
    storage.current = new Database(join(directory, 'test.sqlite'))
    initializeSchema(storage.current)
    upsertStoryboardProject(record())
  })
  afterEach(() => {
    storage.current?.close(); storage.current = null
    rmSync(directory, { recursive: true, force: true })
  })

  it.each(['nodes_json', 'edges_json', 'viewport_json', 'history_json'])('损坏 %s 无法打开/覆写/更新视口，原始各字段逐字节不变', (column) => {
    storage.current!.prepare(`UPDATE storyboard_projects SET ${column}=? WHERE id=?`).run('{broken-private-content', 'protected')
    const before = storage.current!.prepare('SELECT * FROM storyboard_projects WHERE id=?').get('protected')
    expect(() => getStoryboardProject('protected')).toThrow(CanvasProjectRecordError)
    expect(() => upsertStoryboardProject({ ...record(), nodesJson: '[]', updatedAt: 999 })).toThrow(CanvasProjectRecordError)
    expect(() => updateStoryboardProjectViewport('protected', '{"x":3,"y":4,"zoom":2}')).toThrow(CanvasProjectRecordError)
    expect(() => renameStoryboardProject('protected', '不该替换', 999)).toThrow(CanvasProjectRecordError)
    expect(storage.current!.prepare('SELECT * FROM storyboard_projects WHERE id=?').get('protected')).toEqual(before)
  })

  it('新输入损坏不能覆盖合法原件；非法视口不能绕过保护', () => {
    const before = getStoryboardProject('protected')
    expect(() => upsertStoryboardProject({ ...record(), nodesJson: '{}' })).toThrow(CanvasProjectRecordError)
    expect(() => updateStoryboardProjectViewport('protected', '{}')).toThrow(CanvasProjectRecordError)
    expect(getStoryboardProject('protected')).toEqual(before)
  })

  it('仅更新不存在的工程不能把零行写入报告成功，upsert仍允许合法新建', () => {
    expect(() => updateStoryboardProjectViewport('missing', record().viewportJson)).toThrow('工程不存在')
    expect(() => renameStoryboardProject('missing', 'name', 1)).toThrow('工程不存在')
    upsertStoryboardProject({ ...record(), id: 'new-project' })
    expect(getStoryboardProject('new-project')?.nodesJson).toBe('[]')
  })

  it('合法空工程正常读写；大历史完整保存，不因原字符阈值丢弃', () => {
    expect(getStoryboardProject('protected')?.nodesJson).toBe('[]')
    const large = JSON.stringify({ past: [{ nodes: [{ id: 'n', type: 'uploadNode', position: { x: 0, y: 0 },
      data: { prompt: '文'.repeat(1_600_000), imageUrl: '__img_ref__:0' } }], edges: [] }],
      future: [], imagePool: ['/photo.png'] })
    upsertStoryboardProject({ ...record(), historyJson: large })
    updateStoryboardProjectViewport('protected', '{"x":3,"y":4,"zoom":2}')
    expect(getStoryboardProject('protected')?.historyJson).toBe(large)
    expect(getStoryboardProject('protected')?.viewportJson).toBe('{"x":3,"y":4,"zoom":2}')
  })

  it('已知媒体字段的坏池引用不回存，普通同名提示词可以', () => {
    const n = { id: 'n', type: 'uploadNode', position: { x: 0, y: 0 }, data: { prompt: '__img_ref__:999' } }
    upsertStoryboardProject({ ...record(), nodesJson: JSON.stringify([n]), nodeCount: 1 })
    const before = getStoryboardProject('protected')
    for (const data of [{ imageUrl: '__img_ref__:999' }, { videoUrl: '__img_ref__:0' }]) {
      expect(() => upsertStoryboardProject({ ...record(), nodesJson: JSON.stringify([{ ...n, data }]) })).toThrow(CanvasProjectRecordError)
    }
    expect(getStoryboardProject('protected')).toEqual(before)
  })

  it('下线模型的不透明参数和原媒体池在真实数据库中完整保留', () => {
    const data = { modelId: 'unknown', params: { image: '__img_ref__:0', prompt: '__img_ref__:999' } }
    const saved = { ...record(), nodeCount: 1,
      nodesJson: JSON.stringify([{ id: 'n', type: 'generator', position: { x: 0, y: 0 }, data }]),
      historyJson: '{"past":[],"future":[],"imagePool":["/photo.png"]}' }
    upsertStoryboardProject(saved)
    expect(getStoryboardProject('protected')).toMatchObject({ nodesJson: saved.nodesJson, historyJson: saved.historyJson })
    updateStoryboardProjectViewport('protected', '{"x":3,"y":4,"zoom":2}')
    expect(getStoryboardProject('protected')).toMatchObject({ nodesJson: saved.nodesJson, historyJson: saved.historyJson })
  })
})
