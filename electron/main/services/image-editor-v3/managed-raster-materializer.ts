import crypto from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'

import { createMainLogger } from '../logging'
import { persistImageSourceTracked } from '../image/image-file-ops'
import { createImageEditSourceFingerprint } from './raster-export-snapshot'
import { createImageEditorV3ResourceMediaUrl } from './resource-media-url'
import type { ImageEditDocumentRepository } from './document-repository'
import type { ContentAddressedResourceStore } from './resource-store'
import type {
  RasterExportSessionResult,
  RasterExportSessionStartResult,
  StartRasterExportSessionRequest,
} from './raster-export-session'
import type { RasterExportFormat } from './export'
import type { ResourceId } from './contracts'

const logger = createMainLogger('main.image_editor_v3.managed_raster')
const STALE_OUTPUT_AGE_MS = 24 * 60 * 60 * 1_000
const MAX_MANAGED_OUTPUT_BYTES = 16 * 1024 * 1024 * 1024

export type ManagedRasterPublication = 'document-preview' | 'standalone-image'

type ManagedStartRequest = Omit<StartRasterExportSessionRequest, 'targetPath'> & {
  publication?: ManagedRasterPublication
}

export interface ManagedRasterSessionPort {
  start(request: StartRasterExportSessionRequest): Promise<RasterExportSessionStartResult>
  complete(ownerId: number, sessionId: string): Promise<RasterExportSessionResult>
  cancel(ownerId: number, sessionId: string, reason?: string): Promise<boolean>
}

interface ManagedSession {
  ownerId: number
  targetPath: string
  publication: ManagedRasterPublication
}

export interface ManagedRasterMaterializationResult extends RasterExportSessionResult {
  publication: 'document-preview'
  previewRef: ResourceId
  mediaUrl: string
}

export interface StandaloneRasterMaterializationResult extends RasterExportSessionResult {
  publication: 'standalone-image'
  imagePath: string
  createdFilePaths: string[]
}

interface ManagedRasterMaterializerDependencies {
  publishStandalone?: typeof persistImageSourceTracked
}

function outputPresentation(format: RasterExportFormat): { extension: string; mediaType: string } {
  switch (format) {
    case 'jpeg': return { extension: 'jpg', mediaType: 'image/jpeg' }
    case 'webp': return { extension: 'webp', mediaType: 'image/webp' }
    case 'png8':
    case 'png16': return { extension: 'png', mediaType: 'image/png' }
    case 'bigtiff':
    case 'tiff8':
    case 'tiff16': return { extension: 'tif', mediaType: 'image/tiff' }
    case 'avif10':
    case 'avif12': return { extension: 'avif', mediaType: 'image/avif' }
  }
}

export class ManagedRasterMaterializer {
  private readonly sessions = new Map<string, ManagedSession>()
  private initialization: Promise<void> | null = null

  constructor(
    private readonly manager: ManagedRasterSessionPort,
    private readonly documents: ImageEditDocumentRepository,
    private readonly resources: ContentAddressedResourceStore,
    private readonly stagingDir: string,
    private readonly dependencies: ManagedRasterMaterializerDependencies = {},
  ) {}

  async start(request: ManagedStartRequest): Promise<RasterExportSessionStartResult> {
    await this.initialize()
    const presentation = outputPresentation(request.format)
    const targetPath = path.join(
      this.stagingDir,
      `managed-${crypto.randomUUID()}.${presentation.extension}`,
    )
    try {
      const { publication = 'document-preview', ...startRequest } = request
      const started = await this.manager.start({ ...startRequest, targetPath })
      this.sessions.set(started.sessionId, { ownerId: request.ownerId, targetPath, publication })
      return started
    } catch (error) {
      await fsp.rm(targetPath, { force: true }).catch(() => undefined)
      throw error
    }
  }

  async complete(
    ownerId: number,
    sessionId: string,
  ): Promise<ManagedRasterMaterializationResult | StandaloneRasterMaterializationResult> {
    const session = this.getOwned(sessionId, ownerId)
    try {
      const completed = await this.manager.complete(ownerId, sessionId)
      if (session.publication === 'standalone-image') {
        const persisted = await (
          this.dependencies.publishStandalone ?? persistImageSourceTracked
        )(session.targetPath)
        logger.info('独立受管栅格结果已发布', {
          event: 'image_editor_v3.managed_raster.standalone.completed',
          requestId: sessionId,
          context: {
            documentId: completed.documentId,
            revision: completed.revision,
            format: completed.format,
            created: persisted.createdFilePaths.length > 0,
          },
        })
        return { ...completed, publication: 'standalone-image', ...persisted }
      }
      const presentation = outputPresentation(completed.format)
      const stored = await this.resources.putFile(session.targetPath, {
        mediaType: presentation.mediaType,
        maxBytes: MAX_MANAGED_OUTPUT_BYTES,
      })
      const lease = await this.resources.acquireLease([stored.id])
      try {
        const current = await this.documents.load(completed.documentId)
        if (
          current.revision !== completed.revision
          || createImageEditSourceFingerprint(current) !== completed.sourceFingerprint
        ) throw new Error('Managed raster snapshot changed before preview publication')
        await this.documents.save({
          documentId: current.documentId,
          expectedRevision: current.revision,
          nextRevision: current.revision,
          document: current.document,
          history: current.history,
          resourceRefs: current.resourceRefs,
          previewRef: stored.id,
        })
      } finally {
        await lease.release()
      }
      const result = {
        ...completed,
        publication: 'document-preview' as const,
        previewRef: stored.id,
        mediaUrl: createImageEditorV3ResourceMediaUrl(stored.id, presentation.mediaType),
      }
      logger.info('受管栅格结果已发布', {
        event: 'image_editor_v3.managed_raster.completed',
        requestId: sessionId,
        context: {
          documentId: completed.documentId,
          revision: completed.revision,
          format: completed.format,
          previewRef: stored.id,
        },
      })
      return result
    } finally {
      this.sessions.delete(sessionId)
      await fsp.rm(session.targetPath, { force: true }).catch(() => undefined)
    }
  }

  async cancel(ownerId: number, sessionId: string, reason = 'requested'): Promise<boolean> {
    const session = this.sessions.get(sessionId)
    if (session && session.ownerId !== ownerId) {
      throw new Error('Managed raster session belongs to another renderer')
    }
    try {
      return await this.manager.cancel(ownerId, sessionId, reason)
    } finally {
      this.sessions.delete(sessionId)
      if (session) await fsp.rm(session.targetPath, { force: true }).catch(() => undefined)
    }
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  private getOwned(sessionId: string, ownerId: number): ManagedSession {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error('Managed raster session was not found')
    if (session.ownerId !== ownerId) throw new Error('Managed raster session belongs to another renderer')
    return session
  }

  private initialize(): Promise<void> {
    if (this.initialization) return this.initialization
    this.initialization = (async () => {
      await fsp.mkdir(this.stagingDir, { recursive: true })
      const cutoff = Date.now() - STALE_OUTPUT_AGE_MS
      const entries = await fsp.readdir(this.stagingDir, { withFileTypes: true }).catch(() => [])
      await Promise.all(entries
        .filter((entry) => entry.isFile() && entry.name.startsWith('managed-'))
        .map(async (entry) => {
          const candidate = path.join(this.stagingDir, entry.name)
          const stats = await fsp.lstat(candidate).catch(() => null)
          if (stats?.isFile() && stats.mtimeMs < cutoff) await fsp.rm(candidate, { force: true })
        }))
    })()
    return this.initialization
  }
}
