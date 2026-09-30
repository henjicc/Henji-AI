import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CodeMaterialProgram } from '@/core/videoEdit/codeMaterial/contract'
import { VideoEditCodeCompiler } from './videoEditCodeCompiler'
import type { CodeCompilerWorker } from './videoEditCodeCompiler'
function worker(): CodeCompilerWorker {
  return { onmessage: null, onerror: null, onmessageerror: null, postMessage: vi.fn(), terminate: vi.fn() }
}
afterEach(() => { vi.useRealTimers() })
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
