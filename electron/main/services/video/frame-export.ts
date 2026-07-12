import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  ensureOutputPathWithExtension,
  getUploadsDir,
  sanitizeFileStem,
} from '../image/path-utils'
import { createMainLogger } from '../logging'
import { getPreferredEncoder } from './hwaccel'
import { loadFfmpegPath } from './ffmpeg-loader'
import type {
  AppendVideoFrameExportPayloadDto,
  FinishVideoFrameExportPayloadDto,
  StartVideoFrameExportPayloadDto,
  StartVideoFrameExportResultDto,
  VideoFrameExportResultDto,
} from './types'

interface VideoFrameExportSession {
  id: string
  dir: string
  outputPath: string
  frameCount: number
  fps: number
  width: number
  height: number
  fileNameStem: string
  receivedFrames: number
  lastActivity: number
  canceled: boolean
  child: ChildProcessWithoutNullStreams
  completion: Promise<void>
  onEncodingProgress: ((sessionId: string, encodedFrames: number) => void) | null
  encoderLabel: string
}

const sessions = new Map<string, VideoFrameExportSession>()
const logger = createMainLogger('main.video_frame_export')
const SESSION_IDLE_LIMIT_MS = 30 * 60 * 1000
const SESSION_SWEEP_INTERVAL_MS = 5 * 60 * 1000
const STAGED_OUTPUT_PREFIX = '.henji-camera-stage-export-'
const STAGED_OUTPUT_SUFFIX = '.part'
let stagedArtifactsCleanupPromise: Promise<void> | null = null

const sessionSweepTimer = setInterval(() => {
  void cleanupExpiredVideoFrameExports().catch((error) => {
    logger.error('回收超时的视频帧导出会话失败', {
      event: 'video_frame_export.sessions.expire_failed',
      error,
    })
  })
}, SESSION_SWEEP_INTERVAL_MS)
sessionSweepTimer.unref()

export async function startVideoFrameExport(
  payload: StartVideoFrameExportPayloadDto,
  onEncodingProgress?: (sessionId: string, encodedFrames: number) => void,
): Promise<StartVideoFrameExportResultDto> {
  await cleanupStagedVideoArtifactsOnce()
  const sessionId = crypto.randomUUID()
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'henji-camera-stage-export-'))
  const outputPath = path.join(dir, 'output.mp4')
  const ffmpegPath = await loadFfmpegPath()
  const encoder = await getPreferredEncoder()
  const bitrateKbps = estimateVideoBitrateKbps(payload.width, payload.height, payload.fps)
  const maxrateKbps = Math.round(bitrateKbps * 1.35)
  const bufsizeKbps = Math.round(bitrateKbps * 2)
  const encodeArgs = encoder.id === 'cpu'
    ? ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20']
    : encoder.buildEncodeArgs(bitrateKbps, maxrateKbps, bufsizeKbps)
  const child = spawn(ffmpegPath, [
    '-y',
    '-hide_banner',
    '-loglevel', 'info',
    '-f', 'rawvideo',
    '-pixel_format', 'rgba',
    '-video_size', `${payload.width}x${payload.height}`,
    '-framerate', String(payload.fps),
    '-color_range', 'pc',
    '-colorspace', 'bt709',
    '-color_primaries', 'bt709',
    '-color_trc', 'iec61966-2-1',
    '-i', 'pipe:0',
    '-frames:v', String(payload.frameCount),
    '-vf', 'vflip,scale=in_range=full:out_range=limited:out_color_matrix=bt709,format=yuv420p',
    ...encodeArgs,
    '-r', String(payload.fps),
    '-color_range', 'tv',
    '-colorspace', 'bt709',
    '-color_primaries', 'bt709',
    // WebGL 离屏帧已经按 sRGB 传递函数编码；这里只做 RGB -> YUV 与全范围 -> 有限范围转换，
    // 没有执行 sRGB -> BT.709 的传递函数变换，因此输出必须继续声明为 sRGB。
    // 若误标成 BT.709，播放器会用错误的曲线解码中间调，导致画布节点中的成片整体偏亮。
    '-color_trc', 'iec61966-2-1',
    '-movflags', '+faststart',
    outputPath,
  ])
  let stderr = ''
  let progressBuffer = ''
  let lastEncodedFrames = 0
  const completion = new Promise<void>((resolve, reject) => {
    child.stderr.on('data', (chunk: Buffer) => {
      const output = chunk.toString()
      stderr += output
      progressBuffer += output
      const matches = progressBuffer.matchAll(/frame=\s*(\d+)/g)
      for (const match of matches) {
        const encodedFrames = Number(match[1])
        if (encodedFrames <= lastEncodedFrames) continue
        lastEncodedFrames = encodedFrames
        const session = sessions.get(sessionId)
        if (session) emitEncodingProgress(session, Math.min(encodedFrames, payload.frameCount))
      }
      progressBuffer = progressBuffer.slice(-64)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      const session = sessions.get(sessionId)
      if (session?.canceled) {
        reject(new Error('Video export has been canceled'))
        return
      }
      if (code === 0) {
        if (session) emitEncodingProgress(session, payload.frameCount)
        resolve()
        return
      }
      reject(new Error(`ffmpeg raw video export failed with code ${code}\n${stderr}`))
    })
  })
  void completion.catch(() => undefined)

  sessions.set(sessionId, {
    id: sessionId,
    dir,
    outputPath,
    frameCount: payload.frameCount,
    fps: payload.fps,
    width: payload.width,
    height: payload.height,
    fileNameStem: sanitizeFileStem(payload.fileNameStem),
    receivedFrames: 0,
    lastActivity: Date.now(),
    canceled: false,
    child,
    completion,
    onEncodingProgress: onEncodingProgress ?? null,
    encoderLabel: encoder.label,
  })
  logger.info('流式视频导出会话已创建', {
    event: 'video_frame_export.session.started',
    requestId: sessionId,
    context: {
      frameCount: payload.frameCount,
      fps: payload.fps,
      width: payload.width,
      height: payload.height,
      encoder: encoder.label,
      inputFormat: 'raw-rgba-pipe',
    },
  })
  return { sessionId }
}

