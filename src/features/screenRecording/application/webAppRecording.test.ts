import { afterEach, expect, it, vi } from 'vitest'

const boundary = vi.hoisted(() => ({ enabled: false, render: vi.fn(), read: vi.fn() }))
vi.mock('@/platform', () => ({ getPlatform: () => ({ webReplay: { render: boundary.render, read: boundary.read } }) }))
vi.mock('../useWebAppRecordingSwitch', () => ({ webAppRecordingEnabled: () => boundary.enabled, WEB_APP_RECORDING_DISABLED_MESSAGE: '网页应用录制是实验性功能，尚未开启' }))

import { executeWebAppCapability } from './webAppRecording'
import { readWebAppRecordingCapability, renderWebAppReplayCapability } from '@/core/application-control/domains/screenRecording/webAppCapability'
import type { CapabilityExecutionContext } from '@/features/application-control'

const recordingRef = { kind: 'screen_recording.web_recording' as const, id: '4c4fd189-61bf-4408-afc0-751c8c9ede67' }
afterEach(() => { boundary.enabled = false; vi.clearAllMocks() })

it('实验开关没开时的拒绝标成未执行：打开开关后可以直接重试，不会被当成结果未知挡住', async () => {
  const error = await executeWebAppCapability('render_web_app_replay', { recordingRef: { kind: 'screen_recording.web_recording', id: '4c4fd189-61bf-4408-afc0-751c8c9ede67' } }, {} as never).then(() => null, (value: unknown) => value)
  expect((error as Error).message).toContain('尚未开启')
  expect((error as { details?: { execution?: { notExecuted?: boolean } } }).details?.execution?.notExecuted).toBe(true)
})

it('boxes 参数经正式能力 schema 到平台，读取无需开启实验开关，权限照常检查', async () => {
  const result = { entries: [{ key: 'node-a', seconds: 1.5, rect: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 } }], total: 1, nextOffset: null }
  boundary.read.mockResolvedValue(result)
  const input = { recordingRef, track: 'boxes', keyPrefix: 'node-', fromSeconds: 1.5, toSeconds: 2 }
  expect(await executeWebAppCapability('read_web_app_recording', input, {} as CapabilityExecutionContext)).toEqual(result)
  expect(boundary.read).toHaveBeenCalledWith({ recordingId: recordingRef.id, track: 'boxes', keyPrefix: 'node-', fromSeconds: 1.5, toSeconds: 2, offset: 0, limit: 50 })
  expect(readWebAppRecordingCapability.outputSchema.safeParse({ ...result, revision: 0, scopeRevisions: {} }).success).toBe(true)
  await expect(executeWebAppCapability('read_web_app_recording', input, { callerGrant: { permissions: [] } } as unknown as CapabilityExecutionContext)).rejects.toThrow('PERMISSION_DENIED')
  expect(boundary.read).toHaveBeenCalledTimes(1)
})

it.each([false, true])('boxSelectors 通过正常视频/textOnly=%s 重演入口，保留指定帧率', async textOnly => {
  boundary.enabled = true
  boundary.render.mockResolvedValue({ output: 'output', width: 100, height: 100, frames: 60, issues: [] })
  await executeWebAppCapability('render_web_app_replay', { recordingRef, boxSelectors: ['.ask', '.crumbs'], fps: 60, textOnly }, { signal: new AbortController().signal } as CapabilityExecutionContext)
  expect(boundary.render).toHaveBeenCalledWith({ recordingId: recordingRef.id, pointer: false, fps: 60, boxSelectors: ['.ask', '.crumbs'], ...(textOnly ? { textOnly: true } : {}) })
})

it('正式输入拒绝超过 32 个选择器、倒序时间范围与超额分页', () => {
  expect(renderWebAppReplayCapability.inputSchema.safeParse({ recordingRef, boxSelectors: Array(33).fill('.ask') }).success).toBe(false)
  expect(readWebAppRecordingCapability.inputSchema.safeParse({ recordingRef, track: 'boxes', fromSeconds: 3, toSeconds: 1 }).success).toBe(false)
  expect(readWebAppRecordingCapability.inputSchema.safeParse({ recordingRef, track: 'boxes', limit: 201 }).success).toBe(false)
})

