import crypto from 'node:crypto'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { expect, it, vi } from 'vitest'

import { createImageEditAdjustmentLayerV3, createImageEditDocumentV3, createImageEditRasterLayerV3 } from '../core/imageEdit/v3/documentFactory'
import { createImageEditSparseMaskReferenceV3 } from '../core/imageEdit/v3/layerTypes'
import { createFloat32MaskTile } from '../core/imageEdit/v3/effects/contracts'
import { renderImageEditorV3ExportTiles } from '../features/imageEdit/v3/export/renderExportTilesV3'
import { loadSharp } from '../../electron/main/services/image/sharp-loader'
import { ContentAddressedResourceStore } from '../../electron/main/services/image-editor-v3/resource-store'
import { ImageEditDocumentRepository } from '../../electron/main/services/image-editor-v3/document-repository'
import { ImageEditBrushTileStoreV3 } from '../../electron/main/services/image-editor-v3/brush-tile-store'
import { SharpSourceProvider } from '../../electron/main/services/image-editor-v3/source-provider'
import { HenjiImagePackageCodec } from '../../electron/main/services/image-editor-v3/package-codec'
import { TranscodingTileOutputSink } from '../../electron/main/services/image-editor-v3/export/transcoding-output-sink'
import { createImageEditSourceFingerprint } from '../../electron/main/services/image-editor-v3/raster-export-snapshot'
import { describeImageEditorV3DocumentResources } from '../../electron/main/services/image-editor-v3/snapshot-resources'
import { ImageDocumentService } from '../../electron/main/services/image-editor-v3/image-document/image-document-service'
import { ImageDocumentWorkingCopyLinks } from '../../electron/main/services/image-editor-v3/image-document/working-copy-links'
import { createMainLogger } from '../../electron/main/services/logging'
import * as logPush from '../../electron/main/services/logging/push'
import type { MainLogEvent } from '../../electron/main/services/logging/types'

// Explicit local benchmark only. CI must never spend minutes rendering 8K images.
const enabled = process.env.HENJI_IMAGE_SAVE_BENCH === '1' && !process.env.CI

