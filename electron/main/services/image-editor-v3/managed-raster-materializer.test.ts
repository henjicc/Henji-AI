import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createImageEditDocumentV3 } from '../../../../src/core/imageEdit/v3/documentFactory'
import { ImageEditDocumentRepository } from './document-repository'
import {
  ManagedRasterMaterializer,
  type ManagedRasterSessionPort,
} from './managed-raster-materializer'
import { createImageEditSourceFingerprint } from './raster-export-snapshot'
import { ContentAddressedResourceStore } from './resource-store'
import type {
  RasterExportSessionResult,
  RasterExportSessionStartResult,
  StartRasterExportSessionRequest,
} from './raster-export-session'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fsp.rm(root, { recursive: true, force: true })))
})

async function fixture(): Promise<{
  root: string
  documents: ImageEditDocumentRepository
  resources: ContentAddressedResourceStore
  snapshot: Awaited<ReturnType<ImageEditDocumentRepository['load']>>
}> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'henji-managed-raster-'))
  roots.push(root)
  const documents = new ImageEditDocumentRepository(path.join(root, 'documents'))
  const resources = new ContentAddressedResourceStore(path.join(root, 'resources'))
  const source = await resources.putBuffer(Buffer.from('source'), { mediaType: 'image/png' })
  const document = createImageEditDocumentV3({
    width: 2,
    height: 1,
    documentId: 'managed-raster-document',
    sourceResourceId: source.id,
  })
  await documents.create({
    documentId: document.id,
    revision: document.revision,
    document,
    resourceRefs: [source.id],
  })
  return { root, documents, resources, snapshot: await documents.load(document.id) }
}

function fakeManager(): ManagedRasterSessionPort & { targetPath: string | null } {
  const state: { request: StartRasterExportSessionRequest | null; targetPath: string | null } = {
    request: null,
    targetPath: null,
  }
  return {
    get targetPath() { return state.targetPath },
    async start(request): Promise<RasterExportSessionStartResult> {
      state.request = request
      state.targetPath = request.targetPath
      return {
        sessionId: '11111111-1111-4111-8111-111111111111',
        documentId: 'managed-raster-document',
        revision: request.revision,
        sourceFingerprint: request.sourceFingerprint,
        format: request.format,
      }
    },
    async complete(ownerId, sessionId): Promise<RasterExportSessionResult> {
      const request = state.request
      if (!request || ownerId !== request.ownerId || sessionId !== '11111111-1111-4111-8111-111111111111') {
        throw new Error('unexpected fake completion')
      }
      await fsp.writeFile(request.targetPath, Buffer.from('streamed-png'))
      return {
        outputRef: `image-export-v3:managed-raster-document@${request.revision}:png8`,
        documentId: 'managed-raster-document',
        revision: request.revision,
        sourceFingerprint: request.sourceFingerprint as `sha256:${string}`,
        format: 'png8',
        width: 2,
        height: 1,
      }
    },
    async cancel(): Promise<boolean> {
      return true
    },
  }
}

function startRequest(
  snapshot: Awaited<ReturnType<ImageEditDocumentRepository['load']>>,
): Omit<StartRasterExportSessionRequest, 'targetPath'> {
  return {
    ownerId: 7,
    documentRef: `image-edit-v3:${snapshot.documentId}`,
    revision: snapshot.revision,
    sourceFingerprint: createImageEditSourceFingerprint(snapshot),
    format: 'png8',
    description: {
      width: 2,
      height: 1,
      channels: 4,
      bitDepth: 8,
      sampleFormat: 'uint',
      colorSpace: 'srgb',
      transferFunction: 'srgb',
      alphaMode: 'straight',
    },
  }
}

describe('图片编辑 V3 受管栅格物化', () => {
  it('流式完成后写入内容寻址资源并原子挂到同 revision 文档', async () => {
    const { root, documents, resources, snapshot } = await fixture()
    const manager = fakeManager()
    const service = new ManagedRasterMaterializer(
      manager,
      documents,
      resources,
      path.join(root, 'materializations'),
    )

    const started = await service.start(startRequest(snapshot))
    const result = await service.complete(7, started.sessionId)

    expect(result.previewRef).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(result.mediaUrl).toMatch(/^henji-media:\/\/image-editor-v3\/[a-f0-9]{64}\?mediaType=image%2Fpng$/)
    expect(result.mediaUrl).not.toContain(root)
    expect((await resources.readVerifiedBuffer(result.previewRef, 1024)).toString())
      .toBe('streamed-png')
    const saved = await documents.load(snapshot.documentId)
    expect(saved.revision).toBe(snapshot.revision)
    expect(saved.previewRef).toBe(result.previewRef)
    expect(saved.resourceRefs).toContain(result.previewRef)
    await expect(fsp.access(manager.targetPath!)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('取消时清理受管目标且不改文档预览引用', async () => {
    const { root, documents, resources, snapshot } = await fixture()
    const manager = fakeManager()
    const service = new ManagedRasterMaterializer(
      manager,
      documents,
      resources,
      path.join(root, 'materializations'),
    )
    const started = await service.start(startRequest(snapshot))
    await fsp.writeFile(manager.targetPath!, Buffer.from('partial'))

    expect(await service.cancel(7, started.sessionId)).toBe(true)
    await expect(fsp.access(manager.targetPath!)).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await documents.load(snapshot.documentId)).previewRef).toBeUndefined()
  })
})
