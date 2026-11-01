import { expect, it, vi } from 'vitest'
import { WebCacheSubmissions } from './submissions'

it('抢占排空已提交工作；重叠活动全部结束前不提交，恢复瞬间再次抢占也不漏提交', async () => {
  const gate = new WebCacheSubmissions({ info: vi.fn() })
  let finish!: () => void
  const inFlight = gate.run(() => new Promise<void>(resolve => { finish = resolve }))
  const playing = gate.hold('playing'), observing = gate.hold('observation')
  const next = vi.fn(async () => 'same-session'), pending = gate.run(next)
  expect(gate.state).toMatchObject({ active: 1, submitted: 1, paused: true })
  let drained = false
  void playing.drained.then(() => { drained = true })
  await Promise.resolve(); expect(drained).toBe(false)
  finish(); await inFlight; await playing.drained
  expect(gate.state.active).toBe(0)
  playing.resume(); await Promise.resolve(); expect(next).not.toHaveBeenCalled()
  observing.resume()
  const again = gate.hold('scrubbing')
  await Promise.resolve(); expect(next).not.toHaveBeenCalled()
  again.resume(); expect(await pending).toBe('same-session')
  expect(next).toHaveBeenCalledOnce()
  expect(gate.state).toEqual({ paused: false, active: 0, submitted: 2, completed: 2 })
})

it('暂停等待中取消立即退出且不执行；后续任务仍可恢复', async () => {
  const gate = new WebCacheSubmissions({ info: vi.fn() }), controller = new AbortController()
  const hold = gate.hold('export'), work = vi.fn(async () => undefined)
  const cancelled = expect(gate.run(work, controller.signal)).rejects.toThrow('cancel')
  controller.abort(new Error('cancel')); await cancelled
  expect(gate.state.submitted).toBe(0)
  hold.resume(); await gate.run(work)
  expect(work).toHaveBeenCalledOnce()
})
