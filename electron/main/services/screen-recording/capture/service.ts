import type { WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { release } from 'node:os'
import path from 'node:path'
import type { CaptureBackendKind, CaptureCommand, CaptureManifest, CaptureOperation, CapturePrepared, CaptureRequest, ScreenCaptureBackend } from '../../../../../src/core/screenRecording/capture'
import { getUserFolderDir } from '../../appPaths'
import { mediaPermissions } from '../../media-permissions'
import { createMainLogger } from '../../logging'
import { openRecordingControl, closeRecordingControl, recordingControl } from '../runtime'
import { CaptureStorage, recoverCapture } from './storage'
import { GfxCaptureBackend } from './gfxcapture'
import { resolveNativeCaptureSource } from './source'

const logger = createMainLogger('main.screen_recording.capture')
interface Active {
  owner: WebContents; storage: CaptureStorage; backend: ScreenCaptureBackend; originUs: number
  rpc: Map<string, { resolve(): void; reject(error: Error): void }>
}
let active: Active | null = null
let preparing = false
const now = (): number => Number(process.hrtime.bigint() / 1000n)

async function remote(session: Active, operation: CaptureOperation): Promise<void> {
  if (session.owner.isDestroyed()) throw new Error('录制窗口已经关闭')
  const requestId = randomUUID()
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { session.rpc.delete(requestId); reject(new Error('采集窗口未响应，已写片段可以恢复')) }, operation === 'cancel' ? 2000 : 20000)
    session.rpc.set(requestId, { resolve: () => { clearTimeout(timer); resolve() }, reject: error => { clearTimeout(timer); reject(error) } })
    const command: CaptureCommand = { sessionId: session.storage.manifest.sessionId, requestId, operation }
    session.owner.send('screenRecording:captureCommand', command)
  })
}
async function fail(session: Active, error: Error): Promise<void> {
  if (active !== session || session.storage.manifest.status === 'failed') return
  session.storage.manifest.status = 'failed'
  logger.error('屏幕录制失败', { event: 'recording.capture.failed', error })
  recordingControl.fail(session.storage.manifest.sessionId, error.message.includes('磁盘空间不足') ? '磁盘空间不足，已停止录制。请释放空间后重试，已保存的片段可以恢复。' : '录制已中断，已保存的片段可以恢复。请停止后重新准备录制。')
  try { await session.backend.cancel() } finally { await session.storage.release(); await session.storage.save() }
}

