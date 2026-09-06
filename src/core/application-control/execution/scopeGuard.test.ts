import { expect, it } from 'vitest'
import { ApplicationExecutionScopeGuard } from './scopeGuard'

function deferred() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done }); return { promise, resolve } }

it('整组相交 scope 顺序执行，无关 scope 并行且反序获取不死锁', async () => {
  const guard = new ApplicationExecutionScopeGuard(), gate = deferred(), entered = deferred()
  const events: string[] = []
  const first = guard.run(['image_edit', 'canvas'], undefined, async () => { events.push('first'); entered.resolve(); await gate.promise })
  await entered.promise
  const second = guard.run(['canvas', 'image_edit'], undefined, async () => { events.push('second') })
  await guard.run(['assets'], undefined, async () => { events.push('unrelated') })
  expect(events).toEqual(['first', 'unrelated'])
  gate.resolve(); await Promise.all([first, second])
  expect(events).toEqual(['first', 'unrelated', 'second'])
})

it('排队取消移除全部等待引用；异常释放后后继请求仍能进入', async () => {
  const guard = new ApplicationExecutionScopeGuard(), gate = deferred(), entered = deferred()
  const first = guard.run(['canvas'], undefined, async () => { entered.resolve(); await gate.promise; throw new Error('rejected') })
  const firstFailure = expect(first).rejects.toThrow('rejected')
  await entered.promise
  const controller = new AbortController()
  let enteredCancelled = false
  const cancelled = guard.run(['canvas', 'image_edit'], controller.signal, async () => { enteredCancelled = true })
  controller.abort()
  await expect(cancelled).rejects.toThrow('CANCELLED')
  await guard.run(['image_edit'], undefined, async () => {})
  gate.resolve(); await firstFailure
  await guard.run(['canvas'], undefined, async () => {})
  expect(enteredCancelled).toBe(false)
})
