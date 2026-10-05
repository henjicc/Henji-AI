import { beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = (input: unknown) => unknown
type StoreMock = Record<string, ReturnType<typeof vi.fn<unknown[], unknown>>>
const mock = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  history: {} as StoreMock,
  presets: {} as StoreMock,
  settings: {} as StoreMock,
}))

vi.mock('./registry', () => ({
  parseVoid: (input: unknown) => { if (input !== undefined) throw new Error('Expected no IPC payload') },
  registerIpcHandler: (channel: string, parse: (input: unknown) => unknown, handler: (input: unknown) => unknown) => {
    mock.handlers.set(channel, (input) => handler(parse(input)))
  },
}))
vi.mock('../services/generation-history/store', () => ({ getGenerationHistoryStore: () => mock.history }))
vi.mock('../services/presets/store', () => ({ getPresetStore: () => mock.presets }))
vi.mock('../services/settings/store', () => ({ getSettingsStore: () => mock.settings }))

import { createGenerationHistoryApi, createPresetsApi, createSettingsApi } from '../../preload/local-records-api'
import { registerLocalRecordsIpc } from './local-records'

async function invoke<T>(channel: string, payload?: unknown): Promise<T> {
  const handler = mock.handlers.get(channel)
  if (!handler) throw new Error(`未注册的通道：${channel}`)
  return await handler(payload) as T
}

function stub(methods: string[]): StoreMock {
  return Object.fromEntries(methods.map((method) => [method, vi.fn((..._args: unknown[]): unknown => method)]))
}

const record = {
  id: 'h1', providerId: 'kie', modelId: 'model', type: 'image' as const, prompt: '提示词', params: { a: 1 },
  resultPaths: ['/work/a.png', '/work/b.png'], taskId: null, status: 'success' as const, errorMessage: null, cost: null, duration: null,
}

beforeEach(() => {
  mock.handlers.clear()
  mock.history = stub(['list', 'get', 'count', 'insert', 'insertMany', 'update', 'delete', 'deleteMany', 'clear'])
  mock.presets = stub(['list', 'get', 'insert', 'update', 'delete', 'incrementUsage'])
  mock.settings = stub(['getEntry', 'set', 'delete'])
  registerLocalRecordsIpc()
})

describe('本地记录 IPC 契约（preload 桥 → 主进程校验 → 仓库）', () => {
  it('生成记录：每个方法都注册了通道，参数原样到达仓库；结果只接受路径数组', async () => {
    const history = createGenerationHistoryApi(invoke)
    await history.list()
    expect(mock.history.list).toHaveBeenLastCalledWith({})
    await history.list({ search: '猫', idPrefix: 'fixture_', limit: 10 })
    expect(mock.history.list).toHaveBeenLastCalledWith({ search: '猫', idPrefix: 'fixture_', limit: 10 })
    await history.get('h1'); expect(mock.history.get).toHaveBeenLastCalledWith('h1')
    await history.count(); expect(mock.history.count).toHaveBeenCalledTimes(1)
    await history.insert(record); expect(mock.history.insert).toHaveBeenLastCalledWith(record)
    await history.insertMany([record]); expect(mock.history.insertMany).toHaveBeenLastCalledWith([record])
    await history.update('h1', { resultPaths: [] }); expect(mock.history.update).toHaveBeenLastCalledWith('h1', { resultPaths: [] })
    await history.delete('h1'); expect(mock.history.delete).toHaveBeenLastCalledWith('h1')
    await history.deleteMany(['h1']); expect(mock.history.deleteMany).toHaveBeenLastCalledWith(['h1'])
    await history.clear(); expect(mock.history.clear).toHaveBeenLastCalledWith(undefined)
    await history.clear('2026-01-01T00:00:00.000Z'); expect(mock.history.clear).toHaveBeenLastCalledWith('2026-01-01T00:00:00.000Z')

    // 旧写法（||| 拼成一列）与多余字段在主进程入口就被拒绝。
    await expect(history.insert({ ...record, filePath: 'a|||b' } as unknown as typeof record)).rejects.toThrow()
    await expect(history.update('h1', { resultPaths: 'a|||b' } as unknown as { resultPaths: string[] })).rejects.toThrow()
    await expect(history.insert({ ...record, resultPaths: [''] })).rejects.toThrow()
  })

  it('预设与设置：参数原样到达仓库，类型不对时拒绝', async () => {
    const presets = createPresetsApi(invoke)
    const preset = { id: 'p1', name: '预设', description: null, modelId: null, params: { a: 1 }, isFavorite: false }
    await presets.list({ modelId: null }); expect(mock.presets.list).toHaveBeenLastCalledWith({ modelId: null })
    await presets.get('p1'); expect(mock.presets.get).toHaveBeenLastCalledWith('p1')
    await presets.insert(preset); expect(mock.presets.insert).toHaveBeenLastCalledWith(preset)
    await presets.update('p1', { isFavorite: true }); expect(mock.presets.update).toHaveBeenLastCalledWith('p1', { isFavorite: true })
    await presets.delete('p1'); expect(mock.presets.delete).toHaveBeenLastCalledWith('p1')
    await presets.incrementUsage('p1'); expect(mock.presets.incrementUsage).toHaveBeenLastCalledWith('p1')

    const settings = createSettingsApi(invoke)
    await settings.get('theme'); expect(mock.settings.getEntry).toHaveBeenLastCalledWith('theme')
    await settings.set('theme', 'dark'); expect(mock.settings.set).toHaveBeenLastCalledWith('theme', 'dark', undefined)
    await settings.set('voice', '[]', 'json'); expect(mock.settings.set).toHaveBeenLastCalledWith('voice', '[]', 'json')
    await settings.delete('theme'); expect(mock.settings.delete).toHaveBeenLastCalledWith('theme')
    await expect(settings.set('theme', 'dark', 'xml' as unknown as 'json')).rejects.toThrow()
  })
})
