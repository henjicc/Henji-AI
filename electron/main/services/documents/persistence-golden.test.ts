import fsp from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { componentSourceMetadata } from '../../../../src/core/videoEdit/codeMaterial/components'
import { createHash } from 'node:crypto'
const codeSourceHash = (source: string): string => createHash('sha256').update(source).digest('hex')
import { createTestEnvironment, type TestEnvironment } from './documents.test-support'
import { HenjiImagePackageCodec } from '../image-editor-v3/package-codec'
import { ContentAddressedResourceStore } from '../image-editor-v3/resource-store'
import { readImageDocumentPackageHeader } from '../image-editor-v3/image-document/package-file'
import { imageWorkingCopySchema } from '../../../../src/core/persistence/imageSchemas'
import { readStoryboardMetadataFromPng } from '../image/png-metadata'
import { compileCodeMaterial } from '../../../../src/core/videoEdit/codeMaterial/compiler'

let environment: TestEnvironment | undefined
afterEach(async () => { await environment?.cleanup(); environment = undefined })
const fixture = (id: string, file: string): string => path.resolve('tests/fixtures/persistence', id, file)

describe('正式读入口打开黄金归档与源码', () => {
  it('图片文档和画布图层包通过真实ZIP读取，保留图层与文档头，不改写原件', async () => {
    environment = createTestEnvironment()
    const codec = new HenjiImagePackageCodec(new ContentAddressedResourceStore(path.join(environment.outside, 'resources')))
    for (const [id, file] of [['document.image_document', 'v1.henjiimg'], ['image-package', 'v1.henjiimg'], ['canvas-layer-package', 'v1.henjilayer']]) {
      const source = fixture(id, file)
      const original = await fsp.readFile(source)
      const imported = await codec.import(source)
      try {
        expect(imageWorkingCopySchema.safeParse(imported.manifest.document).success).toBe(true)
        const layers = (imported.manifest.document.document as { layers: Array<{ id: string; type: string; adjustmentId?: string }> }).layers
        expect(layers[0]).toMatchObject({ id: 'golden-layer', type: 'raster' })
        expect(layers).toHaveLength(4)
        expect(layers[1]).toMatchObject({ type: 'adjustment', adjustmentId: 'color_grade' })
        expect(layers[2]).toMatchObject({ type: 'effect', effectId: 'gaussian_blur' })
        expect(layers[3]).toMatchObject({ type: 'annotation', annotations: [{ id: 'golden-mark' }] })
        expect(imported.manifest.document.document).toMatchObject({ geometry: { orientation: { rotate: 90, mirrored: true }, crop: { x: 1, y: 2, width: 32, height: 40 } } })
        expect(imported.documentHeader).toBeDefined()
      } finally { await imported.resourceLease.release() }
      expect(await fsp.readFile(source)).toEqual(original)
    }
    expect((await readImageDocumentPackageHeader(fixture('image-header', 'v1.henjiimg'))).header).toMatchObject({ id: 'golden-image', kindVersion: 1, summary: { width: 32, height: 40, layers: 4 } })
  })
  it('真实项目包导入后剪辑内容和代码文件可读，保留效果、字幕与调色', async () => {
    environment = createTestEnvironment()
    const source = fixture('project-package', 'v1.henjipack')
    const original = await fsp.readFile(source)
    const imported = await environment.services.service.importPackage({ source })
    if (imported.type !== 'project') throw new Error('应为项目包')
    const document = environment.catalog.listDocuments({ projectId: imported.project.id, kind: 'video_edit' })[0]
    const read = await environment.services.service.readDocument({ id: document.id })
    expect(read.content).toMatchObject({ sequences: [{ clips: [{ effects: [{ builtin: { id: 'color_grade' } }, { builtin: { id: 'gaussian_blur' } }] }], captions: [{ translation: 'Golden caption' }] }] })
    const code = read.content as { codeMaterials: { versions: { files: { location: string; hash: string }[] }[] }[] }
    const file = code.codeMaterials[0].versions[0].files[0]
    expect(codeSourceHash(await fsp.readFile(file.location, 'utf8'))).toBe(file.hash)
    expect(await fsp.readFile(source)).toEqual(original)
  })
  it('组件说明头与源码版本来自正式打包函数且源码摘要一致', async () => {
    const component = componentSourceMetadata(await fsp.readFile(fixture('code-component', 'v1.ts'), 'utf8'))
    expect(component.metadata).toMatchObject({ schemaVersion: 1, name: '组件', exports: ['value'] })
    const version = JSON.parse(await fsp.readFile(fixture('code-version', 'v1.json'), 'utf8')) as { files: { hash: string }[] }
    expect(codeSourceHash(await fsp.readFile(fixture('code-version', 'v1.ts'), 'utf8'))).toBe(version.files[0].hash)
    expect(compileCodeMaterial(await fsp.readFile(fixture('code-version', 'v1.ts'), 'utf8'))).toMatchObject({ mode: 'dynamic', width: 1920, height: 1080 })
  })
  it('正式PNG元数据编码器生成版本化描述，原公开DTO不暴露内部版本', async () => {
    expect(readStoryboardMetadataFromPng(await fsp.readFile(fixture('storyboard-metadata', 'v1.png')))).toEqual({ gridRows: 2, gridCols: 2, frameNotes: ['远景', '特写'] })
  })
})
