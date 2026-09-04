import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

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
  const state: { request: StartRasterExportSessionRequest | null; targetPath: string | null;
    sessionId: string } = {
    request: null,
    targetPath: null,
    sessionId: '11111111-1111-4111-8111-111111111111',
  }
  return {
    get targetPath() { return state.targetPath },
    async start(request): Promise<RasterExportSessionStartResult> {
      state.request = request
      state.targetPath = request.targetPath
      return {
        sessionId: state.sessionId,
        documentId: 'managed-raster-document',
        revision: request.revision,
        sourceFingerprint: request.sourceFingerprint,
        format: request.format,
      }
    },
    async restart(_ownerId, _sessionId): Promise<RasterExportSessionStartResult> {
      const request = state.request
      if (!request) throw new Error('unexpected fake restart')
      state.sessionId = '22222222-2222-4222-8222-222222222222'
      return {
        sessionId: state.sessionId,
        documentId: 'managed-raster-document',
        revision: request.revision,
        sourceFingerprint: request.sourceFingerprint,
        format: request.format,
      }
    },
    async complete(ownerId, sessionId): Promise<RasterExportSessionResult> {
      const request = state.request
      if (!request || ownerId !== request.ownerId || sessionId !== state.sessionId) {
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
  it('重启后保留publication映射且旧session不能发布', async () => {
    const { root, documents, resources, snapshot } = await fixture()
    const manager = fakeManager()
    const service = new ManagedRasterMaterializer(
      manager,
      documents,
      resources,
      path.join(root, 'materializations'),
      { publishStandalone: vi.fn(async () => ({
        imagePath: '/managed/restarted.png', createdFilePaths: ['/managed/restarted.png'],
      })) },
    )
    const started = await service.start({ ...startRequest(snapshot), publication: 'standalone-image' })
    const restarted = await service.restart(7, started.sessionId)

    expect(service.has(started.sessionId)).toBe(false)
    expect(service.has(restarted.sessionId)).toBe(true)
    await expect(service.complete(7, started.sessionId)).rejects.toThrow('not found')
    const result = await service.complete(7, restarted.sessionId)
    expect(result.publication).toBe('standalone-image')
  })

  it('并发重启复用同一新session，重启中的取消会落到新session', async () => {
    const { root, documents, resources, snapshot } = await fixture()
    const manager = fakeManager()
    const service = new ManagedRasterMaterializer(
      manager, documents, resources, path.join(root, 'materializations'),
    )
    const started = await service.start(startRequest(snapshot))
    let resolveRestart: ((value: RasterExportSessionStartResult) => void) | undefined
    const restart = vi.spyOn(manager, 'restart').mockImplementation(() => new Promise((resolve) => {
      resolveRestart = resolve
    }))
    const cancel = vi.spyOn(manager, 'cancel')
    const first = service.restart(7, started.sessionId)
    const second = service.restart(7, started.sessionId)
    const cancelling = service.cancel(7, started.sessionId, 'abort_during_retry')
    const replacement = {
      sessionId: '33333333-3333-4333-8333-333333333333',
      documentId: 'managed-raster-document',
      revision: snapshot.revision,
      sourceFingerprint: createImageEditSourceFingerprint(snapshot),
      format: 'png8' as const,
    }
    resolveRestart?.(replacement)

    await expect(first).resolves.toEqual(replacement)
    await expect(second).resolves.toEqual(replacement)
    await expect(cancelling).resolves.toBe(true)
    expect(restart).toHaveBeenCalledOnce()
    expect(cancel).toHaveBeenCalledWith(7, replacement.sessionId, 'abort_during_retry')
    expect(service.has(started.sessionId)).toBe(false)
    expect(service.has(replacement.sessionId)).toBe(false)
  })

  it('重启失败会先取消底层会话再清理受管目标与映射', async () => {
    const { root, documents, resources, snapshot } = await fixture()
    const manager = fakeManager()
    const service = new ManagedRasterMaterializer(
      manager, documents, resources, path.join(root, 'materializations'),
    )
    const started = await service.start(startRequest(snapshot))
    await fsp.writeFile(manager.targetPath!, Buffer.from('partial'))
    vi.spyOn(manager, 'restart').mockRejectedValue(new Error('restart failed'))
    const cancel = vi.spyOn(manager, 'cancel')

    await expect(service.restart(7, started.sessionId)).rejects.toThrow('restart failed')

    expect(cancel).toHaveBeenCalledWith(
      7,
      started.sessionId,
      'render_backend_restart_failed',
    )
    expect(service.has(started.sessionId)).toBe(false)
    await expect(fsp.access(manager.targetPath!)).rejects.toMatchObject({ code: 'ENOENT' })
  })

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

    if (result.publication !== 'document-preview') throw new Error('期望文档预览物化结果')

    expect(result.publication).toBe('document-preview')
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

  it('独立发布转存普通受管图片且不改写文档快照', async () => {
    const { root, documents, resources, snapshot } = await fixture()
    const manager = fakeManager()
    const publishStandalone = vi.fn(async (source: string) => {
      expect((await fsp.readFile(source)).toString()).toBe('streamed-png')
      return {
        imagePath: '/managed/standalone.png',
        createdFilePaths: ['/managed/standalone.png'],
      }
    })
    const service = new ManagedRasterMaterializer(
      manager,
      documents,
      resources,
      path.join(root, 'materializations'),
      { publishStandalone },
    )
    const before = await documents.load(snapshot.documentId)
    const started = await service.start({
      ...startRequest(snapshot),
      publication: 'standalone-image',
    })
    const result = await service.complete(7, started.sessionId)

    expect(result).toMatchObject({
      publication: 'standalone-image',
      imagePath: '/managed/standalone.png',
      createdFilePaths: ['/managed/standalone.png'],
    })
    expect(publishStandalone).toHaveBeenCalledOnce()
    expect(await documents.load(snapshot.documentId)).toEqual(before)
    await expect(fsp.access(manager.targetPath!)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
