import fsp from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../appPaths', () => ({ getUserFolderDir: () => '/unused' }))

import { createWebRecordingDocumentAdapter } from '../web-replay/document-adapter'
import { createTestEnvironment, listFiles, type TestEnvironment } from './documents.test-support'
import { createPackageAdapterRegistry } from './package-adapters'

/*
 * 文件夹类型文档（网页录制 `.hjweb`）：作品索引认领文件夹本身、不往里找；改名与移动按文件夹处理，
 * 头信息（ID、标题）写在里面的 recording.json。
 */

let env: TestEnvironment
const ID = '00000000-0000-4000-8000-0000000000b1'

function manifest(id = ID, title?: string): Record<string, unknown> {
  return {
    version: 3, minReaderVersion: 1, id, status: 'complete', createdAt: '2026-10-24T00:00:00.000Z', ...(title ? { title } : {}),
    app: { name: '知多少', version: '0.1.0' }, probe: { version: '0.1.0', protocol: 1 }, host: 'tauri',
    env: { url: 'http://tauri.localhost/', viewport: { width: 1280, height: 821, dpr: 1.75 }, colorScheme: 'light', reducedMotion: false, locale: 'zh-CN', timeZone: 'Asia/Shanghai', userAgent: 'test' },
    wallAtZeroMs: 1, durationUs: 5_000_000, clock: null, fonts: [], warnings: [],
  }
}

async function writeRecording(directory: string, value = manifest()): Promise<void> {
  await fsp.mkdir(path.join(directory, 'blobs'), { recursive: true })
  await fsp.writeFile(path.join(directory, 'recording.json'), JSON.stringify(value))
  // A file inside that happens to carry a document extension must not be picked up as a second document.
  await fsp.writeFile(path.join(directory, 'blobs', 'nested.hjcvs'), '{}')
}