export async function handleCaptureRequest(owner: WebContents, request: CaptureRequest): Promise<unknown> {
  if (request.operation === 'recover') {
    if (active?.storage.manifest.sessionId === request.sessionId) throw new Error('请先关闭采集会话，再恢复片段')
    return recoverCapture(path.join(getUserFolderDir('uploads'), 'screen-recordings', request.sessionId))
  }
  if (request.operation === 'prepare') {
    if (active || preparing) throw new Error('请先关闭当前录制会话')
    preparing = true
    try {
      mediaPermissions.assertSelection(owner, request.sessionId, request.options.sourceId)
      const source = (await mediaPermissions.sources()).find(item => item.id === request.options.sourceId)
      if (!source) throw new Error('录制来源已关闭，请重新选择')
      const wgc = process.platform === 'win32' && Number(release().split('.')[2]) >= 18362
      let backend: CaptureBackendKind = request.options.backend === 'chromium' || !wgc ? 'chromium' : 'gfxcapture'
      let nativeSource
      if (backend === 'gfxcapture') {
        try { nativeSource = await resolveNativeCaptureSource(source) } catch (error) {
          if (request.options.backend === 'gfxcapture') throw error
          backend = 'chromium'
          logger.warn('显示器原生定位失败，使用兼容采集', { event: 'recording.capture.source.fallback', error })
        }
      }
      if (request.options.backend === 'gfxcapture' && !wgc) throw new Error('当前系统不支持无光标采集，请使用兼容录制')
      const manifest: CaptureManifest = { version: 1, sessionId: request.sessionId, options: request.options, backend, cursorEmbedded: backend === 'chromium', status: 'prepared', spans: [] }
      const storage = new CaptureStorage(path.join(getUserFolderDir('uploads'), 'screen-recordings', request.sessionId), manifest)
      await storage.prepare()
      const session: Active = { owner, storage, originUs: now(), rpc: new Map(), backend: null! }
      session.backend = backend === 'gfxcapture' ? new GfxCaptureBackend(request.options, nativeSource!, storage, { nowUs: () => now() - session.originUs, failed: error => { void fail(session, error).catch(failure => logger.error('录制失败清理未完成', { event: 'recording.capture.cleanup.failed', error: failure })) } }) : {
        prepare: async () => undefined,
        start: () => remote(session, 'start'), pause: () => remote(session, 'pause'), resume: () => remote(session, 'resume'), stop: () => remote(session, 'stop'),
        cancel: async () => { for (const pending of session.rpc.values()) pending.reject(new Error('录制已取消')); session.rpc.clear(); if (!owner.isDestroyed()) await remote(session, 'cancel') },
      }
      active = session
      try {
        await session.backend.prepare()
        mediaPermissions.assertSelection(owner, request.sessionId, request.options.sourceId)
        const transition = async (operation: Exclude<CaptureOperation, 'cancel'>, status: CaptureManifest['status'], signal: AbortSignal): Promise<void> => {
          try {
            if (operation === 'start' || operation === 'resume') mediaPermissions.assertSelection(owner, request.sessionId, request.options.sourceId)
            await session.backend[operation](signal)
            if (manifest.status !== 'failed') { manifest.status = status; await storage.save() }
          } catch (error) { await fail(session, error instanceof Error ? error : new Error(String(error))); throw error }
        }
        openRecordingControl(owner, request.sessionId, {
          start: signal => transition('start', 'recording', signal), pause: signal => transition('pause', 'paused', signal), resume: signal => transition('resume', 'recording', signal), stop: signal => transition('stop', 'stopped', signal),
          mark: async () => undefined, // Event/marker ownership is task 1.4; no duplicate event log here.
          cancel: async () => { try { await session.backend.cancel() } finally { await storage.release(); if (manifest.status !== 'stopped') manifest.status = 'failed'; await storage.save(); if (active === session) active = null } },
        })
      } catch (error) {
        try { if (backend === 'gfxcapture') await session.backend.cancel() } finally { await storage.release(); active = null }
        throw error
      }
      logger.info('屏幕采集准备完成', { event: 'recording.capture.prepare.completed', context: { backend, sessionId: request.sessionId } })
      return { sessionId: request.sessionId, backend, cursorEmbedded: manifest.cursorEmbedded, options: request.options } satisfies CapturePrepared
    } finally { preparing = false }
  }
  const session = active
  if (!session || session.owner !== owner || session.storage.manifest.sessionId !== request.sessionId) throw new Error('录制会话不存在或不属于当前窗口')
  const { storage } = session
  switch (request.operation) {
    case 'read': return structuredClone(storage.manifest)
    case 'clock': return now() - session.originUs
    case 'close': await closeRecordingControl(); return
    case 'ack': {
      const pending = session.rpc.get(request.requestId); session.rpc.delete(request.requestId)
      if (request.error) pending?.reject(new Error(request.error)); else pending?.resolve()
      return
    }
    case 'failed': await fail(session, new Error(request.error)); return
    default: {
      if (storage.manifest.backend !== 'chromium' || storage.manifest.status === 'failed' || storage.manifest.status === 'stopped') throw new Error('当前会话不接受采集帧')
      if (request.operation === 'open-span') return storage.openSpan(now() - session.originUs)
      if (request.operation === 'anchor') {
        const span = storage.manifest.spans[request.index]
        if (!span || span.finalized) throw new Error('录制片段已关闭')
        span.monoUs = request.monoUs; return storage.save()
      }
      if (request.operation === 'write') return storage.write(request.index, request.position, request.data)
      if (request.operation === 'seal-span') return storage.seal(request.index, request.durationUs)
    }
  }
}

export async function revokeCaptureSession(owner: WebContents, sessionId: string): Promise<void> {
  if (active?.owner === owner && active.storage.manifest.sessionId === sessionId) await recordingControl.command('stop')
}