it('导演稿经正式能力 schema 补上默认值后到平台，版本信息原样交回', async () => {
  boundary.enabled = true
  const take = { name: '首问', directory: 'D:/x/takes/首问', video: 'D:/x/takes/首问/video.mp4', frames: 1800, durationMs: 30000, fps: 60, pointer: false, createdAt: '2026-10-28T00:00:00.000Z', conflicts: 0, steps: ['typewriter[0]（逐字打字）'] }
  boundary.render.mockResolvedValue({ output: take.video, width: 3840, height: 2464, frames: 1800, issues: [{ t: 0, kind: 'conflict', message: '导演稿 typewriter[0]（逐字打字） 引起：这一步会发出录制里没有的请求：POST https://x' }], take })
  const input = { recordingRef, fps: 60, resolution: '4k', take: '首问', director: { version: 1, timeline: { segments: [{ from: 0, to: 11.2 }, { from: 41.4, to: 52.2, speed: 3 }], ramp: 0.4 }, typewriter: [{ at: 36.8 }] } }
  const output = await executeWebAppCapability('render_web_app_replay', input, { signal: new AbortController().signal } as CapabilityExecutionContext)
  expect(boundary.render).toHaveBeenCalledWith({ recordingId: recordingRef.id, pointer: false, fps: 60, longEdge: 3840, take: '首问', director: { version: 1, timeline: { segments: [{ from: 0, to: 11.2, speed: 1 }, { from: 41.4, to: 52.2, speed: 3 }], ramp: 0.4 }, typewriter: [{ at: 36.8, charsPerSecond: 12, jitter: 0.3 }] } })
  expect(output).toMatchObject({ video: take.video, conflicts: [expect.stringContaining('导演稿 typewriter[0]')], take: { name: '首问', durationMs: 30000, steps: take.steps } })
  expect(renderWebAppReplayCapability.outputSchema.safeParse({ ...output, revision: 0, scopeRevisions: {} }).success).toBe(true)
})

it('导演稿不对时点名字段，且标成未执行', async () => {
  boundary.enabled = true
  const parsed = renderWebAppReplayCapability.inputSchema.safeParse({ recordingRef, director: { version: 1, timeline: { segments: [{ from: 5, to: 2 }] } } })
  expect(parsed.success).toBe(false)
  expect(parsed.error!.issues.map(issue => issue.path.join('.'))).toEqual(['director.timeline.segments.0.to'])
  expect(renderWebAppReplayCapability.inputSchema.safeParse({ recordingRef, director: { version: 1 }, directorFile: 'D:/a.json' }).success).toBe(false)
  // 文件里的导演稿在主进程校验：那里的拒绝按名字认出来
  boundary.render.mockRejectedValue(Object.assign(new Error('导演稿有 1 处不对：actions[0].target.selector：目标要给 selector、text 或 x/y 之一'), { name: 'WebReplayDirectorError' }))
  const error = await executeWebAppCapability('render_web_app_replay', { recordingRef, directorFile: 'D:/a.json' }, { signal: new AbortController().signal } as CapabilityExecutionContext).then(() => null, (value: unknown) => value)
  expect((error as Error).message).toContain('actions[0].target.selector')
  expect((error as { details?: { execution?: { notExecuted?: boolean } } }).details?.execution?.notExecuted).toBe(true)
})

it('读版本的轨道：timemap 只属于版本', async () => {
  boundary.read.mockResolvedValue({ entries: [], total: 0, nextOffset: null })
  await executeWebAppCapability('read_web_app_recording', { recordingRef, track: 'behavior', take: '首问' }, {} as CapabilityExecutionContext)
  expect(boundary.read).toHaveBeenCalledWith({ recordingId: recordingRef.id, track: 'behavior', take: '首问', offset: 0, limit: 50 })
  expect(readWebAppRecordingCapability.inputSchema.safeParse({ recordingRef, track: 'timemap' }).success).toBe(false)
  expect(readWebAppRecordingCapability.inputSchema.safeParse({ recordingRef, track: 'timemap', take: '首问' }).success).toBe(true)
})
