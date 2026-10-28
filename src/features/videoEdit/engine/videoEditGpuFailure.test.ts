import { afterEach, expect, it, vi } from 'vitest'
import { installVideoEditWorkerErrorReporting, VideoEditRenderRecovery, VideoEditRenderWorkerError } from './videoEditGpuFailure'
import type { RenderLogMessage } from './videoEditWorker'

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
it('共享恢复窗口在 30 秒内只允许两次，窗口过后或显式重试重新计数', () => {
  vi.useFakeTimers()
  const recovery = new VideoEditRenderRecovery()
  expect(recovery.nextDelay()).toBe(250)
  expect(recovery.nextDelay()).toBe(500)
  expect(recovery.nextDelay()).toBeUndefined()
  vi.advanceTimersByTime(30_000)
  expect(recovery.nextDelay()).toBe(250)
  recovery.reset(); expect(recovery.attempts).toBe(0); expect(recovery.nextDelay()).toBe(250)
})
it('Worker 内监听未捕获异常及未处理拒绝，发送原始消息和堆栈，不吞掉默认异常传播', () => {
  const listeners: Record<string, (event: never) => void> = {}
  const messages: RenderLogMessage[] = []
  installVideoEditWorkerErrorReporting({ addEventListener: (type, listener) => { listeners[type] = listener }, postMessage: message => { messages.push(message) } })
  const error = new ReferenceError('missingSymbol is not defined')
  const preventDefault = vi.fn()
  listeners.error({ message: error.message, error, filename: 'blob:author', lineno: 9, colno: 4, preventDefault } as never)
  listeners.unhandledrejection({ reason: error, preventDefault } as never)
  expect(messages).toEqual([
    expect.objectContaining({ kind: 'log', event: 'video_edit.render.worker.uncaught_error', context: { message: error.message, filename: 'blob:author', line: 9, column: 4, stack: error.stack } }),
    expect.objectContaining({ kind: 'log', event: 'video_edit.render.worker.unhandled_rejection', context: { message: error.message, stack: error.stack } }),
  ])
  expect(preventDefault).not.toHaveBeenCalled()
})
it('作者错误保留可修正的原始消息和位置并截断，监视器仍使用通用错误', () => {
  const error = new VideoEditRenderWorkerError('画面处理已中断', undefined, { message: `ReferenceError: ${'x'.repeat(2000)}`, filename: 'main.js', line: 12, column: 9 })
  expect(error.message).toBe('画面处理已中断')
  expect(error.authorError().message).toMatch(/^ReferenceError:.*（main.js:12:9）$/)
  expect(error.authorError().message.length).toBeLessThan(1000)
})
it('逐帧重复拒绝最多每秒记录一次，后续时段仍能保留诊断', () => {
  const now = vi.spyOn(performance, 'now').mockReturnValue(0)
  const listeners: Record<string, (event: never) => void> = {}, messages: RenderLogMessage[] = []
  installVideoEditWorkerErrorReporting({ addEventListener: (type, listener) => { listeners[type] = listener }, postMessage: message => { messages.push(message) } })
  const event = { reason: new Error('Failed to fetch') } as never
  for (let frame = 0; frame < 60; frame++) listeners.unhandledrejection(event)
  expect(messages).toHaveLength(1)
  now.mockReturnValue(999); listeners.unhandledrejection(event); expect(messages).toHaveLength(1)
  now.mockReturnValue(1000); listeners.unhandledrejection(event); expect(messages).toHaveLength(2)
})
it.each([
  ['无原型对象', Object.create(null) as unknown],
  ['抛出 getter', Object.defineProperty({}, 'message', { get() { throw new Error('读取失败') } }) as unknown],
  ['抛出 Proxy', new Proxy({}, { get() { throw new Error('读取失败') } }) as unknown],
])('%s 拒绝原因的诊断提取不制造新的异常', (_name, reason) => {
  const listeners: Record<string, (event: never) => void> = {}, messages: RenderLogMessage[] = []
  installVideoEditWorkerErrorReporting({ addEventListener: (type, listener) => { listeners[type] = listener }, postMessage: message => { messages.push(message) } })
  expect(() => listeners.unhandledrejection({ reason } as never)).not.toThrow()
  expect(messages).toHaveLength(1)
  expect(messages[0].event).toBe('video_edit.render.worker.unhandled_rejection')
  expect(messages[0].context.message).toBeTypeOf('string')
})
it.each([
  String.raw`C:\Users\private-user\AppData\Local\Henji\resources\app.asar\out\renderer\assets\videoEditWorker-abc.js`,
  'file:///C:/Users/private-user/AppData/Local/Henji/resources/app.asar/out/renderer/assets/videoEditWorker-abc.js',
])('助手错误仅保留文件名，诊断源仍保留完整路径：%s', filename => {
  const error = new VideoEditRenderWorkerError('通用文案', undefined, { message: 'ReferenceError: missingSymbol', filename, line: 8, column: 3 })
  const author = error.authorError()
  expect(author.message).toBe('ReferenceError: missingSymbol（videoEditWorker-abc.js:8:3）')
  expect(author.cause).toBeUndefined(); expect(author.message).not.toContain('private-user')
  expect(error.diagnostic?.filename).toBe(filename)
})
it('导入故障模块本身不注册全局监听', async () => {
  const addEventListener = vi.fn()
  vi.stubGlobal('self', { addEventListener }); vi.resetModules()
  await import('./videoEditGpuFailure')
  expect(addEventListener).not.toHaveBeenCalled()
})
