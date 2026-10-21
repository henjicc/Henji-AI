import baseline from '../../../../src/core/persistence/schemaBaseline.json'
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
import ts from 'typescript'
import { videoEditDocumentSchema } from '../../../../src/core/videoEdit/document'
import { CANVAS_LAYER_PACKAGE_VERSION, IMAGE_PACKAGE_VERSION, IMAGE_WORKING_VERSION, VIDEO_EDIT_DOCUMENT_VERSION, VIDEO_EDIT_CONTENT_VERSION } from '../../../../src/core/persistence/schemaVersions'
import { ImageEditCommandHistoryV3 } from '../../../../src/core/imageEdit/v3/commandHistory'
import type { ImageEditDocumentV3 } from '../../../../src/core/imageEdit/v3/documentTypes'

let environment: TestEnvironment | undefined
afterEach(async () => { await environment?.cleanup(); environment = undefined })
const fixture = (id: string, file: string): string => path.resolve('tests/fixtures/persistence', id, file)

const supported = (id: keyof typeof baseline.formats): number[] => {
  const { supportedFrom, version } = baseline.formats[id]
  return process.env.HENJI_TEST_PERSISTENCE_RELEASE === '1' ? Array.from({ length: version - supportedFrom + 1 }, (_, i) => supportedFrom + i) : [version]
}
const imageArchives = [
  ...['document.image_document', 'image-package'].flatMap(id => supported('image-package').map(version => [id, `v${version}.henjiimg`] as const)),
  ...supported('canvas-layer-package').map(version => ['canvas-layer-package', `v${version}.henjilayer`] as const),
]

