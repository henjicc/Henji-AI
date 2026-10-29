import { afterEach, expect, it, vi } from 'vitest'
import type { CodeAuthorBundle } from '@/core/videoEdit/codeAuthorProgram'
import { VideoEditCodeCompiler, type CodeCompilerWorker } from './videoEditCodeCompiler'
const sourceFiles = (code: string) => ({ entry: 'main.ts', files: { 'main.ts': code } })
const output = (code: string): CodeAuthorBundle => ({ code, map: '', locations: { layers: {} } })
function worker(): CodeCompilerWorker { return { onmessage: null, onerror: null, onmessageerror: null, postMessage: vi.fn(), terminate: vi.fn() } }
afterEach(() => { vi.useRealTimers() })

it('六个并发检查依次派发，排队超过单次时限仍成功，每次检查有完整时限', async () => {
  vi.useFakeTimers()
  const runtime = worker(); const compiler = new VideoEditCodeCompiler(() => runtime, 10)
  const results = Array.from({ length: 6 }, (_, index) => compiler.bundle(sourceFiles(String(index))))
  const finished = Promise.all(results)
  for (let index = 0; index < 6; index++) {
    expect(runtime.postMessage).toHaveBeenCalledTimes(index + 1)
    await vi.advanceTimersByTimeAsync(9)
    runtime.onmessage!({ data: { id: index + 1, bundle: output(String(index)) } } as MessageEvent)
  }
  expect((await finished).map(bundle => bundle.code)).toEqual(['0', '1', '2', '3', '4', '5'])
  expect(runtime.terminate).not.toHaveBeenCalled(); compiler.dispose(); expect(vi.getTimerCount()).toBe(0)
})

it('取消排队项不发给线程，取消执行中的观察仍等回执缓存，不影响其他观察', async () => {
  const runtime = worker(); const compiler = new VideoEditCodeCompiler(() => runtime)
  const activeController = new AbortController(), queuedController = new AbortController()
  const active = compiler.bundle(sourceFiles('active'), activeController.signal)
  const activeFailure = expect(active).rejects.toMatchObject({ name: 'AbortError' })
  const queued = compiler.bundle(sourceFiles('queued'), queuedController.signal)
  const queuedFailure = expect(queued).rejects.toMatchObject({ name: 'AbortError' })
  const remaining = compiler.bundle(sourceFiles('remaining'))
  activeController.abort(); queuedController.abort(); await Promise.all([activeFailure, queuedFailure])
  expect(runtime.terminate).not.toHaveBeenCalled(); expect(runtime.postMessage).toHaveBeenCalledTimes(1)
  runtime.onmessage!({ data: { id: 1, bundle: output('active') } } as MessageEvent)
  expect(runtime.postMessage).toHaveBeenLastCalledWith({ id: 3, files: sourceFiles('remaining'), kind: 'author.bundle' })
  runtime.onmessage!({ data: { id: 3, bundle: output('remaining'), cacheHit: true } } as MessageEvent)
  expect((await remaining).code).toBe('remaining'); expect(compiler.diagnostics().cacheHits).toBe(1); compiler.dispose()
})

it('真正超时释放线程并给出可重试的错误类型，重试重建线程且忽略迟到回执', async () => {
  vi.useFakeTimers()
  const first = worker(), retryWorker = worker(), create = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(retryWorker)
  const compiler = new VideoEditCodeCompiler(create, 10)
  const pending = compiler.bundle(sourceFiles('first')); const failure = expect(pending).rejects.toMatchObject({ name: 'VideoEditCodeCompileTimeoutError' })
  await vi.advanceTimersByTimeAsync(10); await failure; expect(first.terminate).toHaveBeenCalledOnce()
  const retry = compiler.bundle(sourceFiles('retry'))
  first.onmessage!({ data: { id: 2, bundle: output('迟到') } } as MessageEvent)
  retryWorker.onmessage!({ data: { id: 2, bundle: output('重试') } } as MessageEvent)
  expect((await retry).code).toBe('重试'); compiler.dispose()
})

it('关闭会话清理执行中和所有排队检查及计时器', async () => {
  vi.useFakeTimers()
  const runtime = worker(), compiler = new VideoEditCodeCompiler(() => runtime)
  const results = Array.from({ length: 12 }, () => compiler.bundle(sourceFiles('source')))
  const failures = results.map(result => expect(result).rejects.toThrow('关闭'))
  expect(runtime.postMessage).toHaveBeenCalledOnce(); compiler.dispose(); await Promise.all(failures)
  expect(vi.getTimerCount()).toBe(0)
})

it('Worker错误回执保留模块位置，随后继续检查排队源码', async () => {
  const runtime = worker(), compiler = new VideoEditCodeCompiler(() => runtime)
  const files = { entry: 'main.ts', files: { 'main.ts': 'import {x} from "./x"', 'x.ts': 'export const x=1' } }
  const pending = compiler.bundle(files)
  const next = compiler.bundle(sourceFiles('next'))
  const span = { file: 'x.ts', start: 0, end: 1, startLine: 2, endLine: 2, startColumn: 1, endColumn: 2 }
  const failure = expect(pending).rejects.toMatchObject({ code: 'SYNTAX', sourceSpan: span, message: expect.stringContaining('x.ts:2:1') })
  runtime.onmessage!({ data: { id: 1, error: { code: 'SYNTAX', message: '模块错误', sourceSpan: span } } } as MessageEvent)
  await failure
  runtime.onmessage!({ data: { id: 2, bundle: output('next') } } as MessageEvent)
  expect((await next).code).toBe('next'); compiler.dispose()
})