export async function appendVideoFrameExport(
  payload: AppendVideoFrameExportPayloadDto,
): Promise<{ frameIndex: number }> {
  const session = getSession(payload.sessionId)
  if (session.canceled) throw new Error('Video export has been canceled')
  if (payload.frameIndex !== session.receivedFrames) {
    throw new Error(`Expected sequential video frame ${session.receivedFrames}, received ${payload.frameIndex}`)
  }
  const expectedBytes = session.width * session.height * 4
  if (payload.bytes.byteLength !== expectedBytes) {
    throw new Error(`Raw video frame byte length mismatch: expected ${expectedBytes}, received ${payload.bytes.byteLength}`)
  }
  if (session.child.exitCode !== null || session.child.stdin.destroyed) {
    await session.completion
    throw new Error('Video encoder stdin is unavailable')
  }

  const frame = Buffer.from(payload.bytes.buffer, payload.bytes.byteOffset, payload.bytes.byteLength)
  if (!session.child.stdin.write(frame)) await waitForDrain(session.child)
  session.receivedFrames += 1
  session.lastActivity = Date.now()
  return { frameIndex: payload.frameIndex }
}

export async function finishVideoFrameExport(
  payload: FinishVideoFrameExportPayloadDto,
): Promise<VideoFrameExportResultDto> {
  const session = getSession(payload.sessionId)
  try {
    if (session.receivedFrames !== session.frameCount) {
      throw new Error(`Missing video frames: expected ${session.frameCount}, received ${session.receivedFrames}`)
    }
    session.lastActivity = Date.now()
    session.child.stdin.end()
    await session.completion
    const mediaPath = path.join(getUploadsDir(), `${session.fileNameStem}-${session.id}.mp4`)
    await moveCompletedOutputToUploads(session.outputPath, mediaPath, session.id)
    const savedPath = payload.targetPath
      ? await copyToTarget(mediaPath, payload.targetPath)
      : mediaPath

    logger.info('流式视频导出完成', {
      event: 'video_frame_export.completed',
      requestId: session.id,
      context: {
        frameCount: session.frameCount,
        durationSeconds: session.frameCount / session.fps,
        encoder: session.encoderLabel,
      },
    })
    return {
      mediaPath,
      savedPath,
      durationSeconds: session.frameCount / session.fps,
      frameCount: session.frameCount,
      width: session.width,
      height: session.height,
    }
  } catch (error) {
    logger.error('流式视频导出失败', {
      event: 'video_frame_export.failed',
      requestId: session.id,
      error,
    })
    throw error
  } finally {
    sessions.delete(session.id)
    await cleanupSessionDir(session.dir)
  }
}

export async function cancelVideoFrameExport(sessionId: string, reason = 'requested'): Promise<void> {
  const session = sessions.get(sessionId)
  if (!session) return
  session.canceled = true
  session.child.stdin.destroy()
  session.child.kill('SIGTERM')
  sessions.delete(sessionId)
  await cleanupSessionDir(session.dir)
  logger.info('视频帧导出会话已清理', {
    event: 'video_frame_export.session.cleaned',
    requestId: sessionId,
    context: { reason },
  })
}

