import fs from 'node:fs/promises'
import path from 'node:path'
import type { IpcMainInvokeEvent, WebContents } from 'electron'
import { z } from 'zod'
import { VIDEO_EDIT_EXPORT_CHANNELS } from '../../../src/platform/contracts/videoEditExport'
import { registerIpcHandler } from './registry'
import { assertTrustedApplicationSender } from './application-control'
import { removePath, writeFileBytes } from '../services/system'
import { VideoEditExportJobRegistry, watchVideoEditExportSender, type VideoEditExportPage } from '../services/video-edit-export/jobRegistry'

const id = z.string().min(1).max(100)
const pageId = z.string().min(8).max(100)
const absolutePath = z.string().min(1).max(32768).refine(value => path.isAbsolute(value), '输出路径必须是绝对路径。')
const job = z.object({ id, projectId: z.string().min(1).max(200), name: z.string().max(500), presetName: z.string().max(500), outputPaths: z.array(absolutePath).min(1).max(4), restorable: z.boolean(), snapshotIndex: z.number().int().nonnegative().optional(), payload: z.unknown().optional() }).strict()
const schemas = {
  register: z.object({ pageId, snapshots: z.array(z.string()), jobs: z.array(job).min(1) }).strict()
    .refine(value => value.jobs.every(item => item.snapshotIndex === undefined || item.snapshotIndex < value.snapshots.length), '快照下标超出范围。'),
  update: z.object({ pageId, id, state: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled', 'interrupted']), progress: z.number().finite(), error: z.string().max(4000).optional() }).strict(),
  output: z.object({ pageId, id, path: absolutePath }).strict(),
  job: z.object({ pageId, id }).strict(),
  remove: z.object({ pageId, ids: z.array(id) }).strict(),
  restore: z.object({ pageId }).strict(),
}

export const videoEditExportJobRegistry = new VideoEditExportJobRegistry({
  createExclusive: target => writeFileBytes(target, new Uint8Array(), { exclusive: true }),
  async identify(target) {
    try {
      const stats = await fs.lstat(target, { bigint: true })
      return stats.isFile() ? { dev: stats.dev, ino: stats.ino, birthtimeNs: stats.birthtimeNs } : null
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
  },
  remove: target => removePath(target),
})

const watched = new WeakSet<WebContents>()
function page(event: IpcMainInvokeEvent, value: { pageId: string }): VideoEditExportPage {
  const sender = event.sender
  if (!watched.has(sender)) { watched.add(sender); watchVideoEditExportSender(sender, sender.id, videoEditExportJobRegistry) }
  return { senderId: sender.id, pageId: value.pageId }
}

export function registerVideoEditExportIpc(): void {
  const trusted = assertTrustedApplicationSender
  registerIpcHandler(VIDEO_EDIT_EXPORT_CHANNELS.register, value => schemas.register.parse(value), ({ pageId: _pageId, ...request }, event) => videoEditExportJobRegistry.register(page(event, { pageId: _pageId }), request), trusted)
  registerIpcHandler(VIDEO_EDIT_EXPORT_CHANNELS.update, value => schemas.update.parse(value), ({ pageId: _pageId, ...update }, event) => videoEditExportJobRegistry.update(page(event, { pageId: _pageId }), update), trusted)
  registerIpcHandler(VIDEO_EDIT_EXPORT_CHANNELS.createOutput, value => schemas.output.parse(value), (input, event) => videoEditExportJobRegistry.createOutput(page(event, input), input.id, input.path), trusted)
  registerIpcHandler(VIDEO_EDIT_EXPORT_CHANNELS.outputPublished, value => schemas.job.parse(value), (input, event) => videoEditExportJobRegistry.outputPublished(page(event, input), input.id), trusted)
  registerIpcHandler(VIDEO_EDIT_EXPORT_CHANNELS.discardLeftovers, value => schemas.job.parse(value), (input, event) => videoEditExportJobRegistry.discardLeftovers(page(event, input), input.id), trusted)
  registerIpcHandler(VIDEO_EDIT_EXPORT_CHANNELS.remove, value => schemas.remove.parse(value), (input, event) => videoEditExportJobRegistry.remove(page(event, input), input.ids), trusted)
  registerIpcHandler(VIDEO_EDIT_EXPORT_CHANNELS.restore, value => schemas.restore.parse(value), (input, event) => videoEditExportJobRegistry.restore(page(event, input)), trusted)
}
