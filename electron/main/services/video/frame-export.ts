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
  canceled: boolean
  child: ChildProcessWithoutNullStreams | null
}

const sessions = new Map<string, VideoFrameExportSession>()

export async function startVideoFrameExport(
  payload: StartVideoFrameExportPayloadDto,
): Promise<StartVideoFrameExportResultDto> {
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
    canceled: false,
    child: null,
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

  const bytes = decodePngDataUrl(payload.dataUrl)
  const framePath = path.join(session.dir, `frame-${String(payload.frameIndex).padStart(6, '0')}.png`)
  await fs.promises.writeFile(framePath, bytes)
  session.frames.add(payload.frameIndex)
  return { frameIndex: payload.frameIndex }
}

export async function finishVideoFrameExport(
  payload: FinishVideoFrameExportPayloadDto,
): Promise<VideoFrameExportResultDto> {
  const session = getSession(payload.sessionId)
  try {
    assertCompleteFrameSet(session)
    const mediaPath = path.join(getUploadsDir(), `${session.fileNameStem}-${session.id}.mp4`)
    await encodeFrames(session, mediaPath)

    const savedPath = payload.targetPath
      ? await copyToTarget(mediaPath, payload.targetPath)
      : mediaPath

    return {
      mediaPath,
      savedPath,
      durationSeconds: session.frameCount / session.fps,
      frameCount: session.frameCount,
      width: session.width,
      height: session.height,
    }
  } finally {
    sessions.delete(session.id)
    await cleanupSessionDir(session.dir)
  }
}

export async function cancelVideoFrameExport(sessionId: string): Promise<void> {
  const session = sessions.get(sessionId)
  if (!session) return
  session.canceled = true
  session.child?.kill('SIGTERM')
  sessions.delete(sessionId)
  await cleanupSessionDir(session.dir)
}

function getSession(sessionId: string): VideoFrameExportSession {
  const session = sessions.get(sessionId)
  if (!session) throw new Error('Video export session was not found')
  return session
}

function decodePngDataUrl(dataUrl: string): Buffer {
  const match = /^data:image\/png;base64,([a-zA-Z0-9+/=]+)$/.exec(dataUrl)
  if (!match) throw new Error('Expected PNG data URL frame')
  return Buffer.from(match[1], 'base64')
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

async function copyToTarget(mediaPath: string, targetPath: string): Promise<string> {
  const normalized = ensureOutputPathWithExtension(targetPath, 'mp4')
  await fs.promises.mkdir(path.dirname(normalized), { recursive: true })
  await fs.promises.copyFile(mediaPath, normalized)
  return normalized
}

async function cleanupSessionDir(dir: string): Promise<void> {
  await fs.promises.rm(dir, { recursive: true, force: true })
}
