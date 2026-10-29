import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import path from 'node:path'
const boundary = vi.hoisted(() => ({ handlers: new Map<string, { parse: (input: unknown) => unknown; run: (input: unknown, event: unknown) => unknown }>(), realpath: vi.fn(), detect: vi.fn(), cancel: vi.fn() }))
vi.mock('./registry', () => ({ parseRecord: (v: unknown) => v, registerIpcHandler: (channel: string, parse: (input: unknown) => unknown, run: (input: unknown, event: unknown) => unknown) => boundary.handlers.set(channel, { parse, run }) }))
vi.mock('node:fs/promises', () => ({ default: { realpath: boundary.realpath } }))
vi.mock('../protocol', () => ({ isPathWithinAllowedMediaRoots: (source: string) => source.includes('fixture') }))
vi.mock('../services/image/source', () => ({ normalizeLocalSource: (source: string) => source }))
vi.mock('../services/smart-regions/runtime', () => ({ getOcrPrivacyService: () => ({ detect: boundary.detect, cancel: boundary.cancel }), getSmartRegionService: () => ({}) }))
import { registerSmartRegionsIpc } from './smart-regions'
import { SMART_REGIONS_IPC_CHANNELS as channels } from '../../../src/platform/contracts/smartRegions'
beforeEach(() => { vi.resetAllMocks(); boundary.handlers.clear(); registerSmartRegionsIpc(); boundary.realpath.mockImplementation(async source => source); boundary.detect.mockResolvedValue({ privacy: { candidates: [], warnings: [] }, frames: 10, inferredFrames: 1 }) })
afterEach(() => { vi.restoreAllMocks() })
const source = path.resolve(path.sep, 'fixture', 'source.mp4')
const request = { requestId: '00000000-0000-4000-8000-000000000001', source, mediaId: 'screen', startUs: 0, endUs: 1000000, originUs: 0 }
function sender(id: number): EventEmitter & { id: number; isDestroyed(): boolean } { return Object.assign(new EventEmitter(), { id, isDestroyed: () => false }) }
function invoke(channel: string, input: unknown, owner: ReturnType<typeof sender>): Promise<unknown> { const handler = boundary.handlers.get(channel)!; return Promise.resolve(handler.run(handler.parse(input), { sender: owner })) }
it('原始路径与realpath都校验；跨窗口取消拒绝，授权完成前取消也不派发OCR', async () => {
  let release!: (v: string) => void
  boundary.realpath.mockImplementationOnce(() => new Promise<string>(resolve => { release = resolve }))
  const owner = sender(1), pending = invoke(channels.detectSensitiveText, request, owner)
  expect(() => invoke(channels.cancelSensitiveText, { requestId: request.requestId }, sender(2))).toThrow('其他窗口')
  await invoke(channels.cancelSensitiveText, { requestId: request.requestId }, owner); release(source)
  await expect(pending).rejects.toThrow('取消'); expect(boundary.detect).not.toHaveBeenCalled()
  boundary.realpath.mockResolvedValueOnce(path.resolve(path.sep, 'outside', 'source.mp4'))
  boundary.detect.mockResolvedValue({ regions: [] })
  await invoke(channels.detectSensitiveText, request, owner)
  expect(boundary.detect.mock.calls.at(-1)?.[0]).toMatchObject({ source })
})
it('宿主销毁在路径解析期间结束任务，未知字段和范围反转被严格拒绝', async () => {
  let release!: (v: string) => void; boundary.realpath.mockImplementationOnce(() => new Promise<string>(resolve => { release = resolve }))
  const owner = sender(1), pending = invoke(channels.detectSensitiveText, request, owner)
  owner.emit('destroyed'); release(source); await expect(pending).rejects.toThrow('取消')
  expect(boundary.detect).not.toHaveBeenCalled()
  expect(() => invoke(channels.detectSensitiveText, { ...request, text: 'secret' }, owner)).toThrow()
  expect(() => invoke(channels.detectSensitiveText, { ...request, endUs: 0 }, owner)).toThrow()
})
