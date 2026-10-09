import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createTestEnvironment } from '../electron/main/services/documents/documents.test-support'
import { HenjiImagePackageCodec } from '../electron/main/services/image-editor-v3/package-codec'
import { ContentAddressedResourceStore } from '../electron/main/services/image-editor-v3/resource-store'
import { validateImageEditDocumentEnvelope } from '../electron/main/services/image-editor-v3/document-repository'
import { parseImageDocumentHeader, serializeImageDocumentHeader } from '../electron/main/services/image-editor-v3/image-document/header'
import { packageComponentSource, type CodeComponentMetadata } from '../src/core/videoEdit/codeMaterial/components'
import { parseDocumentText } from '../src/core/documents/envelope'
import { encodePngWithStoryboardMetadata } from '../electron/main/services/image/png-metadata'
import { loadSharp } from '../electron/main/services/image/sharp-loader'
import { IMAGE_HEADER_VERSION, IMAGE_PACKAGE_VERSION, IMAGE_WORKING_VERSION, CANVAS_LAYER_PACKAGE_VERSION } from '../src/core/persistence/schemaVersions'

/** Archive filenames follow the embedded package version, independently of header/kind versions. */
export async function generateImagePersistencePackages(root = process.cwd()): Promise<void> {
  const fixture = (id: string, file: string): string => path.join(root, 'tests/fixtures/persistence', id, file)
  const read = async (id: string, version: number): Promise<unknown> => JSON.parse(await fsp.readFile(fixture(id, `v${version}.json`), 'utf8')) as unknown
  const resources = await fsp.mkdtemp(path.join(os.tmpdir(), 'henji-persistence-resources-'))
  try {
    const codec = new HenjiImagePackageCodec(new ContentAddressedResourceStore(resources))
    const working = validateImageEditDocumentEnvelope(await read('image-working-copy', IMAGE_WORKING_VERSION))
    const header = serializeImageDocumentHeader(parseImageDocumentHeader(await read('image-header', IMAGE_HEADER_VERSION)))
    const image = path.join(resources, '黄金图片.henjiimg')
    await codec.export({ targetPath: image, document: working, documentHeader: header, now: new Date('2026-10-09T00:00:00.000Z') })
    for (const id of ['document.image_document', 'image-package', 'image-header']) {
      await fsp.copyFile(image, fixture(id, `v${IMAGE_PACKAGE_VERSION}.henjiimg`), fs.constants.COPYFILE_EXCL)
    }
    const layer = path.join(resources, '黄金图层.henjilayer')
    await codec.export({ targetPath: layer, document: working, documentHeader: JSON.stringify(await read('canvas-layer-package', CANVAS_LAYER_PACKAGE_VERSION)), now: new Date('2026-10-09T00:00:00.000Z') })
    await fsp.copyFile(layer, fixture('canvas-layer-package', `v${CANVAS_LAYER_PACKAGE_VERSION}.henjilayer`), fs.constants.COPYFILE_EXCL)
  } finally { await fsp.rm(resources, { recursive: true, force: true }) }
}

/** Explicit authoring only. Current formal exporters generate archives; existing goldens never change. */
export async function generatePersistencePackages(root = process.cwd(), only?: 'project-package', projectTarget?: string): Promise<void> {
  const fixture = (id: string, file = 'v1.json'): string => path.join(root, 'tests/fixtures/persistence', id, file)
  const read = (id: string, file?: string): unknown => JSON.parse(fs.readFileSync(fixture(id, file), 'utf8')) as unknown
  const env = createTestEnvironment()
  try {
    if (!only) {
      await generateImagePersistencePackages(root)
    }
    const code = read('code-asset') as { codeSources: { source: string }[] }
    const source = code.codeSources[0].source
    if (!only) await fsp.writeFile(fixture('code-version', 'v1.ts'), source, { flag: 'wx' })
    if (!only) await fsp.writeFile(fixture('code-component', 'v1.ts'), packageComponentSource('export const value = 1;\n', read('code-component') as CodeComponentMetadata), { flag: 'wx' })
    const { service } = env.services
    const project = await service.createProject({ name: '黄金项目' })
    const created = await service.createDocument({ kind: 'video_edit', container: { kind: 'project', projectId: project.id }, name: '黄金剪辑' })
    const current = await service.readDocument({ id: created.meta.id })
    const golden = parseDocumentText(fs.readFileSync(fixture('document.video_edit'), 'utf8')).content as { codeMaterials: { versions: { files: { location: string }[] }[] }[] }
    const location = path.join(project.path, '代码', '标题', 'v1', 'main.ts')
    await fsp.mkdir(path.dirname(location), { recursive: true })
    await fsp.writeFile(location, source)
    golden.codeMaterials[0].versions[0].files[0].location = location
    await service.saveDocument({ target: { id: current.meta.id }, expectedRevision: current.meta.revision, content: golden })
    const exported = await service.exportProjectPackage({ projectId: project.id })
    await fsp.copyFile(exported.path, projectTarget ?? fixture('project-package', 'v1.henjipack'), fs.constants.COPYFILE_EXCL)
  } finally { await env.cleanup() }
}

export async function generateStoryboardGolden(root = process.cwd()): Promise<void> {
  const directory = path.join(root, 'tests/fixtures/persistence/storyboard-metadata')
  const metadata = JSON.parse(await fsp.readFile(path.join(directory, 'v1.json'), 'utf8')) as { gridRows: number; gridCols: number; frameNotes: string[] }
  const sharp = await loadSharp()
  const image = await sharp(Buffer.alloc(16), { raw: { width: 2, height: 2, channels: 4 } }).png().toBuffer()
  const bytes = await encodePngWithStoryboardMetadata(image, metadata)
  await fsp.writeFile(path.join(directory, 'v1.png'), bytes, { flag: 'wx' })
}
