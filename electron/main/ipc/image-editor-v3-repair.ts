import type { IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import type { ImageEditorV3RepairProgress, ImageEditorV3RepairRequest } from '../../../src/platform/contracts/imageEditorV3'
import type { ContentAddressedResourceStore } from '../services/image-editor-v3/resource-store'
import type { ResourceId, ResourceLease } from '../services/image-editor-v3/contracts'
import { loadSharp } from '../services/image/sharp-loader'
import { createImageInpaintService } from '../services/local-inference/inpainting/runtime'
import { registerIpcHandler } from './registry'
import { createMainLogger } from '../services/logging'

const ref = z.string().regex(/^sha256:[a-f0-9]{64}$/)
const requestId = z.string().min(1).max(256)
const buffer = z.custom<ArrayBuffer>(value => value instanceof ArrayBuffer)
const repairSchema = z.object({ requestId, leaseId: requestId, width: z.number().int().positive().max(640), height: z.number().int().positive().max(640), rgba: buffer, mask: buffer, sample: buffer.optional(), quality: z.enum(['fast', 'fine', 'blemish']) }).strict()
export function parseImageEditorV3RepairPayload(value: unknown): ImageEditorV3RepairRequest {
  const input = repairSchema.parse(value), pixels = input.width * input.height
  if (input.rgba.byteLength !== pixels * 4 || input.mask.byteLength !== pixels || (input.sample && input.sample.byteLength !== pixels * 4)) throw new Error('修复工作块的像素长度不匹配')
  return input
}

export function registerImageEditorV3RepairIpc(deps: {
  resources: ContentAddressedResourceStore
  guard(event: IpcMainInvokeEvent): void
  runRequest<T>(operation: string, requestId: string, senderId: number, work: (signal: AbortSignal) => Promise<T>, estimatedBytes?: number): Promise<T>
}): () => void {
  const pins = new Map<string, { senderId: number; leases: ResourceLease[] }>()
  const progress = new Map<string, ImageEditorV3RepairProgress>()
  const services = new Set<ReturnType<typeof createImageInpaintService>>()
  const key = (senderId: number, id: string): string => `${senderId}:${id}`
  const tracked = new Set<number>()
  const logger = createMainLogger('ipc.image_editor_v3.repair')
  const free = (lease: ResourceLease): void => { void lease.release().catch(error => logger.warn('修复资源租约释放失败', { event: 'image_edit.repair.lease_release.failed', error })) }
  const release = (senderId: number, id: string): void => { const pin = pins.get(key(senderId, id)); pins.delete(key(senderId, id)); pin?.leases.forEach(free) }
  const track = (event: IpcMainInvokeEvent): void => {
    if (tracked.has(event.sender.id)) return
    tracked.add(event.sender.id)
    const cleanup = (): void => {
      for (const [id, entry] of pins) if (entry.senderId === event.sender.id) { pins.delete(id); entry.leases.forEach(free) }
      event.sender.removeListener('destroyed', cleanup); event.sender.removeListener('render-process-gone', cleanup); event.sender.removeListener('did-start-loading', cleanup)
      tracked.delete(event.sender.id)
    }
    event.sender.once('destroyed', cleanup)
    event.sender.once('render-process-gone', cleanup)
    event.sender.once('did-start-loading', cleanup)
  }
  const pin = async (event: IpcMainInvokeEvent, id: string, refs: ResourceId[], create = false): Promise<void> => {
    track(event)
    const sessionKey = key(event.sender.id, id)
    const entry = pins.get(sessionKey) ?? (create ? { senderId: event.sender.id, leases: [] as ResourceLease[] } : undefined)
    if (!entry) throw new Error('修复任务已结束或取消')
    pins.set(sessionKey, entry)
    const lease = await deps.resources.acquireLease(refs)
    if (event.sender.isDestroyed() || pins.get(sessionKey) !== entry) { await lease.release(); throw new Error('图片编辑窗口或修复任务已关闭') }
    entry.leases.push(lease)
  }
  registerIpcHandler('imageEditorV3:repair:pin', value => z.object({ requestId, resourceRefs: z.array(ref) }).strict().parse(value), async (input, event) => {
    deps.guard(event); await pin(event, input.requestId, input.resourceRefs as ResourceId[], true)
  })
  registerIpcHandler('imageEditorV3:repair:release', value => z.object({ requestId }).strict().parse(value), (input, event) => { deps.guard(event); release(event.sender.id, input.requestId) })
  registerIpcHandler('imageEditorV3:repair:progress', value => z.object({ requestId }).strict().parse(value), (input, event) => { deps.guard(event); return progress.get(key(event.sender.id, input.requestId)) ?? null })
  registerIpcHandler('imageEditorV3:repair:run', parseImageEditorV3RepairPayload, async (input, event) => {
    deps.guard(event)
    return deps.runRequest('repair', input.requestId, event.sender.id, async signal => {
      const sharp = await loadSharp()
      const held: ResourceLease[] = []
      const publish = async (bytes: Buffer): Promise<ResourceId> => {
        signal.throwIfAborted()
        const resource = await deps.resources.putBuffer(bytes, { mediaType: 'image/png', signal })
        held.push(await deps.resources.acquireLease([resource.id])); return resource.id
      }
      const service = createImageInpaintService({
        acquire: async resource => { const lease = await deps.resources.acquireLease([resource.id as ResourceId]); return { path: deps.resources.getFilesystemPath(resource.id as ResourceId), release: async () => lease.release() } },
        publishCopy: async file => {
          const result = await deps.resources.putFile(file, { mediaType: 'image/png' })
          // 发布副本保持到 renderer 完成整个修补事务，防止后续块推理期间 GC。
          await pin(event, input.leaseId, [result.id]); return { id: result.id }
        },
        discard: async () => { /* 内容寻址对象可能被其他文档复用；释放租约后由原 GC 回收。 */ },
      })
      services.add(service)
      try {
        // libvips 编码在原生线程池执行；模型/纹理与融合仍由现有 utility 处理。
        const image = await publish(await sharp(Buffer.from(input.rgba), { raw: { width: input.width, height: input.height, channels: 4 } }).png().toBuffer())
        const mask = await publish(await sharp(Buffer.from(input.mask), { raw: { width: input.width, height: input.height, channels: 1 } }).toColourspace('b-w').png().toBuffer())
        const sample = input.sample ? await publish(await sharp(Buffer.from(input.sample), { raw: { width: input.width, height: input.height, channels: 4 } }).png().toBuffer()) : undefined
        signal.throwIfAborted()
        const output = await service.run({ image: { id: image }, mask: { id: mask }, roi: { left: 0, top: 0, width: input.width, height: input.height }, quality: input.quality, ...(sample ? { sample: { id: sample } } : {}) }, { signal, progress: value => progress.set(key(event.sender.id, input.requestId), value) })
        const resource = await deps.resources.describe(output.patch.id as ResourceId)
        signal.throwIfAborted()
        return { patch: { resourceRef: resource.id, byteLength: resource.byteLength, mediaType: resource.mediaType ?? null }, durationMs: output.durationMs }
      } finally { await Promise.all(held.map(lease => lease.release())); service.dispose(); services.delete(service); progress.delete(key(event.sender.id, input.requestId)) }
    }, input.rgba.byteLength * 5)
  })
  return () => { services.forEach(service => service.dispose()); for (const entry of pins.values()) entry.leases.forEach(free); pins.clear(); progress.clear() }
}
