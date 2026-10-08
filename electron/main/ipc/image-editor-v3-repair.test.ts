import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import type { ContentAddressedResourceStore } from '../services/image-editor-v3/resource-store'
import type { ResourceLease } from '../services/image-editor-v3/contracts'
import { parseImageEditorV3RepairPayload, registerImageEditorV3RepairIpc } from './image-editor-v3-repair'

const handlers = vi.hoisted(() => new Map<string, (input: unknown, event: IpcMainInvokeEvent) => unknown>())
vi.mock('./registry', () => ({ registerIpcHandler: (name: string, parse: (v: unknown) => unknown, handler: (v: never, e: IpcMainInvokeEvent) => unknown) => handlers.set(name, (v, e) => handler(parse(v) as never, e)) }))
vi.mock('../services/local-inference/inpainting/runtime', () => ({ createImageInpaintService: vi.fn() }))
vi.mock('../services/logging', () => ({ createMainLogger: () => ({ warn: vi.fn() }) }))
beforeEach(() => handlers.clear())
const ref = `sha256:${'a'.repeat(64)}`
function event(id: number) {
  const sender = Object.assign(new EventEmitter(), { id, isDestroyed: () => false })
  return { sender } as unknown as IpcMainInvokeEvent
}
function fixture(acquireLease: () => Promise<ResourceLease>) {
  const resources = { acquireLease } as unknown as ContentAddressedResourceStore
  const guard = vi.fn()
  const dispose = registerImageEditorV3RepairIpc({ resources, guard, runRequest: async (_o, _i, _s, run) => run(new AbortController().signal) })
  return { dispose, guard, call: (suffix: string, input: unknown, sender: IpcMainInvokeEvent) => handlers.get(`imageEditorV3:repair:${suffix}`)!(input, sender) }
}
describe('修复原生边界与租约', () => {
  it('闭合长度契约，拒绝路径、空输入和错误来源；640 是工作块限制', () => {
    const input = { requestId: 'run', leaseId: 'lease', width: 1, height: 1, rgba: new ArrayBuffer(4), mask: new ArrayBuffer(1), quality: 'fast' }
    expect(parseImageEditorV3RepairPayload(input).width).toBe(1)
    expect(() => parseImageEditorV3RepairPayload({ ...input, sample: new ArrayBuffer(1) })).toThrow('长度')
    expect(() => parseImageEditorV3RepairPayload({ ...input, sourcePath: 'external' })).toThrow()
    expect(() => parseImageEditorV3RepairPayload({ ...input, quality: 'unknown' })).toThrow()
    expect(() => parseImageEditorV3RepairPayload({ ...input, mask: null })).toThrow()
  })
  it('租约绑定窗口，其他窗口不能释放；导航与关闭释放原窗口资源', async () => {
    const release = vi.fn(async () => undefined), lease = { release } as unknown as ResourceLease
    const f = fixture(async () => lease), a = event(1), b = event(2)
    await f.call('pin', { requestId: 'lease', resourceRefs: [ref] }, a)
    f.call('release', { requestId: 'lease' }, b); expect(release).not.toHaveBeenCalled()
    a.sender.emit('did-start-loading'); expect(release).toHaveBeenCalledTimes(1)
    await f.call('pin', { requestId: 'second', resourceRefs: [ref] }, a)
    a.sender.emit('destroyed'); expect(release).toHaveBeenCalledTimes(2)
    expect(f.guard).toHaveBeenCalledTimes(3); f.dispose()
  })
  it('取消或导航与 acquire 并发时，迟到的租约立即释放且不能恢复已结束事务', async () => {
    let resolve!: (value: ResourceLease) => void
    const release = vi.fn(async () => undefined)
    const f = fixture(() => new Promise<ResourceLease>(done => { resolve = done })), a = event(1)
    const pending = f.call('pin', { requestId: 'lease', resourceRefs: [ref] }, a)
    f.call('release', { requestId: 'lease' }, a)
    resolve({ release } as unknown as ResourceLease)
    await expect(pending).rejects.toThrow('已关闭'); expect(release).toHaveBeenCalledTimes(1); f.dispose()
  })
})