describe('正式读入口打开黄金归档与源码', () => {
  it.each(imageArchives)('%s/%s 通过真实ZIP读取，保留图层与文档头，不改写原件', async (id, file) => {
    environment = createTestEnvironment()
    const codec = new HenjiImagePackageCodec(new ContentAddressedResourceStore(path.join(environment.outside, 'resources')))

      const source = fixture(id, file)
      const original = await fsp.readFile(source)
      const imported = await codec.import(source)
      try {
        const { history: _runtimeHistory, ...persisted } = imported.manifest.document
        expect(imageWorkingCopySchema.safeParse(persisted).success).toBe(true)
        expect(imported.manifest.packageVersion).toBe(IMAGE_PACKAGE_VERSION)
        expect(imported.manifest.document.formatVersion).toBe(IMAGE_WORKING_VERSION)
        expect(imported.manifest.document.historyCheckpoint).toMatchObject({ total: 6, position: 5 })
        expect(imported.manifest.document.history?.redo).toHaveLength(1)
        const history = new ImageEditCommandHistoryV3()
        const document = imported.manifest.document.document as ImageEditDocumentV3
        expect(document.namedRegions.find(region => region.id === 'golden-outside')?.selection.operations[0].shape).toMatchObject({ type: 'rectangle', x: -.4, y: 1.1, width: 1.5 });
        history.restore(document, imported.manifest.document.history)
        const redone = history.redo(document).document
        expect(redone.layers[0].opacity).toBe(.5)
        expect(history.undo(history.undo(history.undo(redone).document).document).document.layers[0].opacity).toBe(1)
        const layers = (imported.manifest.document.document as { layers: Array<{ id: string; type: string; adjustmentId?: string }> }).layers
        expect(layers[0]).toMatchObject({ id: 'golden-layer', type: 'smart', deformation: {kind:'perspective',points:[[.1,0],[.9,0],[1,1],[0,1]]}, fillOpacity: .7, maskAttachment: { linked: false, density: .6 }, filters: [{ effectId: 'exposure', params: { stops: .4 } }] })
        expect(layers).toHaveLength(5)
        expect(layers[4]).toMatchObject({ type: 'smart', content: { document: { layers: [{ type: 'raster' }] } } })
        expect(document.namedRegions).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'golden-region', name: '主体', selection: expect.objectContaining({ feather: .02 }) })]))
        const floatShape = document.namedRegions.find(region => region.id === 'golden-float32')!.selection.operations[0].shape
        expect(floatShape).toMatchObject({ type: 'mask', runs: [[0, 1, Math.fround(.123456789)], [1, 1, Math.fround(.50000006)], [2, 1, 1]] })
        expect(imported.manifest.document.history?.undo[0].forward.type).toBe('document.set-canvas-size')
        expect(imported.manifest.document.history?.undo[2].forward.type).toBe('document.atomic')
        expect(layers[1]).toMatchObject({ type: 'adjustment', adjustmentId: 'color_grade' })
        expect(layers[2]).toMatchObject({ type: 'effect', effectId: 'gaussian_blur' })
        expect(layers[3]).toMatchObject({ type:'shape', content:{operands:[{operation:'replace'}]} })
        expect(imported.manifest.document.document).toMatchObject({ geometry: { orientation: { rotate: 90, mirrored: true }, crop: { x: 1, y: 2, width: 32, height: 40 } } })
        expect(imported.documentHeader).toBeDefined()
        const header: unknown = JSON.parse(imported.documentHeader!.toString('utf8'))
        expect(header).toMatchObject(id === 'canvas-layer-package'
          ? { format: 'henji-canvas-layer', version: CANVAS_LAYER_PACKAGE_VERSION, documentId: 'golden-image' }
          : { format: 'henji-image-document', version: 1, id: 'golden-image', summary: { width: 32, height: 40, layers: 5 } })
      } finally { await imported.resourceLease.release() }
      expect(await fsp.readFile(source)).toEqual(original)
  })
  it.each(supported('image-package'))('图片头 v%s 走真实归档入口', async version => {
    expect((await readImageDocumentPackageHeader(fixture('image-header', `v${version}.henjiimg`))).header).toMatchObject({ id: 'golden-image', kindVersion: 1, summary: { width: 32, height: 40, layers: 5 } })
  })
  it('开发期放弃的旧图片与画布图层 ZIP 明确拒绝为旧版本，不改写原件', async () => {
    environment = createTestEnvironment()
    const codec = new HenjiImagePackageCodec(new ContentAddressedResourceStore(path.join(environment.outside, 'resources')))
    for (const [id, file] of [['document.image_document', 'v1.henjiimg'], ['image-package', 'v1.henjiimg'], ['canvas-layer-package', 'v1.henjilayer']]) {
      const source = fixture(id, file)
      const original = await fsp.readFile(source)
      await expect(codec.import(source)).rejects.toMatchObject({ code: 'unsupported-version', formatId: 'image-package', fromVersion: 1 })
      expect(await fsp.readFile(source)).toEqual(original)
    }
  })
  it.each(supported('project-package'))('真实项目包 v%s 导入后剪辑内容和代码文件可读，保留效果、字幕与调色', async version => {
    environment = createTestEnvironment()
    // The archive envelope and its editable documents have independent format versions.
    const source = fixture('project-package', `v${version}-video-v${VIDEO_EDIT_CONTENT_VERSION}.henjipack`)
    const original = await fsp.readFile(source)
    const imported = await environment.services.service.importPackage({ source })
    if (imported.type !== 'project') throw new Error('应为项目包')
    const document = environment.catalog.listDocuments({ projectId: imported.project.id, kind: 'video_edit' })[0]
    const read = await environment.services.service.readDocument({ id: document.id })
    // 归档可读还必须能进入剪辑的完整 schema，不能只通过主进程的外层校验。
    const parsed = videoEditDocumentSchema.parse({ format: 'henji-video-project', version: VIDEO_EDIT_DOCUMENT_VERSION, id: read.meta.id, name: read.meta.name, revision: read.meta.revision, ...(read.content as object) })
    expect(parsed.sequences[0].clips.find(clip => clip.kind === 'code')).toMatchObject({ effects: [{ builtin: { id: 'color_grade' } }, { builtin: { id: 'gaussian_blur' } }], contentAnchor: { ranges: [{ clipId: 'golden-sound-clip', itemId: 'golden-sound-item' }] } })
    expect(parsed.sequences[0].captions).toMatchObject([{ translation: 'Golden caption', speech: { words: [
      { clipId: 'golden-sound-clip', text: '字幕', startUs: 166667, endUs: 700000 },
      { clipId: 'golden-sound-clip', text: '原文', startUs: 700000, endUs: 1500000 },
    ] } }])
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
    const exports: { default?: Record<string, unknown> } = {}
    new Function('exports', ts.transpileModule(await fsp.readFile(fixture('code-version', 'v1.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(exports)
    expect(exports.default).toMatchObject({ mode: 'dynamic', width: 1920, height: 1080 })
  })
  it('正式PNG元数据编码器生成版本化描述，原公开DTO不暴露内部版本', async () => {
    expect(readStoryboardMetadataFromPng(await fsp.readFile(fixture('storyboard-metadata', 'v1.png')))).toEqual({ gridRows: 2, gridCols: 2, frameNotes: ['远景', '特写'] })
  })
})