it.runIf(enabled)('measures real 4K/8K save stages and pixel roundtrip', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'henji-save-perf-'))
  const sharp = await loadSharp()
  let timer: NodeJS.Timeout | undefined
  const phaseEvents: MainLogEvent[] = []
  // Capture the existing logger in the headless fixture; never write user logs.
  vi.spyOn(logPush, 'appendLogEvents').mockImplementation(async (events) => { phaseEvents.push(...events) })
  try {
    for (const size of [4096, 8192]) {
      phaseEvents.length = 0
      const dir = path.join(root, String(size))
      await fsp.mkdir(dir, { recursive: true })
      const resources = new ContentAddressedResourceStore(path.join(dir, 'resources'))
      const documents = new ImageEditDocumentRepository(path.join(dir, 'documents'))
      const packages = new HenjiImagePackageCodec(resources)
      const sources = new SharpSourceProvider(resources)
      const brushes = new ImageEditBrushTileStoreV3(resources)
      const raw = Buffer.allocUnsafe(size * size * 4)
      for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
        const offset = (y * size + x) * 4
        raw[offset] = (x * 13 + y * 7) & 255
        raw[offset + 1] = (x * 3 + y * 17) & 255
        raw[offset + 2] = ((x ^ y) * 11) & 255
        raw[offset + 3] = 255
      }
      const sourceFile = path.join(dir, 'source.png')
      const setupAt = performance.now()
      await sharp(raw, { raw: { width: size, height: size, channels: 4 } }).png().toFile(sourceFile)
      const source = await resources.putFile(sourceFile)
      const maskPixels = createFloat32MaskTile(512, 512, new Float32Array(512 * 512).fill(.5))
      const maskResource = await brushes.persistTile(maskPixels)
      const mask = { ...createImageEditSparseMaskReferenceV3('bench-mask', false, 1), tiles: { '0/0/0': maskResource.resourceId } }
      const document = createImageEditDocumentV3({ documentId: `bench-${size}`, width: size, height: size, sourceResourceId: source.id })
      const overlay = createImageEditRasterLayerV3('overlay', '叠加', source.id)
      overlay.opacity = .4
      overlay.mask = mask
      overlay.filters = [{ id: 'filter', operationType: 'adjustment', effectId: 'exposure', params: { stops: .2 }, enabled: true, opacity: .6, blendMode: 'normal', mask }]
      document.layers.push(overlay, createImageEditAdjustmentLayerV3('adjustment', '曝光', 'exposure', { stops: .1 }))
      const envelope = await documents.create({ documentId: document.id, document, resourceRefs: [source.id, maskResource.resourceId as `sha256:${string}`] })
      const descriptors = await describeImageEditorV3DocumentResources(document, undefined, envelope.resourceRefs, (id) => resources.describe(id as `sha256:${string}`), brushes, new AbortController().signal)
      const setupMs = performance.now() - setupAt
      const serializedAt = performance.now()
      JSON.stringify(envelope)
      const serializationMs = performance.now() - serializedAt
      let sourceReadMs = 0
      let tileWriteMs = 0
      let timerLagMs = 0
      let previous = performance.now()
      timer = setInterval(() => { const now = performance.now(); timerLagMs = Math.max(timerLagMs, now - previous - 10); previous = now }, 10)
      const description = { width: size, height: size, channels: 4 as const, bitDepth: 8 as const, sampleFormat: 'uint' as const, colorSpace: 'srgb' as const, transferFunction: 'srgb' as const, alphaMode: 'straight' as const,
        documentId: document.id, revision: 0, sourceFingerprint: createImageEditSourceFingerprint(envelope) }
      const target = path.join(dir, 'preview.png')
      const sink = new TranscodingTileOutputSink(target, { format: 'png8', tileSize: 512, inputByteOrder: 'little-endian' })
      const started = performance.now()
      await sink.begin(description)
      const tiles = renderImageEditorV3ExportTiles({ document, resourceDescriptors: descriptors, description, tileSize: 512 }, {
        readSourcePyramid: (id, signal) => sources.describePyramid(id, signal),
        readSourceTile: async (request, signal) => {
          const at = performance.now()
          const tile = await sources.readTile({ ...request, resourceId: request.resourceRef, signal })
          sourceReadMs += performance.now() - at
          return { ...tile, resourceRef: tile.resourceId, pixels: Uint8Array.from(tile.pixels).buffer }
        },
        readBrushTiles: async (tiles, signal) => ({ tiles: await Promise.all(tiles.map(async ({ tileKey, resource }) => ({ tileKey, tile: await brushes.readTile(resource, signal) }))) }),
      })
      const pixelsHash = crypto.createHash('sha256')
      for await (const tile of tiles) {
        pixelsHash.update(new Uint8Array(tile.pixels))
        const at = performance.now()
        await sink.writeTile({ ...tile, pixels: new Uint8Array(tile.pixels) })
        tileWriteMs += performance.now() - at
      }
      const renderedMs = performance.now() - started
      const renderEventLoopMaxLagMs = timerLagMs
      timerLagMs = 0
      previous = performance.now()
      const encodeAt = performance.now()
      await sink.complete()
      const finalEncodeAndSyncMs = performance.now() - encodeAt
      const hashAt = performance.now()
      const preview = await resources.putFile(target)
      const hashAndResourceWriteMs = performance.now() - hashAt
      const saved = await documents.save({ documentId: document.id, expectedRevision: 0, nextRevision: 0, document, resourceRefs: envelope.resourceRefs, previewRef: preview.id })
      const service = new ImageDocumentService({ documents, packages,
        links: new ImageDocumentWorkingCopyLinks(path.join(dir, 'links')),
        catalog: { listDocuments: async () => [], listProjects: async () => [], refreshIndex: async () => undefined,
          saveDocumentCover: async () => undefined, layout: () => ({ root: path.join(dir, 'works'), locale: 'zh' }) },
        lockDirectory: path.join(dir, 'locks'), logger: createMainLogger('test.image_save_perf'),
        validateDocument: () => undefined, resourceFilePath: (id) => resources.getFilesystemPath(id), resourceMediaUrl: async () => null,
      })
      const packAt = performance.now()
      const created = await service.create({ documentId: document.id, container: { kind: 'user' }, emptyUntilRevision: null })
      const packagePath = created.read.meta.path
      const packageWriteAndSyncMs = performance.now() - packAt
      const unchangedAt = performance.now()
      expect((await service.commit({ target: { id: document.id, path: packagePath }, expectedRevision: 0 })).unchanged).toBe(true)
      const unchangedMs = performance.now() - unchangedAt
      const changed = { ...document, revision: 1, layers: document.layers.map((layer) => ({ ...layer, name: `${layer.name}改名` })) }
      await documents.save({ documentId: document.id, expectedRevision: 0, nextRevision: 1, document: changed, resourceRefs: saved.resourceRefs, previewRef: preview.id })
      const metadataAt = performance.now()
      await service.commit({ target: { id: document.id, path: packagePath }, expectedRevision: 0 })
      const metadataCommitMs = performance.now() - metadataAt
      clearInterval(timer)
      const reopen = await packages.import(packagePath)
      expect(reopen.manifest.document.document).toEqual(changed)
      expect(reopen.manifest.document.previewRef).toBe(preview.id)
      const decoded = await sharp(resources.getFilesystemPath(preview.id)).ensureAlpha().raw().toBuffer()
      // Compare scanline output against the render stream's tile order, including all pixels.
      const reopenedHash = crypto.createHash('sha256')
      for (let y = 0; y < size; y += 512) for (let x = 0; x < size; x += 512) {
        for (let row = y; row < y + 512; row += 1) reopenedHash.update(decoded.subarray((row * size + x) * 4, (row * size + x + 512) * 4))
      }
      expect(reopenedHash.digest('hex')).toBe(pixelsHash.digest('hex'))
      await reopen.resourceLease.release()
      const phases = ['image_editor_v3.export.transcode.completed', 'image_editor_v3.output.completed', 'image_editor_v3.package.staged.completed']
        .map((event) => ({ event, measurements: phaseEvents.find((entry) => entry.event === event)?.context ?? null }))
      expect(phases.every((phase) => phase.measurements !== null)).toBe(true)
      process.stdout.write(`${JSON.stringify({ label: process.env.HENJI_IMAGE_SAVE_BENCH_LABEL ?? 'current', size, setupMs, serializationMs, sourceReadMs, renderAndTileWriteMs: renderedMs, tileWriteMs, finalEncodeAndSyncMs, hashAndResourceWriteMs, packageWriteAndSyncMs, unchangedMs, metadataCommitMs, totalMs: renderedMs + finalEncodeAndSyncMs + hashAndResourceWriteMs + packageWriteAndSyncMs, renderEventLoopMaxLagMs, storageEventLoopMaxLagMs: timerLagMs, phases, ipcMs: null, note: 'formal CPU renderer + real files; no Electron/IPC/UI measurement; metadata commit deliberately bypasses rematerialization to isolate packing cost' })}\n`)
    }
  } finally {
    if (timer) clearInterval(timer)
    vi.restoreAllMocks()
    await fsp.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
}, 900_000)
