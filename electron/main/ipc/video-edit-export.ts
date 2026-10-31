import path from 'node:path'
import type { IpcMainInvokeEvent, WebContents } from 'electron'
import { z } from 'zod'
import { VIDEO_EDIT_EXPORT_CHANNELS } from '../../../src/platform/contracts/videoEditExport'
import { registerIpcHandler } from './registry'
import { assertTrustedApplicationSender } from './application-control'
import { type VideoEditExportPage } from '../services/video-edit-export/jobRegistry'
import { videoEditExportEncodingSchema } from '../../../src/core/videoEdit/exportEncoding'
import { videoEditExportCapabilities } from '../services/video-edit-export/capabilities'
import { videoEditExportCompression } from '../services/video-edit-export/compression'
import { createMainLogger } from '../services/logging'

import { videoEditExportJobRegistry } from '../services/video-edit-export/registry'

const id = z.string().min(1).max(100)
const logger = createMainLogger('main.video_edit_export')
const pageId = z.string().min(8).max(100)
const absolutePath = z.string().min(1).max(32768).refine(value => path.isAbsolute(value), '输出路径必须是绝对路径。')
const job = z.object({ invocationId: z.string().optional(), id, projectId: z.string().min(1).max(200), name: z.string().max(500), presetName: z.string().max(500), outputPaths: z.array(absolutePath).min(1), restorable: z.boolean(), snapshotIndex: z.number().int().nonnegative().optional(), payload: z.unknown().optional() }).strict()
const schemas = {
  prepareCompression: z.object({ pageId, jobId: id, path: absolutePath, estimatedBytes: z.number().finite().nonnegative().default(0) }).strict(),
  compress: z.object({ pageId, id, encoding: videoEditExportEncodingSchema, videoBitrateMbps: z.number().positive().default(50), fps: z.number().positive().max(120), durationSeconds: z.number().positive() }).strict(),
  register: z.object({ pageId, snapshots: z.array(z.string()), jobs: z.array(job).min(1) }).strict()
    .refine(value => value.jobs.every(item => item.snapshotIndex === undefined || item.snapshotIndex < value.snapshots.length), '快照下标超出范围。'),
  update: z.object({ invocationId: z.string().optional(), pageId, id, state: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled', 'interrupted']), progress: z.number().finite(), error: z.string().max(4000).optional() }).strict(),
  output: z.object({ pageId, id, path: absolutePath }).strict(),
  job: z.object({ pageId, id }).strict(),
  remove: z.object({ pageId, ids: z.array(id) }).strict(),
  restore: z.object({ pageId }).strict(),
}


const watched = new WeakSet<WebContents>()
const leaving = new WeakMap<WebContents, Promise<void>>()
const generations = new WeakMap<WebContents, number>()
const pageKey = (value: VideoEditExportPage): string => `${value.senderId}:${value.pageId}`
async function page(event: IpcMainInvokeEvent, value: { pageId: string }): Promise<VideoEditExportPage> {
  const sender = event.sender
  if (!watched.has(sender)) {
    watched.add(sender)
    const leave = (reason: string): void => {
      generations.set(sender, (generations.get(sender) ?? 0) + 1)
      // release 在事件发生时捕获现有会话；不能等异步清理队列再匹配新页面。
      const compressionCleanup = videoEditExportCompression.release(owner => owner.startsWith(`${sender.id}:`))
      const cleanup = Promise.all([leaving.get(sender), compressionCleanup])
        .catch(error => logger.error('页面退出后清理压制任务失败', { event: 'video_edit_export.cleanup.failed', error }))
        .then(() => videoEditExportJobRegistry.leave(sender.id, reason))
        .catch(error => logger.error('页面退出后清理导出登记失败', { event: 'video_edit_export.cleanup.failed', error }))
      leaving.set(sender, cleanup)
    }
    sender.on('render-process-gone', () => leave('render_process_gone'))
    sender.once('destroyed', () => leave('destroyed'))
  }
  await leaving.get(sender)
  return { senderId: sender.id, pageId: value.pageId }
}

export function registerVideoEditExportIpc(): void {
  const trusted = assertTrustedApplicationSender
  registerIpcHandler(VIDEO_EDIT_EXPORT_CHANNELS.capabilities, () => undefined, () => videoEditExportCapabilities(), trusted)
  registerIpcHandler(VIDEO_EDIT_EXPORT_CHANNELS.prepareCompression, value => schemas.prepareCompression.parse(value), async (input, event) => {
    const owner = await page(event, input)
    const generation = generations.get(event.sender)
    if (!videoEditExportJobRegistry.ownsOutput(owner, input.jobId, input.path)) throw new Error('输出文件尚未登记或原导出页面已离开。')
    const result = await videoEditExportCompression.prepare(pageKey(owner), input.jobId, input.path, input.estimatedBytes)
    if (generation !== generations.get(event.sender) || event.sender.isDestroyed() || !videoEditExportJobRegistry.ownsOutput(owner, input.jobId, input.path)) { await videoEditExportCompression.cancel(pageKey(owner), result.id); throw new Error('导出页面已关闭。') }
    return result
  }, trusted)
  registerIpcHandler(VIDEO_EDIT_EXPORT_CHANNELS.compress, value => schemas.compress.parse(value), async (input, event) => {
    const owner = await page(event, input)
    return videoEditExportCompression.finish(pageKey(owner), input.id, input.encoding, input.fps, input.durationSeconds, (jobId, target, staging) => videoEditExportJobRegistry.replaceOutput(owner, jobId, target, staging), input.videoBitrateMbps)
  }, trusted)
  registerIpcHandler(VIDEO_EDIT_EXPORT_CHANNELS.compressionProgress, value => schemas.job.parse(value), async (input, event) => videoEditExportCompression.progress(pageKey(await page(event, input)), input.id), trusted)
  registerIpcHandler(VIDEO_EDIT_EXPORT_CHANNELS.cancelCompression, value => schemas.job.parse(value), async (input, event) => videoEditExportCompression.cancel(pageKey(await page(event, input)), input.id), trusted)
  registerIpcHandler(VIDEO_EDIT_EXPORT_CHANNELS.register, value => schemas.register.parse(value), async ({ pageId: _pageId, ...request }, event) => videoEditExportJobRegistry.register(await page(event, { pageId: _pageId }), request), trusted)
  registerIpcHandler(VIDEO_EDIT_EXPORT_CHANNELS.update, value => schemas.update.parse(value), async ({ pageId: _pageId, ...update }, event) => videoEditExportJobRegistry.update(await page(event, { pageId: _pageId }), update), trusted)
  registerIpcHandler(VIDEO_EDIT_EXPORT_CHANNELS.createOutput, value => schemas.output.parse(value), async (input, event) => videoEditExportJobRegistry.createOutput(await page(event, input), input.id, input.path), trusted)
  registerIpcHandler(VIDEO_EDIT_EXPORT_CHANNELS.outputPublished, value => schemas.job.parse(value), async (input, event) => videoEditExportJobRegistry.outputPublished(await page(event, input), input.id), trusted)
  registerIpcHandler(VIDEO_EDIT_EXPORT_CHANNELS.discardLeftovers, value => schemas.job.parse(value), async (input, event) => videoEditExportJobRegistry.discardLeftovers(await page(event, input), input.id), trusted)
  registerIpcHandler(VIDEO_EDIT_EXPORT_CHANNELS.remove, value => schemas.remove.parse(value), async (input, event) => videoEditExportJobRegistry.remove(await page(event, input), input.ids), trusted)
  registerIpcHandler(VIDEO_EDIT_EXPORT_CHANNELS.restore, value => schemas.restore.parse(value), async (input, event) => {
    const owner = await page(event, input)
    await videoEditExportCompression.release(key => key.startsWith(`${owner.senderId}:`) && key !== pageKey(owner))
    return videoEditExportJobRegistry.restore(owner)
  }, trusted)
}