export async function cleanupAllVideoFrameExports(reason: string): Promise<void> {
  const sessionIds = [...sessions.keys()]
  if (sessionIds.length === 0) return
  const results = await Promise.allSettled(
    sessionIds.map((sessionId) => cancelVideoFrameExport(sessionId, reason)),
  )
  const failureCount = results.filter((result) => result.status === 'rejected').length
  if (failureCount > 0) {
    logger.error('部分视频帧导出会话清理失败', {
      event: 'video_frame_export.sessions.cleanup_failed',
      context: { reason, sessionCount: sessionIds.length, failureCount },
    })
    return
  }
  logger.warn('视频帧导出会话已批量清理', {
    event: 'video_frame_export.sessions.cleaned',
    context: { reason, sessionCount: sessionIds.length },
  })
}

function getSession(sessionId: string): VideoFrameExportSession {
  const session = sessions.get(sessionId)
  if (!session) throw new Error('Video export session was not found')
  return session
}

function waitForDrain(child: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      child.stdin.off('drain', onDrain)
      child.stdin.off('error', onError)
      child.off('close', onClose)
    }
    const onDrain = (): void => {
      cleanup()
      resolve()
    }
    const onError = (error: Error): void => {
      cleanup()
      reject(error)
    }
    const onClose = (): void => {
      cleanup()
      reject(new Error('Video encoder closed before accepting the next frame'))
    }
    child.stdin.once('drain', onDrain)
    child.stdin.once('error', onError)
    child.once('close', onClose)
  })
}

function estimateVideoBitrateKbps(width: number, height: number, fps: number): number {
  return Math.max(4_000, Math.round((width * height * fps * 0.18) / 1_000))
}

function emitEncodingProgress(session: VideoFrameExportSession, encodedFrames: number): void {
  if (session.canceled || !session.onEncodingProgress) return
  session.lastActivity = Date.now()
  session.onEncodingProgress(session.id, encodedFrames)
}

async function cleanupExpiredVideoFrameExports(): Promise<void> {
  const now = Date.now()
  const expiredSessionIds = [...sessions.values()]
    .filter((session) => now - session.lastActivity >= SESSION_IDLE_LIMIT_MS)
    .map((session) => session.id)
  await Promise.all(expiredSessionIds.map((sessionId) => cancelVideoFrameExport(sessionId, 'idle_timeout')))
  if (expiredSessionIds.length > 0) {
    logger.warn('已回收超时的视频帧导出会话', {
      event: 'video_frame_export.sessions.expired',
      context: { sessionCount: expiredSessionIds.length },
    })
  }
}

async function moveCompletedOutputToUploads(
  sourcePath: string,
  targetPath: string,
  sessionId: string,
): Promise<void> {
  try {
    await fs.promises.rename(sourcePath, targetPath)
    return
  } catch (error) {
    if (!isCrossDeviceError(error)) throw error
  }
  const stagedPath = path.join(
    path.dirname(targetPath),
    `${STAGED_OUTPUT_PREFIX}${sessionId}${STAGED_OUTPUT_SUFFIX}`,
  )
  try {
    await fs.promises.copyFile(sourcePath, stagedPath)
    await fs.promises.rename(stagedPath, targetPath)
    await fs.promises.unlink(sourcePath)
  } catch (error) {
    await fs.promises.rm(stagedPath, { force: true })
    throw error
  }
}

function isCrossDeviceError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EXDEV'
}

async function cleanupStagedVideoArtifacts(): Promise<void> {
  const uploadsDir = getUploadsDir()
  const entries = await fs.promises.readdir(uploadsDir, { withFileTypes: true })
  const stalePaths = entries
    .filter((entry) => entry.isFile()
      && entry.name.startsWith(STAGED_OUTPUT_PREFIX)
      && entry.name.endsWith(STAGED_OUTPUT_SUFFIX))
    .map((entry) => path.join(uploadsDir, entry.name))
  if (stalePaths.length === 0) return
  await Promise.all(stalePaths.map((stalePath) => fs.promises.rm(stalePath, { force: true })))
  logger.warn('已清理上次异常遗留的视频暂存产物', {
    event: 'video_frame_export.staged_artifacts.cleaned',
    context: { fileCount: stalePaths.length },
  })
}

function cleanupStagedVideoArtifactsOnce(): Promise<void> {
  stagedArtifactsCleanupPromise ??= cleanupStagedVideoArtifacts()
  return stagedArtifactsCleanupPromise
}

async function copyToTarget(mediaPath: string, targetPath: string): Promise<string> {
  const normalized = ensureOutputPathWithExtension(targetPath, 'mp4')
  await fs.promises.mkdir(path.dirname(normalized), { recursive: true })
  await fs.promises.copyFile(mediaPath, normalized)
  return normalized
}

async function cleanupSessionDir(dir: string): Promise<void> {
  await fs.promises.rm(dir, { recursive: true, force: true })
}
