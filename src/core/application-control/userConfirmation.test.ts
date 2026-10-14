import { afterEach, expect, it, vi } from 'vitest'
import { bindApplicationConfirmation, inheritApplicationConfirmation, hasApplicationConfirmation, withApplicationConfirmation, USER_CONFIRMATION_TIMEOUT_MS } from './userConfirmation'
import { ApplicationPreflightFailure } from './execution/transactionFailure'

afterEach(() => { vi.useRealTimers() })
const request = { title: '确认费用', message: '按模型计费', confirmLabel: '继续' }

it('可取消子任务继承正式确认通道，释放后不污染父调用或其他调用', async () => {
  const parent = new AbortController(), child = new AbortController(), other = new AbortController()
  const sink = vi.fn().mockResolvedValue(undefined), unbind = bindApplicationConfirmation(parent.signal, sink)
  const release = inheritApplicationConfirmation(parent.signal, child.signal)
  expect(hasApplicationConfirmation(child.signal)).toBe(true)
  expect(hasApplicationConfirmation(other.signal)).toBe(false)
  await withApplicationConfirmation(child.signal, request, async () => true)
  expect(sink).toHaveBeenCalledTimes(2)
  release(); expect(hasApplicationConfirmation(child.signal)).toBe(false)
  expect(hasApplicationConfirmation(parent.signal)).toBe(true); unbind()
})

it('等待状态先持久确认，点击后执行状态也先持久确认；信号隔离 UI 与并行调用', async () => {
  const controller = new AbortController()
  const progress = vi.fn().mockResolvedValue(undefined)
  const unbind = bindApplicationConfirmation(controller.signal, progress)
  let accept!: (value: boolean) => void
  const prompt = vi.fn(() => new Promise<boolean>(resolve => { accept = resolve }))
  const result = withApplicationConfirmation(controller.signal, request, prompt)
  await vi.waitFor(() => expect(prompt).toHaveBeenCalledOnce())
  expect(progress).toHaveBeenCalledWith({ phase: 'awaiting_user_confirmation', confirmation: expect.objectContaining({ title: request.title, purpose: 'execution', continuation: expect.stringContaining('不要重复提交') }) })
  expect(prompt).toHaveBeenCalledOnce()
  await withApplicationConfirmation(new AbortController().signal, request, async () => false)
  expect(progress).toHaveBeenCalledTimes(1)
  accept(true)
  await expect(result).resolves.toBe(true)
  expect(progress).toHaveBeenLastCalledWith({ phase: 'executing' })
  unbind()
})

it.each(['reject', 'timeout', 'abort'] as const)('%s 明确未执行且不进入恢复执行状态', async mode => {
  vi.useFakeTimers()
  const controller = new AbortController()
  const progress = vi.fn().mockResolvedValue(undefined)
  const unbind = bindApplicationConfirmation(controller.signal, progress)
  const result = withApplicationConfirmation(controller.signal, request, async signal => mode === 'reject' ? false : new Promise(resolve => signal!.addEventListener('abort', () => resolve(false), { once: true })))
  const assertion = expect(result).rejects.toBeInstanceOf(ApplicationPreflightFailure)
  await vi.advanceTimersByTimeAsync(0)
  if (mode === 'abort') controller.abort()
  if (mode === 'timeout') await vi.advanceTimersByTimeAsync(USER_CONFIRMATION_TIMEOUT_MS)
  await assertion
  expect(progress).toHaveBeenCalledTimes(1)
  expect(vi.getTimerCount()).toBe(0)
  unbind()
})

it('等待回执持久化失败不展示可执行的确认；确认后恢复回执失败不执行', async () => {
  const signal = new AbortController().signal
  const progress = vi.fn().mockRejectedValueOnce(new Error('账本不可用')).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('授权撤销'))
  const unbind = bindApplicationConfirmation(signal, progress)
  const prompt = vi.fn(async () => true)
  await expect(withApplicationConfirmation(signal, request, prompt)).rejects.toThrow('账本不可用')
  expect(prompt).not.toHaveBeenCalled()
  await expect(withApplicationConfirmation(signal, request, prompt)).rejects.toThrow('授权撤销')
  unbind()
})
