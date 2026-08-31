import crypto from 'node:crypto'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  createImageEditDocumentV3,
  createImageEditRasterLayerV3,
} from '../../../src/core/imageEdit/v3/documentFactory'
import type { ImageEditDocumentV3 } from '../../../src/core/imageEdit/v3/documentTypes'
import {
  IMAGE_EDIT_PROJECT_PACKAGE_BUNDLE_PATH_V3,
  IMAGE_EDIT_PROJECT_PACKAGE_EXTENSION_VERSION_V3,
  type ImageEditProjectPackageExtensionV3,
} from '../../../src/core/imageEdit/v3/projectPackageContracts'
import {
  IMAGE_EDIT_DOCUMENT_FORMAT,
  IMAGE_EDIT_DOCUMENT_VERSION,
  type ImageEditDocumentEnvelope,
  type ResourceId,
} from './image-editor-v3/contracts'
import { ImageEditDocumentRepository } from './image-editor-v3/document-repository'
import { ContentAddressedResourceStore } from './image-editor-v3/resource-store'
import {
  importProjectImageEditorV3Bundle,
  prepareProjectImageEditorV3Export,
  validateProjectImageEditorV3EntryPath,
  type ProjectImageEditorV3BundleManifest,
  type StagedProjectImageEditorV3Resource,
} from './project-package-image-editor-v3'

let rootDir = ''

beforeEach(async () => {
  rootDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'henji-project-image-edit-v3-'))
})

afterEach(async () => {
  await fsp.rm(rootDir, { recursive: true, force: true })
})

function extensionFor(envelope: ImageEditDocumentEnvelope): ImageEditProjectPackageExtensionV3 {
  return {
    version: IMAGE_EDIT_PROJECT_PACKAGE_EXTENSION_VERSION_V3,
    bundlePath: IMAGE_EDIT_PROJECT_PACKAGE_BUNDLE_PATH_V3,
    documents: [{
      documentRef: `image-edit-v3:${envelope.documentId}`,
      revision: envelope.revision,
      previewRef: envelope.previewRef ?? null,
    }],
  }
}

function createDocument(
  documentId: string,
  revision: number,
  resources: readonly ResourceId[],
): ImageEditDocumentV3 {
  const [source, brush, mask] = resources
  const raster = createImageEditRasterLayerV3('paint-layer', '绘制', source)
  if (brush) raster.tiles['0/0/0'] = brush
  if (mask) {
    raster.mask = {
      kind: 'sparse-mask',
      storage: 'mask-float32',
      maskId: 'layer-mask',
      tileSize: 512,
      defaultValue: 1,
      tiles: { '0/0/0': mask },
      inverted: false,
    }
  }
  return {
    ...createImageEditDocumentV3({ width: 128, height: 96, documentId }),
    revision,
    layers: [raster],
  }
}

async function createEnvelope(
  repository: ImageEditDocumentRepository,
  documentId: string,
  refs: readonly ResourceId[],
): Promise<ImageEditDocumentEnvelope> {
  const document = createDocument(documentId, 4, refs)
  return repository.create({
    documentId,
    revision: 4,
    document,
    resourceRefs: refs,
    previewRef: refs[3],
    now: new Date('2026-08-31T00:00:00.000Z'),
  })
}

async function stageResources(
  manifest: ProjectImageEditorV3BundleManifest,
  store: ContentAddressedResourceStore,
  directory: string,
): Promise<StagedProjectImageEditorV3Resource[]> {
  await fsp.mkdir(directory, { recursive: true })
  return Promise.all(manifest.resources.map(async (resource, index) => {
    const filePath = path.join(directory, `${index}.resource`)
    await fsp.copyFile(store.getFilesystemPath(resource.resourceId), filePath)
    return {
      path: resource.path,
      filePath,
      sha256: resource.sha256,
      byteLength: resource.byteLength,
    }
  }))
}

