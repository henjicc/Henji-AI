import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocalInferenceHost, type LocalInferenceChild } from './host'
import type { LocalInferenceEvent, LocalInferenceRequest, SmartRegionAnalysisJob, SmartRegionAnalysisResult } from './protocol'

class FakeChild extends EventEmitter implements LocalInferenceChild {
  readonly sent: LocalInferenceRequest[] = []
  killed = false
  postMessage(message: LocalInferenceRequest): void { this.sent.push(message) }
  kill(): boolean { this.killed = true; return true }
  reply(message: LocalInferenceEvent): void { this.emit('message', message) }
}

const job = (id: string): SmartRegionAnalysisJob => ({ id, kind: 'face', models: [], ffmpegPath: '', source: '', seekSeconds: 0, durationSeconds: 1, startUs: 0, endUs: 1e6, fps: 30, display: { width: 1, height: 1 }, outputPath: '', providers: ['cpu'] })
const result: SmartRegionAnalysisResult = { model: 'yunet', provider: 'dml', frames: 30, summary: { value: 1, peak: 1 }, decodeMs: 1, inferenceMs: 2, durationMs: 3 }

describe('本地推理宿主', () => {
  afterEach(() => { vi.useRealTimers() })

  it('按需启动后台进程，转发进度、日志与结果；空闲后结束进程，再次分析重新启动', async () => {
    vi.useFakeTimers()
    const children: FakeChild[] = []
    const log = vi.fn()
    const host = new LocalInferenceHost({ fork: () => { const child = new FakeChild(); children.push(child); return child }, log, idleMs: 1000 })
    expect(children).toHaveLength(0)
    const progress = vi.fn()
    const pending = host.analyze(job('a'), progress)
    expect(children[0].sent).toEqual([{ type: 'analyze', job: job('a') }])
    children[0].reply({ type: 'progress', id: 'a', done: 3, total: 30 })
    children[0].reply({ type: 'log', level: 'warn', message: '回退', event: 'local_inference.provider.fallback', context: { provider: 'dml' } })
    children[0].reply({ type: 'done', id: 'a', result })
    await expect(pending).resolves.toEqual(result)
    expect(progress).toHaveBeenCalledWith(3, 30)
    expect(log).toHaveBeenCalledWith('warn', '回退', 'local_inference.provider.fallback', { provider: 'dml' })
    vi.advanceTimersByTime(1000)
    expect(children[0].killed).toBe(true)
    void host.analyze(job('b'))
    expect(children).toHaveLength(2)
  })

  it('失败带原因；取消发给后台进程；进程意外退出时进行中的分析失败', async () => {
    const child = new FakeChild()
    const host = new LocalInferenceHost({ fork: () => child, log: vi.fn() })
    const failed = host.analyze(job('a'))
    child.reply({ type: 'failed', id: 'a', code: 'decode', message: '解码失败' })
    await expect(failed).rejects.toMatchObject({ code: 'decode', message: '解码失败' })
    const running = host.analyze(job('b'))
    host.cancel('b')
    expect(child.sent.at(-1)).toEqual({ type: 'cancel', id: 'b' })
    child.emit('exit', 1)
    await expect(running).rejects.toMatchObject({ code: 'inference' })
  })
})
