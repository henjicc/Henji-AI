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
import { loadFfmpegPath } from './ffmpeg-loader'
import { createMainLogger } from '../logging'
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
  frameCount: number
  fps: number
  width: number
  height: number
  fileNameStem: string
  frames: Set<number>
  lastActivity: number
  canceled: boolean
  child: ChildProcessWithoutNullStreams | null
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
): Promise<StartVideoFrameExportResultDto> {
  await cleanupStagedVideoArtifactsOnce()
  const sessionId = crypto.randomUUID()
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'henji-camera-stage-export-'))
  sessions.set(sessionId, {
    id: sessionId,
    dir,
    frameCount: payload.frameCount,
    fps: payload.fps,
    width: payload.width,
    height: payload.height,
    fileNameStem: sanitizeFileStem(payload.fileNameStem),
    frames: new Set<number>(),
    lastActivity: Date.now(),
    canceled: false,
    child: null,
  })
  logger.info('视频帧导出会话已创建', {
    event: 'video_frame_export.session.started',
    requestId: sessionId,
    context: {
      frameCount: payload.frameCount,
      fps: payload.fps,
      width: payload.width,
      height: payload.height,
    },
  })
  return { sessionId }
}

export async function appendVideoFrameExport(
  payload: AppendVideoFrameExportPayloadDto,
): Promise<{ frameIndex: number }> {
  const session = getSession(payload.sessionId)
  if (session.canceled) throw new Error('Video export has been canceled')
  if (payload.frameIndex < 0 || payload.frameIndex >= session.frameCount) {
    throw new Error('Frame index is out of range')
  }

  const framePath = path.join(session.dir, `frame-${String(payload.frameIndex).padStart(6, '0')}.png`)
  await fs.promises.writeFile(framePath, payload.bytes)
  session.frames.add(payload.frameIndex)
  session.lastActivity = Date.now()
  return { frameIndex: payload.frameIndex }
}

export async function finishVideoFrameExport(
  payload: FinishVideoFrameExportPayloadDto,
): Promise<VideoFrameExportResultDto> {
  const session = getSession(payload.sessionId)
  try {
    assertCompleteFrameSet(session)
    const mediaPath = path.join(getUploadsDir(), `${session.fileNameStem}-${session.id}.mp4`)
    const temporaryOutputPath = path.join(session.dir, 'output.mp4')
    session.lastActivity = Date.now()
    logger.info('视频帧导出编码开始', {
      event: 'video_frame_export.encoding.started',
      requestId: session.id,
      context: { frameCount: session.frameCount, fps: session.fps },
    })
    await encodeFrames(session, temporaryOutputPath)
    await moveCompletedOutputToUploads(temporaryOutputPath, mediaPath, session.id)

    const savedPath = payload.targetPath
      ? await copyToTarget(mediaPath, payload.targetPath)
      : mediaPath

    logger.info('视频帧导出完成', {
      event: 'video_frame_export.completed',
      requestId: session.id,
      context: { frameCount: session.frameCount, durationSeconds: session.frameCount / session.fps },
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
    logger.error('视频帧导出失败', {
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
  session.child?.kill('SIGTERM')
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

function assertCompleteFrameSet(session: VideoFrameExportSession): void {
  for (let index = 0; index < session.frameCount; index += 1) {
    if (!session.frames.has(index)) {
      throw new Error(`Missing video export frame ${index}`)
    }
  }
}

async function encodeFrames(session: VideoFrameExportSession, outputPath: string): Promise<void> {
  const ffmpegPath = await loadFfmpegPath()
  const inputPattern = path.join(session.dir, 'frame-%06d.png')
  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegPath, [
      '-y',
      '-framerate', String(session.fps),
      '-start_number', '0',
      '-i', inputPattern,
      '-frames:v', String(session.frameCount),
      '-vf', `scale=${session.width}:${session.height}:flags=lanczos,format=yuv420p`,
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '18',
      '-r', String(session.fps),
      '-movflags', '+faststart',
      outputPath,
    ])
    session.child = child
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', reject)
    child.on('close', (code) => {
      session.child = null
      if (session.canceled) {
        reject(new Error('Video export has been canceled'))
        return
      }
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg video export failed with code ${code}\n${stderr}`))
    })
  })
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
