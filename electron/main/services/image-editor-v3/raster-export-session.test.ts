import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { OutputTile, TileOutputDescription, TileOutputSink } from './contracts'
import { ImageEditDocumentRepository } from './document-repository'
import { ImageExportCapabilityError, type RasterExportOptions } from './export'
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
        hdrMetadata: { standard: 'pq' }, iccProfileResourceId: null,
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
  it('把导出绑定到权威快照、租住资源并在完成后释放', async () => {
    const snapshot = await createSnapshot()
    const sourceFingerprint = createImageEditSourceFingerprint(snapshot)
    const sinks: TestSink[] = []
    const manager = createManager(sinks)
    const started = await manager.start({
      ownerId: 7,
      targetPath: path.join(rootDir, 'export.png'),
      documentRef: 'image-edit-v3:export-document',
      revision: 4,
      sourceFingerprint,
      format: 'png8',
      description,
      tileSize: 16,
    })

    expect(started).toMatchObject({ revision: 4, sourceFingerprint, format: 'png8' })
    expect(sinks[0]?.description).toMatchObject({
      documentId: 'export-document', revision: 4, sourceFingerprint,
    })
    expect((await resources.garbageCollect(new Set(), { minimumAgeMs: 0 })).retainedByLease)
      .toEqual(snapshot.resourceRefs)

    await manager.writeTile(7, started.sessionId, {
      x: 0, y: 0, width: 2, height: 1, rowStride: 8, pixels: new Uint8Array(8),
    })
    await expect(manager.complete(7, started.sessionId)).resolves.toMatchObject({
      outputRef: 'image-export-v3:export-document@4:png8',
      sourceFingerprint,
      width: 2,
      height: 1,
    })
    expect((await resources.garbageCollect(new Set(), { minimumAgeMs: 0 })).deleted)
      .toEqual(snapshot.resourceRefs)
  })

  it('在发布前重读文档，revision 变化时回滚会话', async () => {
    const snapshot = await createSnapshot()
    const sinks: TestSink[] = []
    const manager = createManager(sinks)
    const started = await manager.start({
      ownerId: 2,
      targetPath: path.join(rootDir, 'stale.tif'),
      documentRef: 'image-edit-v3:export-document',
      revision: 4,
      sourceFingerprint: createImageEditSourceFingerprint(snapshot),
      format: 'bigtiff',
      description,
      tileSize: 16,
    })
    await manager.writeTile(2, started.sessionId, {
      x: 0, y: 0, width: 2, height: 1, rowStride: 8, pixels: new Uint8Array(8),
    })
    await documents.save({
      documentId: snapshot.documentId,
      expectedRevision: 4,
      nextRevision: 5,
      document: { ...(snapshot.document as Record<string, unknown>), revision: 5 },
      resourceRefs: snapshot.resourceRefs,
    })

    await expect(manager.complete(2, started.sessionId)).rejects.toThrow('no longer current')
    expect(sinks[0]?.cancelled).toBe(true)
  })

  it('按方向变换后的画布校验裁剪，裁剪尺寸就是最终输出尺寸', async () => {
    const snapshot = await createSnapshot({
      geometry: {
        width: 4,
        height: 2,
        orientation: { rotate: 90, mirrored: false },
        crop: { x: 0, y: 1, width: 2, height: 3 },
      },
    })
    const sinks: TestSink[] = []
    const manager = createManager(sinks)
    const started = await manager.start({
      ownerId: 8,
      targetPath: path.join(rootDir, 'rotated-crop.png'),
      documentRef: 'image-edit-v3:export-document',
      revision: 4,
      sourceFingerprint: createImageEditSourceFingerprint(snapshot),
      format: 'png8',
      description: { ...description, width: 2, height: 3 },
    })

    expect(sinks[0]?.description).toMatchObject({ width: 2, height: 3 })
    await manager.cancel(8, started.sessionId)
  })

  it('禁止 renderer 把 16-bit Display-P3 快照静默声明为 8-bit sRGB', async () => {
    const profile = await resources.putBuffer(new Uint8Array(128))
    const snapshot = await createSnapshot({
      color: {
        workingSpace: 'display-p3', bitDepth: 16, transferFunction: 'srgb',
        hdrMetadata: null, iccProfileResourceId: profile.id,
      },
    })
    const sinkFactory = vi.fn()
    const manager = new RasterExportSessionManager(documents, resources, {
      createSink: sinkFactory,
    })
    managers.push(manager)
    const common = {
      ownerId: 3,
      targetPath: path.join(rootDir, 'color.png'),
      documentRef: 'image-edit-v3:export-document',
      revision: 4,
      sourceFingerprint: createImageEditSourceFingerprint(snapshot),
      format: 'png16' as const,
    }

    await expect(manager.start({ ...common, description }))
      .rejects.toMatchObject({ code: 'SOURCE_PRECISION_UNSUPPORTED' })
    await expect(manager.start({
      ...common,
      description: { ...description, bitDepth: 16 },
    })).rejects.toMatchObject({ code: 'INVALID_COLOR_METADATA' })
    expect(sinkFactory).not.toHaveBeenCalled()
  })

  it('拒绝伪造快照指纹，并拒绝把 HDR 文档冒充 SDR 输出', async () => {
    await createSnapshot()
    const sinkFactory = vi.fn()
    const manager = new RasterExportSessionManager(documents, resources, {
      createSink: sinkFactory,
    })
    managers.push(manager)
    await expect(manager.start({
      ownerId: 1,
      targetPath: path.join(rootDir, 'forged.png'),
      documentRef: 'image-edit-v3:export-document',
      revision: 4,
      sourceFingerprint: `sha256:${'f'.repeat(64)}`,
      format: 'png8',
      description,
    })).rejects.toThrow('does not match')
    expect(sinkFactory).not.toHaveBeenCalled()

    await fsp.rm(path.join(rootDir, 'documents'), { recursive: true, force: true })
    const hdr = await createSnapshot({ hdr: true })
    let failure: unknown
    try {
      await manager.start({
        ownerId: 1,
        targetPath: path.join(rootDir, 'hdr.avif'),
        documentRef: 'image-edit-v3:export-document',
        revision: 4,
        sourceFingerprint: createImageEditSourceFingerprint(hdr),
        format: 'avif10',
        description: { ...description, bitDepth: 16 },
      })
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(ImageExportCapabilityError)
    expect(failure).toMatchObject({ code: 'HDR_METADATA_UNSUPPORTED', format: 'avif10' })
    expect(sinkFactory).not.toHaveBeenCalled()
  })

  it('会话只允许创建它的渲染器写入和取消', async () => {
    const snapshot = await createSnapshot()
    const sinks: TestSink[] = []
    const manager = createManager(sinks)
    const started = await manager.start({
      ownerId: 11,
      targetPath: path.join(rootDir, 'owned.png'),
      documentRef: 'image-edit-v3:export-document',
      revision: 4,
      sourceFingerprint: createImageEditSourceFingerprint(snapshot),
      format: 'png8',
      description,
    })

    await expect(manager.writeTile(12, started.sessionId, {
      x: 0, y: 0, width: 2, height: 1, rowStride: 8, pixels: new Uint8Array(8),
    })).rejects.toThrow('another renderer')
    await expect(manager.cancel(12, started.sessionId)).rejects.toThrow('another renderer')
    await expect(manager.cancel(11, started.sessionId)).resolves.toBe(true)
    expect(sinks[0]?.cancelled).toBe(true)
  })

  it('取消会等待正在写入的原子瓦片，再单次取消 sink 并释放 lease', async () => {
    const snapshot = await createSnapshot()
    const sinks: TestSink[] = []
    const manager = createManager(sinks)
    const started = await manager.start({
      ownerId: 21,
      targetPath: path.join(rootDir, 'cooperative.png'),
      documentRef: 'image-edit-v3:export-document',
      revision: 4,
      sourceFingerprint: createImageEditSourceFingerprint(snapshot),
      format: 'png8',
      description,
    })
    let releaseWrite: (() => void) | undefined
    sinks[0]!.writeGate = new Promise<void>((resolve) => { releaseWrite = resolve })
    const writing = manager.writeTile(21, started.sessionId, {
      x: 0, y: 0, width: 2, height: 1, rowStride: 8, pixels: new Uint8Array(8),
    })
    await vi.waitFor(() => expect(sinks[0]?.events).toEqual(['write:start']))
    const cancelling = manager.cancel(21, started.sessionId)
    await Promise.resolve()

    expect(sinks[0]?.events).toEqual(['write:start'])
    expect((await resources.garbageCollect(new Set(), { minimumAgeMs: 0 })).retainedByLease)
      .toEqual(snapshot.resourceRefs)
    releaseWrite?.()
    await Promise.all([writing, cancelling])
    expect(sinks[0]?.events).toEqual(['write:start', 'write:complete', 'cancel'])
    expect((await resources.garbageCollect(new Set(), { minimumAgeMs: 0 })).deleted)
      .toEqual(snapshot.resourceRefs)
  })

  it('在异步 begin 期间预留目标路径，阻止并发会话绕过唯一性检查', async () => {
    const snapshot = await createSnapshot()
    const sinks: TestSink[] = []
    let releaseBegin: (() => void) | undefined
    const beginGate = new Promise<void>((resolve) => { releaseBegin = resolve })
    const manager = new RasterExportSessionManager(documents, resources, {
      createSink: (targetPath, options) => {
        const sink = new TestSink(targetPath, options)
        sink.beginGate = beginGate
        sinks.push(sink)
        return sink
      },
    })
    managers.push(manager)
    const targetPath = path.join(rootDir, 'reserved.png')
    const request = {
      ownerId: 31,
      targetPath,
      documentRef: 'image-edit-v3:export-document',
      revision: 4,
      sourceFingerprint: createImageEditSourceFingerprint(snapshot),
      format: 'png8' as const,
      description,
    }
    const first = manager.start(request)
    await vi.waitFor(() => expect(sinks).toHaveLength(1))

    await expect(manager.start(request)).rejects.toThrow('already writing')
    expect(sinks).toHaveLength(1)
    releaseBegin?.()
    const started = await first
    await manager.cancel(31, started.sessionId)
  })

  it('完成已进入发布流程时，取消等待发布并明确返回未取消', async () => {
    const snapshot = await createSnapshot()
    const sinks: TestSink[] = []
    const manager = createManager(sinks)
    const started = await manager.start({
      ownerId: 32,
      targetPath: path.join(rootDir, 'publish-wins.png'),
      documentRef: 'image-edit-v3:export-document',
      revision: 4,
      sourceFingerprint: createImageEditSourceFingerprint(snapshot),
      format: 'png8',
      description,
    })
    let releaseComplete: (() => void) | undefined
    sinks[0]!.completeGate = new Promise<void>((resolve) => { releaseComplete = resolve })
    const completing = manager.complete(32, started.sessionId)
    await vi.waitFor(() => expect(sinks[0]?.events).toContain('complete:start'))
    const cancelling = manager.cancel(32, started.sessionId)
    releaseComplete?.()

    await expect(completing).resolves.toMatchObject({ format: 'png8' })
    await expect(cancelling).resolves.toBe(false)
    expect(sinks[0]?.cancelled).toBe(false)
    expect(sinks[0]?.events).toEqual(['complete:start', 'complete:published'])
  })

  it('瓦片写入超时后取消 sink 并释放资源 lease', async () => {
    const snapshot = await createSnapshot()
    const sinks: TestSink[] = []
    const manager = new RasterExportSessionManager(documents, resources, {
      createSink: (targetPath, options) => {
        const sink = new TestSink(targetPath, options)
        sink.writeGate = new Promise<void>(() => undefined)
        sinks.push(sink)
        return sink
      },
      tileTimeoutMs: 10,
      cancelTimeoutMs: 10,
    })
    managers.push(manager)
    const started = await manager.start({
      ownerId: 33,
      targetPath: path.join(rootDir, 'write-timeout.png'),
      documentRef: 'image-edit-v3:export-document',
      revision: 4,
      sourceFingerprint: createImageEditSourceFingerprint(snapshot),
      format: 'png8',
      description,
    })

    await expect(manager.writeTile(33, started.sessionId, {
      x: 0, y: 0, width: 2, height: 1, rowStride: 8, pixels: new Uint8Array(8),
    })).rejects.toThrow('timed out')
    expect(sinks[0]?.cancelled).toBe(true)
    expect((await resources.garbageCollect(new Set(), { minimumAgeMs: 0 })).deleted)
      .toEqual(snapshot.resourceRefs)
  })
})
