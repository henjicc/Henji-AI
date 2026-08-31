import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createImageEditDocumentV3 } from '../../../src/core/imageEdit/v3/documentFactory'
import {
  IMAGE_EDIT_PROJECT_PACKAGE_BUNDLE_PATH_V3,
  IMAGE_EDIT_PROJECT_PACKAGE_EXTENSION_VERSION_V3,
} from '../../../src/core/imageEdit/v3/projectPackageContracts'
import { ContentAddressedResourceStore } from './image-editor-v3/resource-store'
import { ImageEditDocumentRepository } from './image-editor-v3/document-repository'

import {
  exportProjectPackage,
  importProjectPackage,
  importProjectMediaEntriesAtomically,
  replaceFileAtomically,
} from './project-package'

const tempDirs: string[] = []

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'henji-project-package-'))
  tempDirs.push(dir)
  return dir
}

async function* entries(values: Array<{ fileName: string; uncompressedSize: number }>) {
  for (const value of values) yield value
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('项目包原子性', () => {
  it('第二个媒体读取失败时回滚本次已导入文件', async () => {
    const importedDir = tempDir()
    const input = entries([
      { fileName: 'media/first.png', uncompressedSize: 5 },
      { fileName: 'media/broken.png', uncompressedSize: 6 },
    ])

    await expect(importProjectMediaEntriesAtomically(
      input,
      importedDir,
      async (_entry, entryName) => {
        if (entryName.endsWith('broken.png')) throw new Error('媒体条目损坏')
        return Buffer.from('first')
      },
    )).rejects.toThrow('媒体条目损坏')
    expect(fs.readdirSync(importedDir)).toEqual([])
  })

  it('总量越限时只回滚本次新建文件并保留已有同哈希文件', async () => {
    const importedDir = tempDir()
    const existingBytes = Buffer.from('existing')
    const existingName = 'afafb16ac47b9b3d.png'
    fs.writeFileSync(path.join(importedDir, existingName), existingBytes)
    const input = entries([
      { fileName: 'media/existing.png', uncompressedSize: existingBytes.length },
      { fileName: 'media/new.png', uncompressedSize: 1 },
      { fileName: 'media/overflow.png', uncompressedSize: 16 * 1024 * 1024 * 1024 },
    ])

    await expect(importProjectMediaEntriesAtomically(
      input,
      importedDir,
      async (_entry, entryName) => Buffer.from(entryName.endsWith('existing.png') ? 'existing' : 'new'),
    )).rejects.toThrow(/total media size|too large/i)
    expect(fs.readdirSync(importedDir)).toEqual([existingName])
  })

  it('导出失败不留目标半包或临时包', async () => {
    const dir = tempDir()
    const target = path.join(dir, 'project.henjiproj')

    await expect(exportProjectPackage(
      JSON.stringify({ formatVersion: 1 }),
      [{ srcPath: path.join(dir, 'missing.png'), packagePath: 'media/missing.png' }],
      target,
    )).rejects.toBeTruthy()
    expect(fs.readdirSync(dir)).toEqual([])
  })

  it('继续读取 V1 普通媒体项目包且不伪造 V3 映射', async () => {
    const dir = tempDir()
    const mediaPath = path.join(dir, 'legacy.png')
    const packagePath = path.join(dir, 'legacy.henjiproj')
    fs.writeFileSync(mediaPath, 'legacy media')
    await exportProjectPackage(
      JSON.stringify({ formatVersion: 1, nodes: [] }),
      [{ srcPath: mediaPath, packagePath: 'media/legacy.png' }],
      packagePath,
    )

    const imported = await importProjectPackage(packagePath, {
      dataRootDir: path.join(dir, 'legacy-target'),
    })
    expect(imported.imageEditReferences).toEqual([])
    expect(fs.readFileSync(imported.pathMap['media/legacy.png'], 'utf8')).toBe('legacy media')
  })

  it('跨平台替换已有目标后不保留备份或暂存文件', async () => {
    const dir = tempDir()
    const target = path.join(dir, 'project.henjiproj')
    const staged = path.join(dir, 'project.tmp')
    fs.writeFileSync(target, 'old')
    fs.writeFileSync(staged, 'new')

    await replaceFileAtomically(staged, target)

    expect(fs.readFileSync(target, 'utf8')).toBe('new')
    expect(fs.readdirSync(dir)).toEqual(['project.henjiproj'])
  })

  it('替换已有目标失败时恢复旧包且不留下半包', async () => {
    const dir = tempDir()
    const target = path.join(dir, 'project.henjiproj')
    const staged = path.join(dir, 'project.tmp')
    fs.writeFileSync(target, 'old')
    fs.writeFileSync(staged, 'new')
    let renameCount = 0

    await expect(replaceFileAtomically(staged, target, async (source, destination) => {
      renameCount += 1
      if (renameCount === 2) throw new Error('replace failed')
      await fs.promises.rename(source, destination)
    })).rejects.toThrow('replace failed')

    expect(fs.readFileSync(target, 'utf8')).toBe('old')
    expect(fs.readFileSync(staged, 'utf8')).toBe('new')
    expect(fs.readdirSync(dir).sort()).toEqual(['project.henjiproj', 'project.tmp'])
  })

  it('在两个独立数据根之间往返 V3 文档、权威资源和普通媒体', async () => {
    const dir = tempDir()
    const sourceRoot = path.join(dir, 'source-machine')
    const targetRoot = path.join(dir, 'target-machine')
    const sourceResources = new ContentAddressedResourceStore(path.join(sourceRoot, 'v3-resources'))
    const sourceDocuments = new ImageEditDocumentRepository(path.join(sourceRoot, 'v3-documents'))
    const source = await sourceResources.putBuffer(Buffer.from('source pixels'))
    const preview = await sourceResources.putBuffer(Buffer.from('preview pixels'))
    const document = {
      ...createImageEditDocumentV3({
        width: 64,
        height: 48,
        documentId: 'portable-document',
        sourceResourceId: source.id,
      }),
      revision: 3,
    }
    const envelope = await sourceDocuments.create({
      documentId: 'portable-document',
      revision: 3,
      document,
      resourceRefs: [source.id, preview.id],
      previewRef: preview.id,
    })
    const extension = {
      version: IMAGE_EDIT_PROJECT_PACKAGE_EXTENSION_VERSION_V3,
      bundlePath: IMAGE_EDIT_PROJECT_PACKAGE_BUNDLE_PATH_V3,
      documents: [{
        documentRef: 'image-edit-v3:portable-document',
        revision: 3,
        previewRef: preview.id,
      }],
    }
    const mediaPath = path.join(dir, 'ordinary.png')
    fs.writeFileSync(mediaPath, 'ordinary media')
    const packagePath = path.join(dir, 'portable.henjiproj')
    await exportProjectPackage(
      JSON.stringify({ formatVersion: 2, imageEditorV3: extension, nodes: [] }),
      [{ srcPath: mediaPath, packagePath: 'media/1-ordinary.png' }],
      packagePath,
      { imageEditorV3: { documents: sourceDocuments, resources: sourceResources } },
    )

    const targetResources = new ContentAddressedResourceStore(path.join(targetRoot, 'v3-resources'))
    const targetDocuments = new ImageEditDocumentRepository(path.join(targetRoot, 'v3-documents'))
    const imported = await importProjectPackage(packagePath, {
      dataRootDir: targetRoot,
      imageEditorV3: {
        documents: targetDocuments,
        resources: targetResources,
        createDocumentId: () => 'portable-document-imported',
      },
    })

    expect(imported.pathMap['media/1-ordinary.png']).toBeTruthy()
    expect(fs.readFileSync(imported.pathMap['media/1-ordinary.png'], 'utf8')).toBe('ordinary media')
    expect(imported.imageEditReferences).toEqual([{
      source: extension.documents[0],
      imported: {
        documentRef: 'image-edit-v3:portable-document-imported',
        revision: 3,
        previewRef: preview.id,
      },
    }])
    const restored = await targetDocuments.load('portable-document-imported')
    expect(restored.resourceRefs.sort()).toEqual(envelope.resourceRefs.sort())
    expect(await targetResources.readVerifiedBuffer(source.id, 1024)).toEqual(Buffer.from('source pixels'))
    expect(await targetResources.readVerifiedBuffer(preview.id, 1024)).toEqual(Buffer.from('preview pixels'))
  })
})
