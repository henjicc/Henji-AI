import { expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { TRACKING_IPC_CHANNELS, type TrackingFrameEvent, type TrackingFrameProvider, type TrackingSequenceSource } from '../../../src/platform/contracts/tracking'
import { createTrackingApi } from '../../preload/tracking-api'
import { parseTrackingCandidates, parseTrackingFrameReply, parseTrackingRun, registerTrackingIpc } from './tracking'

const ipc = vi.hoisted(() => ({ handle: vi.fn(), run: vi.fn() }))
vi.mock('electron', () => ({ ipcMain: { handle: ipc.handle } }))
vi.mock('../services/tracking/runtime', () => ({ getTrackingService: () => ({ run: ipc.run }) }))
vi.mock('../protocol', () => ({ isPathWithinAllowedMediaRoots: () => false }))
const source: TrackingSequenceSource = { kind: 'sequence', signature: 'b9196c8d-7431-5b15-a3c0-c3389738410a', fps: 60, width: 1920, height: 1080 }
const definition = { source, method: 'box', prompts: [{ timeUs: 0, box: [.1, .1, .2, .2] }] }
const input = { definition, range: { startUs: 0, endUs: 1e6 }, options: { direction: 'both' } }
it('IPC严格解析合成源/候选，拒绝伪路径对象及帧回复上限', () => {
  expect(parseTrackingRun(input).definition.source).toEqual(source)
  expect(parseTrackingCandidates({ source, timeUs: 1000000, points: [[.5, .5, 1]] }).source).toEqual(source)
  expect(() => parseTrackingRun({ ...input, definition: { ...definition, source: { ...source, path: '/outside' } } })).toThrow()
  expect(() => parseTrackingRun({ ...input, definition: { ...definition, source: { ...source, width: 8193 } } })).toThrow()
  expect(() => parseTrackingFrameReply({ id: 'reply', frames: Array.from({ length: 9 }, () => new Uint8Array()) })).toThrow()
  expect(() => parseTrackingFrameReply({ id: 'reply', frames: [new Uint8Array(16 * 1024 ** 2 + 1)] })).toThrow('过大')
})
it('preload/PAL语义走原跟踪IPC，主进程只向原窗口拉帧且拒绝另一窗口回复', async () => {
  ipc.handle.mockClear(); registerTrackingIpc()
  const handlers = new Map(ipc.handle.mock.calls.map(([name, handle]) => [name, handle]))
  const events: TrackingFrameEvent[] = []; const owner = Object.assign(new EventEmitter(), { id: 1, isDestroyed: () => false, send: (_channel: string, event: TrackingFrameEvent) => { events.push(event) } })
  const invoke = async <T>(channel: string, payload?: unknown): Promise<T> => {
    const result = await handlers.get(channel)!({ sender: owner }, payload) as { ok: boolean; data: T; error: { message: string } }
    if (!result.ok) throw new Error(result.error.message)
    return result.data
  }
  const subscribe = vi.fn(() => () => {})
  const api = createTrackingApi(invoke, subscribe)
  let provider!: TrackingFrameProvider
  ipc.run.mockImplementation(async (_definition, _range, _options, frames) => { provider = frames; return { state: 'tracking', progress: 0, direction: 'both' } })
  await expect(api.run(parseTrackingRun(input).definition, input.range, { direction: 'both' })).resolves.toMatchObject({ state: 'tracking' })
  const controller = new AbortController(); const read = provider('job', { first: 0, count: 1, width: 1, height: 1 }, controller.signal)
  const event = events[0]; if (event.kind !== 'frames') throw new Error('未发出帧请求')
  const reply = { id: event.id, frames: [new Uint8Array([1, 2, 3])] }
  expect(await handlers.get(TRACKING_IPC_CHANNELS.framesReply)!({ sender: { ...owner, id: 2 } }, reply)).toMatchObject({ ok: false })
  await api.replyFrames(reply); await expect(read).resolves.toEqual(reply.frames)
  api.onFrameRequest(() => {}); expect(subscribe).toHaveBeenCalledWith(TRACKING_IPC_CHANNELS.frames, expect.any(Function))
  controller.abort(); expect(events.at(-1)).toEqual({ kind: 'release', jobId: 'job' })
  await expect(api.run({ ...parseTrackingRun(input).definition, source: '/outside/media.mp4' }, input.range, { direction: 'both' })).rejects.toThrow('权限')
})
