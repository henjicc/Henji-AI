import { expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ own: true, calls: [] as unknown[] }))
const start = new Date(2026, 9, 14, 12).getTime(), sessionId = 'recording'
vi.mock('@/platform', () => ({ getPlatform: () => ({ logging: {
  listLogDates: async () => ['2026-10-14', '2026-10-01'],
  queryLogEvents: async (params: { keyword?: string; date: string }) => {
    state.calls.push(params)
    if (params.keyword) return { hasMore: false, events: [{ timestamp: new Date(start + 1000).toISOString(), event: 'recording.capture.prepare.completed', context: { monoUs: 1e6, capturesApplication: state.own, sessionId } }] }
    return { hasMore: false, events: [{ timestamp: new Date(start + 2000).toISOString(), level: 'error', domain: 'main.video', event: 'render.failed', message: 'secret-key', context: { token: 'secret' } }, { timestamp: new Date(start + 10000).toISOString(), level: 'error', domain: 'main.video', event: 'other.failed' }] }
  },
} }) }))
import { recordingProductLogs } from './recordingProductLogs'
it('只关联本应用与同一源时间，报告不含正文密钥、context或区间外日志', async () => {
  const steps = [{ id: 'step', title: '步骤', description: '', startUs: 1e6, endUs: 3e6, representativeUs: 2e6, image: 'step.png' }]
  const result = await recordingProductLogs(sessionId, start, steps, new AbortController().signal)
  expect(result.text).toContain('render.failed'); expect(result.text).not.toContain('secret'); expect(result.text).not.toContain('other.failed')
  expect(state.calls).not.toContainEqual(expect.objectContaining({ date: '2026-10-01' }))
  state.own = false
  expect((await recordingProductLogs(sessionId, start, steps, new AbortController().signal)).text).toBe('')
})
