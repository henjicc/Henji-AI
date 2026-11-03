import { expect, it } from 'vitest'
import type { GpuDevice } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import { guardVideoEditGpu } from './videoEditGpuErrorScope'

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
