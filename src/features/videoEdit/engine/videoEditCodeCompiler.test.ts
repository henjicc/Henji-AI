import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CodeMaterialProgram } from '@/core/videoEdit/codeMaterial/contract'
import { VideoEditCodeCompiler } from './videoEditCodeCompiler'
import type { CodeCompilerWorker } from './videoEditCodeCompiler'
function worker(): CodeCompilerWorker {
  return { onmessage: null, onerror: null, onmessageerror: null, postMessage: vi.fn(), terminate: vi.fn() }
}
afterEach(() => { vi.useRealTimers() })
it('标准模块打包复用同一线程，取消与旧检查互不串回执', async () => {
  const runtime = worker(); const create = vi.fn(() => runtime)
  const compiler = new VideoEditCodeCompiler(create)
  const files = { entry: 'main.js', files: { 'main.js': '// ' + 'x'.repeat(70000) } }
  const controller = new AbortController()
  const cancelled = compiler.bundle(files, controller.signal)
  const failure = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' })
  const active = compiler.bundle(files)
  expect(runtime.postMessage).toHaveBeenCalledWith({ id: 2, kind: 'author.bundle', files })
  controller.abort(); await failure
  expect(runtime.terminate).not.toHaveBeenCalled()
  const bundle = { code: 'export default {}', map: '{}', locations: { layers: {} } }
  runtime.onmessage!({ data: { id: 1, bundle } } as MessageEvent)
  runtime.onmessage!({ data: { id: 2, bundle, cacheHit: true } } as MessageEvent)
  expect(await active).toBe(bundle)
  expect(create).toHaveBeenCalledOnce()
  expect(compiler.diagnostics().cacheHits).toBe(1)
  compiler.dispose()
})

describe('源码检查线程与有界恢复', () => {
  it('超时终止旧线程、拒绝待完成检查，后续重新创建且旧回执不能完成新请求', async () => {
    vi.useFakeTimers()
    const old = worker(); const next = worker(); const create = vi.fn().mockReturnValueOnce(old).mockReturnValueOnce(next)
    const compiler = new VideoEditCodeCompiler(create, 10)
    const pending = compiler.compile('old'); const failure = expect(pending).rejects.toThrow('时限')
    await vi.advanceTimersByTimeAsync(10); await failure
    expect(old.terminate).toHaveBeenCalledOnce()
    const retry = compiler.compile('new'); const program = { name: '新源码' } as CodeMaterialProgram
    old.onmessage!({ data: { id: 2, program: { name: '旧源码' } as CodeMaterialProgram } } as MessageEvent)
    next.onmessage!({ data: { id: 2, program } } as MessageEvent)
    expect(await retry).toBe(program); compiler.dispose()
  })
  it('取消单个观察不影响其他检查；最后请求取消则释放线程', async () => {
    const runtime = worker(); const compiler = new VideoEditCodeCompiler(() => runtime)
    const signal = new AbortController(); const first = compiler.compile('a', signal.signal); const failure = expect(first).rejects.toMatchObject({ name: 'AbortError' })
    const second = compiler.compile('b'); signal.abort(); await failure
    expect(runtime.terminate).not.toHaveBeenCalled()
    runtime.onmessage!({ data: { id: 2, program: { name: 'B' } as CodeMaterialProgram } } as MessageEvent)
    expect((await second).name).toBe('B')
    const finalSignal = new AbortController(); const final = compiler.compile('c', finalSignal.signal); const finalFailure = expect(final).rejects.toMatchObject({ name: 'AbortError' })
    finalSignal.abort(); await finalFailure; expect(runtime.terminate).toHaveBeenCalledOnce(); compiler.dispose()
  })
  it('超限源码和满队列不分配额外Worker，dispose清理全部期限', async () => {
    vi.useFakeTimers()
    const runtime = worker(); const create = vi.fn(() => runtime); const compiler = new VideoEditCodeCompiler(create)
    await expect(compiler.compile('x'.repeat(65537))).rejects.toThrow('64KiB'); expect(create).not.toHaveBeenCalled()
    const pending = Array.from({ length: 8 }, () => compiler.compile('合法长度')); const failures = pending.map(promise => expect(promise).rejects.toThrow('关闭'))
    await expect(compiler.compile('overflow')).rejects.toThrow('队列'); expect(create).toHaveBeenCalledOnce()
    compiler.dispose(); await Promise.all(failures); expect(vi.getTimerCount()).toBe(0)
  })
  it('已取消观察的已发送任务仍占队列预算，收到其回执才释放容量', async () => {
    const runtime = worker(); const compiler = new VideoEditCodeCompiler(() => runtime)
    const first = compiler.compile('keep'); const closed = expect(first).rejects.toThrow('关闭')
    for (let index = 0; index < 7; index++) {
      const signal = new AbortController(); const pending = compiler.compile('cancel', signal.signal)
      const cancelled = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
      signal.abort(); await cancelled
    }
    await expect(compiler.compile('overflow')).rejects.toThrow('队列')
    expect(runtime.postMessage).toHaveBeenCalledTimes(8)
    runtime.onmessage!({ data: { id: 2, program: { name: '已取消' } as CodeMaterialProgram } } as MessageEvent)
    const next = compiler.compile('after-receipt'); const failure = expect(next).rejects.toThrow('关闭')
    expect(runtime.postMessage).toHaveBeenCalledTimes(9)
    compiler.dispose(); await Promise.all([closed, failure])
  })
})

it('Worker协议传完整文件集合，错误回执保留模块位置', async () => {
  const runtime = worker(); const compiler = new VideoEditCodeCompiler(() => runtime)
  const files = { entry: 'main.ts', files: { 'main.ts': 'import {x} from "./x"', 'x.ts': 'export const x=1' } }
  const pending = compiler.compile(files)
  expect(runtime.postMessage).toHaveBeenCalledWith({ id: 1, files })
  const span = { file: 'x.ts', start: 0, end: 1, startLine: 2, endLine: 2, startColumn: 1, endColumn: 2 }
  const failure = expect(pending).rejects.toMatchObject({ code: 'SYNTAX', sourceSpan: span, message: expect.stringContaining('x.ts:2:1') })
  runtime.onmessage!({ data: { id: 1, error: { code: 'SYNTAX', message: '模块错误', sourceSpan: span } } } as MessageEvent)
  await failure; compiler.dispose()
})

it('共享准备满队列时等待容量；取消等待不改变原有编译预算', async () => {
  const runtime = worker(); const compiler = new VideoEditCodeCompiler(() => runtime)
  const pending = Array.from({ length: 8 }, () => compiler.compile('source'))
  const all = Promise.allSettled(pending)
  const controller = new AbortController()
  const cancelled = compiler.compileQueued('cancel', controller.signal)
  const failed = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' })
  controller.abort(); await failed
  const waiting = compiler.compileQueued('shared')
  expect(runtime.postMessage).toHaveBeenCalledTimes(8)
  await expect(compiler.compile('interactive')).rejects.toThrow('队列')
  runtime.onmessage!({ data: { id: 1, program: { name: 'first' } as CodeMaterialProgram } } as MessageEvent)
  await vi.waitFor(() => expect(runtime.postMessage).toHaveBeenCalledTimes(9))
  runtime.onmessage!({ data: { id: 9, program: { name: 'shared' } as CodeMaterialProgram } } as MessageEvent)
  expect((await waiting).name).toBe('shared')
  compiler.dispose(); await all
})
