import { ZipArchive } from 'archiver'
import { app, dialog } from 'electron'
import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type {
  ImageEditorDiagnosticBundleRequest,
  ImageEditorDiagnosticBundleResult,
} from '../../../../src/core/logging/diagnosticBundle'
import { createMainLogger } from './main-logger'
import { queryLogEvents } from './query'
import type { MainLogEvent } from './types'

const logger = createMainLogger('main.logging.diagnostic_bundle')
const MAX_DIAGNOSTIC_EVENTS = 500

interface DiagnosticRuntimeInfo {
  appVersion: string
  packaged: boolean
  platform: NodeJS.Platform
  release: string
  arch: string
  electron: string
  chrome: string
  node: string
  gpuFeatureStatus: Electron.GPUFeatureStatus
  gpuInfo: unknown
}

interface SafeDiagnosticLogEvent {
  timestamp: string
  level: MainLogEvent['level']
  source: MainLogEvent['source']
  domain: string
  event: string
  requestId?: string
  context?: Record<string, string | number | boolean | null>
}

const SAFE_CONTEXT_KEYS = new Set([
  'documentId',
  'revision',
  'sessionId',
  'purpose',
  'requestId',
  'request',
  'resourceGeneration',
  'generation',
  'reason',
  'errorName',
  'backend',
  'mip',
  'tileX',
  'tileY',
  'bytes',
  'byteLength',
  'budgetBytes',
  'residentBytes',
  'leasedBytes',
  'durationMs',
  'cancelled',
  'superseded',
])

function isImageEditorEvent(event: MainLogEvent): boolean {
  const value = `${event.domain}.${event.event}`.toLowerCase()
  return value.includes('image_editor')
    || value.includes('imageedit')
    || value.includes('image_edit')
    || value.includes('mask_editor')
    || value.includes('resource_ledger')
}

function sanitizeDiagnosticString(value: string): string {
  if (/^[a-z]:[\\/]/i.test(value) || value.startsWith('/')) return '[redacted-path]'
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return '[redacted-url]'
  return value.slice(0, 512)
}

function safeScalar(value: unknown): string | number | boolean | null | undefined {
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'string') return sanitizeDiagnosticString(value)
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return undefined
}

function pickSafeContext(value: unknown): SafeDiagnosticLogEvent['context'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const output: NonNullable<SafeDiagnosticLogEvent['context']> = {}
  for (const [key, nested] of Object.entries(value)) {
    if (!SAFE_CONTEXT_KEYS.has(key)) continue
    const scalar = safeScalar(nested)
    if (scalar !== undefined) output[key] = scalar
  }
  return Object.keys(output).length > 0 ? output : undefined
}

export function sanitizeImageEditorDiagnosticEvents(
  events: readonly MainLogEvent[],
): SafeDiagnosticLogEvent[] {
  return events.filter(isImageEditorEvent).map((event) => {
    const context = pickSafeContext(event.context)
    return {
      timestamp: event.timestamp,
      level: event.level,
      source: event.source,
      domain: event.domain,
      event: event.event,
      ...(event.requestId ? { requestId: event.requestId } : {}),
      ...(context ? { context } : {}),
    }
  })
}

async function readRuntimeInfo(): Promise<DiagnosticRuntimeInfo> {
  const gpuInfo = await app.getGPUInfo('basic').catch(() => ({ unavailable: true }))
  return {
    appVersion: app.getVersion(),
    packaged: app.isPackaged,
    platform: process.platform,
    release: os.release(),
    arch: process.arch,
    electron: process.versions.electron ?? 'unknown',
    chrome: process.versions.chrome ?? 'unknown',
    node: process.versions.node,
    gpuFeatureStatus: app.getGPUFeatureStatus(),
    gpuInfo,
  }
}

async function writeZip(targetPath: string, payload: unknown): Promise<void> {
  const stagedPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.${crypto.randomUUID()}.tmp`,
  )
  try {
    await fsp.mkdir(path.dirname(targetPath), { recursive: true })
    await new Promise<void>((resolve, reject) => {
      const output = fs.createWriteStream(stagedPath, { flags: 'wx', mode: 0o600 })
      const archive = new ZipArchive({ zlib: { level: 9 } })
      let settled = false
      const settle = (error?: unknown): void => {
        if (settled) return
        settled = true
        if (error) reject(error)
        else resolve()
      }
      output.once('close', () => settle())
      output.once('error', settle)
      archive.once('error', settle)
      archive.once('warning', settle)
      archive.pipe(output)
      archive.append(`${JSON.stringify(payload, null, 2)}\n`, { name: 'diagnostics.json' })
      void archive.finalize().catch(settle)
    })
    const backupPath = `${targetPath}.${crypto.randomUUID()}.bak`
    const targetExists = await fsp.access(targetPath).then(() => true).catch(() => false)
    if (!targetExists) {
      await fsp.rename(stagedPath, targetPath)
      return
    }
    await fsp.rename(targetPath, backupPath)
    try {
      await fsp.rename(stagedPath, targetPath)
      await fsp.rm(backupPath, { force: true })
    } catch (error) {
      await fsp.rename(backupPath, targetPath).catch(() => undefined)
      throw error
    }
  } catch (error) {
    await fsp.rm(stagedPath, { force: true }).catch(() => undefined)
    throw error
  }
}

export async function exportImageEditorDiagnosticBundle(
  request: ImageEditorDiagnosticBundleRequest,
): Promise<ImageEditorDiagnosticBundleResult> {
  const result = await dialog.showSaveDialog({
    defaultPath: `Henji-AI-图片编辑诊断-${new Date().toISOString().slice(0, 10)}.zip`,
    filters: [{ name: 'ZIP', extensions: ['zip'] }],
  })
  if (result.canceled || !result.filePath) return { status: 'cancelled' }

  const date = new Date().toISOString().slice(0, 10)
  const [runtime, queried] = await Promise.all([
    readRuntimeInfo(),
    queryLogEvents({ date, limit: MAX_DIAGNOSTIC_EVENTS }),
  ])
  const events = sanitizeImageEditorDiagnosticEvents(queried.events)
  const payload = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    privacy: {
      includesSourcePixels: false,
      includesFullPaths: false,
      includesAnnotationText: false,
      includesRemoteUrls: false,
      includesSecrets: false,
    },
    runtime,
    editor: request,
    logs: events,
  }

  logger.info('开始导出图片编辑诊断包', {
    event: 'image_editor_v3.diagnostic_bundle.export.start',
    context: { documentId: request.documentId, revision: request.revision },
  })
  try {
    await writeZip(result.filePath, payload)
    logger.info('图片编辑诊断包导出完成', {
      event: 'image_editor_v3.diagnostic_bundle.export.completed',
      context: { documentId: request.documentId, revision: request.revision },
    })
    return { status: 'completed', fileName: path.basename(result.filePath) }
  } catch (error) {
    logger.error('图片编辑诊断包导出失败', {
      event: 'image_editor_v3.diagnostic_bundle.export.failed',
      context: {
        documentId: request.documentId,
        revision: request.revision,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      },
      error,
    })
    throw error
  }
}