describe('文件夹类型文档（.hjweb）', () => {
  beforeEach(() => { env = createTestEnvironment({ adapters: createPackageAdapterRegistry([createWebRecordingDocumentAdapter()]) }) })
  afterEach(async () => { await env.cleanup() })

  it('扫描认领 .hjweb 文件夹为一份文档，不把里面的文件当文档；列表摘要来自 recording.json', async () => {
    const { service, workspace } = env.services
    const project = await service.createProject({ name: '元宝搜索' })
    const root = workspace.catalog.getProject(project.id)!.path
    const directory = path.join(root, '素材', '录屏', '02-交换机.hjweb')
    await writeRecording(directory)
    await service.refreshIndex()
    const listed = await service.listDocuments({ kind: 'web_recording' })
    expect(listed.map(document => [document.id, document.name, document.path, document.summary])).toEqual([[ID, '02-交换机', directory, { durationMs: 5000, status: 'complete', app: '知多少' }]])
    expect((await service.listDocuments({ kind: 'canvas' })).length).toBe(0)
  })

  it('项目里有网页录制时，代码素材写入失败后的补偿照常回收源码（文件夹文档不参与引用检查）', async () => {
    const { service, workspace } = env.services
    const project = await service.createProject({ name: '元宝搜索' })
    const root = workspace.catalog.getProject(project.id)!.path
    await writeRecording(path.join(root, '素材', '录屏', '08-生成总结.hjweb'))
    await service.refreshIndex()
    const edit = await service.createDocument({ kind: 'video_edit', container: { kind: 'project', projectId: project.id }, name: '剪辑' })
    const written = await service.writeCodeVersion({ target: { id: edit.meta.id }, definitionId: 'card', name: '花字卡片', contents: { entry: 'main.ts', files: { 'main.ts': 'export default {}' } } })
    await expect(service.discardCodeFiles({ files: written.files, retainedLocations: [] })).resolves.toBeUndefined()
    await expect(fsp.stat(written.files[0].location)).rejects.toThrow()
  })

  it('有文档读不了（旧格式、文件丢失）时补偿不失败，也不删任何代码文件', async () => {
    const { service, workspace } = env.services
    const project = await service.createProject({ name: '元宝搜索' })
    const edit = await service.createDocument({ kind: 'video_edit', container: { kind: 'project', projectId: project.id }, name: '剪辑' })
    const other = await service.createDocument({ kind: 'video_edit', container: { kind: 'project', projectId: project.id }, name: '旧剪辑' })
    await fsp.writeFile(workspace.catalog.getDocument(other.meta.id)!.path, '{"broken":')
    const written = await service.writeCodeVersion({ target: { id: edit.meta.id }, definitionId: 'card', name: '花字卡片', contents: { entry: 'main.ts', files: { 'main.ts': 'export default {}' } } })
    await expect(service.discardCodeFiles({ files: written.files, retainedLocations: [] })).resolves.toBeUndefined()
    // 源码在 Git 提交里：仍能按原引用读回原文
    await expect(service.readCodeFile(written.files[0])).resolves.toBe('export default {}')
  })

  it('新建位置落在 素材/录屏/ 并按“保留两者”起名；写完头信息后登记进索引', async () => {
    const { service, workspace } = env.services
    const project = await service.createProject({ name: '元宝搜索' })
    const first = await service.createFolderDocumentLocation({ kind: 'web_recording', container: { kind: 'project', projectId: project.id }, name: '开头演示' })
    const second = await service.createFolderDocumentLocation({ kind: 'web_recording', container: { kind: 'project', projectId: project.id }, name: '开头演示' })
    const root = workspace.catalog.getProject(project.id)!.path
    expect(first.path).toBe(path.join(root, '素材', '录屏', '开头演示.hjweb'))
    expect(second.name).not.toBe(first.name)
    await writeRecording(first.path, manifest(ID, first.name))
    const meta = await service.indexDocumentAt(first.path)
    expect(meta).toMatchObject({ id: ID, kind: 'web_recording', name: '开头演示', container: { kind: 'project', projectId: project.id } })
    await expect(service.createFolderDocumentLocation({ kind: 'web_recording', container: { kind: 'user' }, name: 'x' })).resolves.toMatchObject({ path: path.join(env.workRoot, '网页录制', 'x.hjweb') })
  })

  it('改名移动整个文件夹并把标题写进 recording.json；里面的文件原样保留', async () => {
    const { service, workspace } = env.services
    const project = await service.createProject({ name: '元宝搜索' })
    const root = workspace.catalog.getProject(project.id)!.path
    const directory = path.join(root, '素材', '录屏', '旧名.hjweb')
    await writeRecording(directory, manifest(ID, '旧名'))
    await service.indexDocumentAt(directory)
    const renamed = await service.renameDocument({ target: { id: ID }, name: '新名' })
    const target = path.join(root, '素材', '录屏', '新名.hjweb')
    expect(renamed.path).toBe(target)
    const files = await listFiles(target)
    expect(files.filter(file => !file.startsWith('.henji/'))).toEqual(['blobs/nested.hjcvs', 'recording.json'])
    const backup = files.find(file => file.startsWith('.henji/backups/recording.json.v3.'))!
    expect(JSON.parse(await fsp.readFile(path.join(target, backup), 'utf8'))).toEqual(manifest(ID, '旧名'))
    expect(JSON.parse(await fsp.readFile(path.join(target, 'recording.json'), 'utf8'))).toMatchObject({ id: ID, title: '新名' })
    await expect(fsp.access(directory)).rejects.toThrow()
  })

  it('网页录制经工程包、文档包及外部工程进入时覆盖包内来源标记', async () => {
    const { service } = env.services
    vi.spyOn(env.services.workspace, 'randomId').mockImplementation(randomUUID)
    const project = await service.createProject({ name: '录制工程' })
    const directory = path.join(project.path, '素材', '录屏', '演示.hjweb')
    await writeRecording(directory)
    await service.refreshIndex()
    const documentPackage = await service.exportDocumentPackage({ target: { id: ID }, destination: path.join(env.outside, '录制文档包') })
    const projectPackage = await service.exportProjectPackage({ projectId: project.id, destination: path.join(env.outside, '录制工程包') })
    const refresh = vi.spyOn(env.services.scanner, 'refresh').mockRejectedValueOnce(new Error('索引暂不可用'))
    const importedProject = await service.importPackage({ source: projectPackage.path })
    if (importedProject.type !== 'project') throw new Error('应为工程包')
    const stagedRecording = path.join(importedProject.project.path, '素材', '录屏', '演示.hjweb', 'recording.json')
    expect(JSON.parse(await fsp.readFile(stagedRecording, 'utf8'))).toMatchObject({ version: 4, foreign: { sourceType: 'project' } })
    refresh.mockRestore()
    await service.refreshIndex()
    const recording = (await service.listDocuments({ kind: 'web_recording', container: { kind: 'project', projectId: importedProject.project.id } }))[0]
    expect(JSON.parse(await fsp.readFile(path.join(recording.path, 'recording.json'), 'utf8')).foreign).toMatchObject({ sourceType: 'project' })
    const importedDocument = await service.importPackage({ source: documentPackage.path, container: { kind: 'project', projectId: project.id } })
    if (importedDocument.type !== 'document') throw new Error('应为文档包')
    expect(JSON.parse(await fsp.readFile(path.join(importedDocument.meta.path, 'recording.json'), 'utf8')).foreign).toMatchObject({ sourceType: 'document_package', id: importedDocument.meta.id })
    const externalPath = path.join(env.outside, '外部工程')
    await fsp.cp(project.path, externalPath, { recursive: true })
    const external = await service.registerExternalProject(externalPath)
    for (const row of await service.listDocuments({ kind: 'web_recording', container: { kind: 'project', projectId: external.id } })) {
      expect(JSON.parse(await fsp.readFile(path.join(row.path, 'recording.json'), 'utf8')).foreign).toMatchObject({ sourceType: 'project', id: external.id })
    }
  })

  it('兼容读取的新清单写头时保留版本及未知字段', async () => {
    const directory = path.join(env.outside, '较新录制.hjweb')
    await writeRecording(directory, { ...manifest(), version: 5, futureField: { retained: true } })
    await createWebRecordingDocumentAdapter().writeHeader(directory, { foreign: { id: ID, sourceName: '较新录制', sourceType: 'web_recording' } })
    expect(JSON.parse(await fsp.readFile(path.join(directory, 'recording.json'), 'utf8'))).toMatchObject({ version: 5, futureField: { retained: true }, foreign: { id: ID } })
  })
})