describe('项目包图片编辑 V3 权威资源适配', () => {
  it('拒绝路径穿越、反斜杠和未声明的 V3 包条目', () => {
    expect(() => validateProjectImageEditorV3EntryPath('image-editor-v3/../escaped'))
      .toThrow()
    expect(() => validateProjectImageEditorV3EntryPath('image-editor-v3\\resources\\hash'))
      .toThrow('Unsupported')
    expect(() => validateProjectImageEditorV3EntryPath('image-editor-v3/other.json'))
      .toThrow('Unsupported')
  })

  it('跨资源库往返源图、ICC、画笔、蒙版、预览和历史并重映射文档 ID', async () => {
    const sourceStore = new ContentAddressedResourceStore(path.join(rootDir, 'source-resources'))
    const refs = await Promise.all([
      sourceStore.putBuffer(Buffer.from('source-raster')),
      sourceStore.putBuffer(Buffer.from('icc-profile')),
      sourceStore.putBuffer(Buffer.from('brush-tile')),
      sourceStore.putBuffer(Buffer.from('preview')),
      sourceStore.putBuffer(Buffer.from('mask-tile')),
    ])
    const resourceIds = [refs[0].id, refs[2].id, refs[4].id, refs[3].id, refs[1].id]
    const sourceDocuments = new ImageEditDocumentRepository(path.join(rootDir, 'source-documents'))
    const envelope = await createEnvelope(sourceDocuments, 'source-document', resourceIds)
    const prepared = await prepareProjectImageEditorV3Export(extensionFor(envelope), {
      documents: sourceDocuments,
      resources: sourceStore,
    })
    expect(prepared.manifest.resources.map((resource) => resource.resourceId).sort())
      .toEqual([...new Set(envelope.resourceRefs)].sort())
    const staged = await stageResources(prepared.manifest, sourceStore, path.join(rootDir, 'staged'))
    await prepared.lease.release()

    const targetStore = new ContentAddressedResourceStore(path.join(rootDir, 'target-resources'))
    const targetDocuments = new ImageEditDocumentRepository(path.join(rootDir, 'target-documents'))
    const mappings = await importProjectImageEditorV3Bundle(
      extensionFor(envelope),
      prepared.manifest,
      staged,
      {
        documents: targetDocuments,
        resources: targetStore,
        createDocumentId: () => 'imported-document',
      },
    )

    expect(mappings).toEqual([{
      source: extensionFor(envelope).documents[0],
      imported: {
        documentRef: 'image-edit-v3:imported-document',
        revision: 4,
        previewRef: envelope.previewRef,
      },
    }])
    const imported = await targetDocuments.load('imported-document')
    expect((imported.document as ImageEditDocumentV3).id).toBe('imported-document')
    expect(imported.history).toBeUndefined()
    expect(imported.resourceRefs.sort()).toEqual(envelope.resourceRefs.sort())
    for (const ref of envelope.resourceRefs) {
      expect((await targetStore.verify(ref)).sha256).toBe(ref.slice('sha256:'.length))
    }
  })

  it('缺失或篡改资源时在写入前失败', async () => {
    const sourceStore = new ContentAddressedResourceStore(path.join(rootDir, 'source-resources'))
    const resource = await sourceStore.putBuffer(Buffer.from('authoritative'))
    const sourceDocuments = new ImageEditDocumentRepository(path.join(rootDir, 'source-documents'))
    const envelope = await createEnvelope(sourceDocuments, 'source-document', [
      resource.id,
      resource.id,
      resource.id,
      resource.id,
    ])
    const prepared = await prepareProjectImageEditorV3Export(extensionFor(envelope), {
      documents: sourceDocuments,
      resources: sourceStore,
    })
    const staged = await stageResources(prepared.manifest, sourceStore, path.join(rootDir, 'staged'))
    await prepared.lease.release()
    const targetStore = new ContentAddressedResourceStore(path.join(rootDir, 'target-resources'))
    const targetDocuments = new ImageEditDocumentRepository(path.join(rootDir, 'target-documents'))

    await expect(importProjectImageEditorV3Bundle(
      extensionFor(envelope), prepared.manifest, [],
      { documents: targetDocuments, resources: targetStore },
    )).rejects.toThrow('count mismatch')
    await expect(targetDocuments.list()).resolves.toEqual([])

    const tampered = [{ ...staged[0], sha256: '0'.repeat(64) }]
    await expect(importProjectImageEditorV3Bundle(
      extensionFor(envelope), prepared.manifest, tampered,
      { documents: targetDocuments, resources: targetStore },
    )).rejects.toThrow('corrupt')
    await expect(targetStore.has(resource.id)).resolves.toBe(false)

    await expect(importProjectImageEditorV3Bundle(
      extensionFor(envelope),
      { ...prepared.manifest, resources: [
        prepared.manifest.resources[0],
        prepared.manifest.resources[0],
      ] },
      staged,
      { documents: targetDocuments, resources: targetStore },
    )).rejects.toThrow('Duplicate project image editor V3 resource')
  })

  it('第二份文档落盘失败时补偿首份文档和本次新建资源', async () => {
    const resourceBytes = Buffer.from('rollback-resource')
    const hash = crypto.createHash('sha256').update(resourceBytes).digest('hex')
    const resourceId = `sha256:${hash}` as ResourceId
    const baseDocument = createDocument('source-a', 0, [resourceId])
    const envelope = (documentId: string): ImageEditDocumentEnvelope => ({
      format: IMAGE_EDIT_DOCUMENT_FORMAT,
      formatVersion: IMAGE_EDIT_DOCUMENT_VERSION,
      documentId,
      revision: 0,
      createdAt: '2026-08-31T00:00:00.000Z',
      updatedAt: '2026-08-31T00:00:00.000Z',
      document: { ...baseDocument, id: documentId },
      resourceRefs: [resourceId],
    })
    const first = envelope('source-a')
    const second = envelope('source-b')
    const extension: ImageEditProjectPackageExtensionV3 = {
      version: 1,
      bundlePath: IMAGE_EDIT_PROJECT_PACKAGE_BUNDLE_PATH_V3,
      documents: [
        { documentRef: 'image-edit-v3:source-a', revision: 0, previewRef: null },
        { documentRef: 'image-edit-v3:source-b', revision: 0, previewRef: null },
      ],
    }
    const manifest: ProjectImageEditorV3BundleManifest = {
      bundleFormat: 'henji-project-image-edit-v3',
      bundleVersion: 1,
      documents: [
        { source: extension.documents[0], envelope: first },
        { source: extension.documents[1], envelope: second },
      ],
      resources: [{
        resourceId,
        sha256: hash,
        byteLength: resourceBytes.byteLength,
        path: `image-editor-v3/resources/${hash}`,
      }],
    }
    const stagedPath = path.join(rootDir, 'rollback.resource')
    await fsp.writeFile(stagedPath, resourceBytes)
    let writes = 0
    const documents = new ImageEditDocumentRepository(path.join(rootDir, 'target-documents'), {
      writeAtomically: async (targetPath, content) => {
        writes += 1
        if (writes === 2) throw new Error('injected second document failure')
        await fsp.mkdir(path.dirname(targetPath), { recursive: true })
        await fsp.writeFile(targetPath, content)
      },
    })
    const resources = new ContentAddressedResourceStore(path.join(rootDir, 'target-resources'))
    let nextId = 0

    await expect(importProjectImageEditorV3Bundle(extension, manifest, [{
      path: manifest.resources[0].path,
      filePath: stagedPath,
      sha256: hash,
      byteLength: resourceBytes.byteLength,
    }], {
      documents,
      resources,
      createDocumentId: () => `imported-${nextId += 1}`,
    })).rejects.toThrow('injected second document failure')

    await expect(documents.list()).resolves.toEqual([])
    await expect(resources.has(resourceId)).resolves.toBe(false)
  })
})
