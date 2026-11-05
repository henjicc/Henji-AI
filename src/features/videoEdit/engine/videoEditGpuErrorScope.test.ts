import { afterEach, expect, it, vi } from 'vitest'
import type { GpuDevice } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import { guardVideoEditGpu, setVideoEditGpuFaultObserver, videoEditGpuLedger } from './videoEditGpuErrorScope'

function device(errors: Array<{ message: string } | null>) {
  const scopes: string[] = []
  return { scopes, device: {
    pushErrorScope(filter: string) { scopes.push(filter) },
    popErrorScope() { scopes.pop(); return Promise.resolve(errors.shift() ?? null) },
  } as unknown as GpuDevice }
}

it('提交里的校验错误让这一帧失败，而不是当成画好了', async () => {
  const fake = device([null, { message: '[Buffer] used in submit while destroyed.' }])
  await expect(guardVideoEditGpu(fake.device, '三维渲染', () => 1)).rejects.toThrow('三维渲染失败：[Buffer] used in submit while destroyed.')
  expect(fake.scopes).toEqual([])
})

it('没有错误时返回结果；同步抛出的异常照常抛出且作用域已弹出', async () => {
  const ok = device([null, null])
  await expect(guardVideoEditGpu(ok.device, '三维渲染', () => 7)).resolves.toBe(7)
  const failing = device([null, null])
  await expect(guardVideoEditGpu(failing.device, '三维渲染', () => { throw new Error('作者场景已过期') })).rejects.toThrow('作者场景已过期')
  expect(failing.scopes).toEqual([])
})

/** 作用域栈与真实设备一样：错误落进栈顶同类作用域；没有作用域接住就成为未捕获错误。 */
function scopedDevice() {
  const stack: Array<{ filter: string; error: { message: string } | null }> = []
  const listeners: Array<(event: { error: { message: string } }) => void> = []
  let pendingSubmitError: string | undefined
  const raise = (message: string, filter = 'validation'): void => {
    const scope = [...stack].reverse().find(entry => entry.filter === filter)
    if (scope) scope.error ??= { message }
    else listeners.forEach(listener => listener({ error: { message } }))
  }
  const submit = vi.fn(() => { if (pendingSubmitError) { raise(pendingSubmitError); pendingSubmitError = undefined } })
  const device = {
    queue: { submit },
    pushErrorScope(filter: string) { stack.push({ filter, error: null }) },
    popErrorScope() { return Promise.resolve(stack.pop()!.error) },
    addEventListener(_type: string, listener: (event: { error: { message: string } }) => void) { listeners.push(listener) },
  } as unknown as GpuDevice
  return { device, stack, raise, submit, failNextSubmit(message: string) { pendingSubmitError = message } }
}
const stops: Array<() => void> = []
function observed() { const report = vi.fn(); stops.push(setVideoEditGpuFaultObserver(report)); return report }
afterEach(() => { stops.splice(0).forEach(stop => stop()) })
const settled = async (): Promise<void> => { await new Promise(resolve => setTimeout(resolve, 0)) }
const submit = (device: GpuDevice): void => { (device.queue as unknown as { submit(commands: unknown[]): void }).submit([]) }

it('提交错误不再成为未捕获错误：入账并记日志，没有窗口时不留条目', async () => {
  const fake = scopedDevice(); const report = observed(); const ledger = videoEditGpuLedger(fake.device)
  fake.failNextSubmit('提交失败-1')
  submit(fake.device)
  expect(fake.stack).toEqual([])
  await settled()
  expect(report).toHaveBeenCalledWith('video_edit.gpu.submit.failed', '提交失败-1', undefined)
  expect(ledger.retained).toBe(0)
})

it('窗口只收 end() 之前、open() 之后的提交', async () => {
  const fake = scopedDevice(); observed(); const ledger = videoEditGpuLedger(fake.device)
  fake.failNextSubmit('窗口之前'); submit(fake.device)
  const window = ledger.open()
  fake.failNextSubmit('窗口之内'); submit(fake.device)
  window.end()
  fake.failNextSubmit('窗口之后'); submit(fake.device)
  expect((await window.settle()).map(fault => fault.message)).toEqual(['窗口之内'])
  await settled()
  expect(ledger.retained).toBe(0); expect(ledger.openWindows).toBe(0)
})

it('同步守卫认领自己的提交，不被并发窗口重复报，也不收并发窗口的错误', async () => {
  const fake = scopedDevice(); observed(); const ledger = videoEditGpuLedger(fake.device)
  const outer = ledger.open()
  fake.failNextSubmit('外层提交'); submit(fake.device)
  await expect(guardVideoEditGpu(fake.device, '三维渲染', () => { fake.failNextSubmit('守卫提交'); submit(fake.device) })).rejects.toThrow('三维渲染失败：守卫提交')
  await guardVideoEditGpu(fake.device, '三维渲染', () => 1)
  expect((await outer.settle()).map(fault => fault.message)).toEqual(['外层提交'])
})

it('守卫里提交以外的错误由守卫自己的作用域接住，不成为未捕获错误', async () => {
  const fake = scopedDevice(); const report = observed()
  await expect(guardVideoEditGpu(fake.device, '三维渲染', () => { fake.raise('写缓冲越界') })).rejects.toThrow('三维渲染失败：写缓冲越界')
  expect(report).not.toHaveBeenCalled()
})

it('未捕获错误只记日志，不进窗口', async () => {
  const fake = scopedDevice(); const report = observed(); const ledger = videoEditGpuLedger(fake.device)
  const window = ledger.open()
  fake.raise('队列写入失败')
  expect(report).toHaveBeenCalledWith('video_edit.gpu.uncaptured_error', '队列写入失败', undefined)
  expect(await window.settle()).toEqual([])
})

it('放弃与重复结清都是幂等的，结清后错误条目被清掉', async () => {
  const fake = scopedDevice(); observed(); const ledger = videoEditGpuLedger(fake.device)
  const dropped = ledger.open()
  fake.failNextSubmit('没人要'); submit(fake.device)
  dropped.discard(); dropped.discard()
  expect(await dropped.settle()).toEqual([])
  await settled()
  expect(ledger.retained).toBe(0); expect(ledger.openWindows).toBe(0)
  const kept = ledger.open()
  fake.failNextSubmit('有人要'); submit(fake.device)
  const first = kept.settle(); const again = kept.settle()
  expect(await first).toBe(await again)
  await settled()
  expect(ledger.retained).toBe(0)
})

it('同一设备只收口一次；同一消息每秒只记一条', async () => {
  const fake = scopedDevice(); const report = observed()
  const ledger = videoEditGpuLedger(fake.device)
  const wrapped = (fake.device.queue as unknown as { submit: unknown }).submit
  expect(videoEditGpuLedger(fake.device)).toBe(ledger)
  expect((fake.device.queue as unknown as { submit: unknown }).submit).toBe(wrapped)
  for (let index = 0; index < 3; index++) { fake.failNextSubmit('重复错误'); submit(fake.device) }
  await settled()
  expect(report).toHaveBeenCalledOnce()
  expect(fake.submit).toHaveBeenCalledTimes(3)
})
