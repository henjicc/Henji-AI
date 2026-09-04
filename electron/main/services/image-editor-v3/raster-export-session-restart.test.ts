import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { OutputTile, TileOutputDescription, TileOutputSink } from './contracts'
import { ImageEditDocumentRepository } from './document-repository'
import type { RasterExportOptions } from './export'
import { RasterExportSessionManager } from './raster-export-session'
import { createImageEditSourceFingerprint } from './raster-export-snapshot'
import { ContentAddressedResourceStore } from './resource-store'

class TestSink implements TileOutputSink {
  description: TileOutputDescription | undefined
  tiles: OutputTile[] = []
  cancelled = false
  beginGate: Promise<void> | undefined
  writeGate: Promise<void> | undefined
  completeGate: Promise<void> | undefined
  events: string[] = []

  constructor(
    readonly targetPath: string,
    readonly options: RasterExportOptions,
  ) {}

  async begin(description: TileOutputDescription): Promise<void> {
    await this.beginGate
    this.description = description
  }

  async writeTile(tile: OutputTile): Promise<void> {
    this.events.push('write:start')
    await this.writeGate
    this.tiles.push(tile)
    this.events.push('write:complete')
  }

  async complete(): Promise<void> {
    this.events.push('complete:start')
    await this.completeGate
    if (!this.description) throw new Error('missing description')
    if (this.options.validateSnapshot && !(await this.options.validateSnapshot(this.description))) {
      throw new Error('Output snapshot is no longer current')
    }
    this.events.push('complete:published')
  }

  async cancel(): Promise<void> {
    this.cancelled = true
    this.events.push('cancel')
  }
}

const description = {
  width: 2,
  height: 1,
  channels: 4 as const,
  bitDepth: 8 as const,
  sampleFormat: 'uint' as const,
  colorSpace: 'srgb' as const,
  transferFunction: 'srgb' as const,
  alphaMode: 'straight' as const,
}

let rootDir = ''
let documents: ImageEditDocumentRepository
let resources: ContentAddressedResourceStore
const managers: RasterExportSessionManager[] = []

beforeEach(async () => {
  rootDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'henji-raster-export-session-'))
  documents = new ImageEditDocumentRepository(path.join(rootDir, 'documents'))
  resources = new ContentAddressedResourceStore(path.join(rootDir, 'resources'))
})

afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.dispose('test_cleanup')))
  await fsp.rm(rootDir, { recursive: true, force: true })
})

async function createSnapshot(options: {
  hdr?: boolean
  geometry?: Record<string, unknown>
  color?: Record<string, unknown>
} = {}) {
  const resource = await resources.putBuffer(Uint8Array.from([1, 2, 3, 4]))
  const color = options.color ?? (options.hdr
    ? {
        workingSpace: 'rec2020', bitDepth: 16, transferFunction: 'pq',
        hdrMetadata: {
          standard: 'pq',
          referenceWhiteNits: 203,
          cicp: {
            colorPrimaries: 9,
            transferCharacteristics: 16,
            matrixCoefficients: 9,
            fullRange: false,
          },
        },
        iccProfileResourceId: null,
      }
    : {
        workingSpace: 'srgb', bitDepth: 8, transferFunction: 'srgb',
        hdrMetadata: null, iccProfileResourceId: null,
      })
  const iccRef = typeof color.iccProfileResourceId === 'string'
    ? color.iccProfileResourceId as `sha256:${string}`
    : undefined
  return documents.create({
    documentId: 'export-document',
    revision: 4,
    resourceRefs: [resource.id, ...(iccRef ? [iccRef] : [])],
    document: {
      version: 3,
      id: 'export-document',
      revision: 4,
      geometry: options.geometry ?? {
        width: 2,
        height: 1,
        crop: null,
        orientation: { rotate: 0, mirrored: false },
      },
      color,
      layers: [],
    },
  })
}

function createManager(sinks: TestSink[]): RasterExportSessionManager {
  const manager = new RasterExportSessionManager(documents, resources, {
    createSink: (targetPath, options) => {
      const sink = new TestSink(targetPath, options)
      sinks.push(sink)
      return sink
    },
  })
  managers.push(manager)
  return manager
}

describe('RasterExportSessionManager', () => {
  it('重启时先清理旧staging并以同一目标创建隔离的新会话', async () => {
    const snapshot = await createSnapshot()
    const sinks: TestSink[] = []
    const manager = createManager(sinks)
    const targetPath = path.join(rootDir, 'atomic-retry.tif')
    const started = await manager.start({
      ownerId: 7,
      targetPath,
      documentRef: 'image-edit-v3:export-document',
      revision: 4,
      sourceFingerprint: createImageEditSourceFingerprint(snapshot),
      format: 'bigtiff',
      description,
      tileSize: 16,
    })
    await manager.writeTile(7, started.sessionId, {
      x: 0, y: 0, width: 1, height: 1, rowStride: 4, pixels: new Uint8Array(4),
    })

    const restarted = await manager.restart(7, started.sessionId)

    expect(restarted.sessionId).not.toBe(started.sessionId)
    expect(sinks).toHaveLength(2)
    expect(sinks[0]).toMatchObject({ targetPath, cancelled: true })
    expect(sinks[1]).toMatchObject({ targetPath, cancelled: false })
    await expect(manager.complete(7, started.sessionId)).rejects.toThrow('not found')
    await manager.writeTile(7, restarted.sessionId, {
      x: 0, y: 0, width: 2, height: 1, rowStride: 8, pixels: new Uint8Array(8),
    })
    await expect(manager.complete(7, restarted.sessionId)).resolves.toMatchObject({
      outputRef: 'image-export-v3:export-document@4:bigtiff',
    })
    expect(sinks[0]?.events).not.toContain('complete:published')
    expect(sinks[1]?.events).toContain('complete:published')
  })
})
