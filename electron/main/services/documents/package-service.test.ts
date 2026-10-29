import { ZipArchive } from 'archiver'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createTestEnvironment, listFiles, type TestEnvironment } from './documents.test-support'
import { remapDocumentLinks } from './package-service'
import { videoEditExportHistorySchema } from '../../../../src/core/videoEdit/document'

let env: TestEnvironment

function write(target: string, bytes = 'x'): string {
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, bytes)
  return target
}

async function readJson(filePath: string): Promise<Record<string, unknown>> {
  return JSON.parse(await fsp.readFile(filePath, 'utf8')) as Record<string, unknown>
}

async function writeZip(target: string, entries: Record<string, string>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const output = fs.createWriteStream(target)
    const archive = new ZipArchive()
    output.on('close', resolve)
    archive.on('error', reject)
    archive.pipe(output)
    for (const [name, text] of Object.entries(entries)) archive.append(text, { name })
    archive.finalize().catch(reject)
  })
}

describe('通用单文件包（4.1）', () => {
  beforeEach(() => { env = createTestEnvironment() })
  afterEach(async () => { await env.cleanup() })

  it('项目已经发布后索引刷新失败仍返回成功，保留已导入项目', async () => {
    const { service, scanner } = env.services
    const project = await service.createProject({ name: '已发布' })
    const exported = await service.exportProjectPackage({ projectId: project.id })
    const refresh = vi.spyOn(scanner, 'refresh').mockRejectedValueOnce(new Error('EIO'))
    try {
      const imported = await service.importPackage({ source: exported.path })
      expect(imported.type).toBe('project')
      if (imported.type !== 'project') throw new Error('应为项目')
      expect(fs.existsSync(imported.project.path)).toBe(true)
      expect(imported.project.name).toBe('已发布 (2)')
    } finally { refresh.mockRestore() }
  })

  it('清单中文档缺失或无法解析时报告全部失败文件，保留原包且不发布项目', async () => {
    const source = path.join(env.outside, '不完整.hjpak')
    await writeZip(source, {
      'henji-package.json': JSON.stringify({ format: 'henji-package', version: 1, type: 'project', name: '不完整', exportedAt: '',
        folders: { generated: '生成结果', materials: '素材' }, documents: [{ id: 'missing-one', path: '缺少.hjcvs' }, { id: 'broken-one', path: '无法解析.hjcvs' }] }),
      'content/无法解析.hjcvs': '{',
    })
    const original = await fsp.readFile(source)
    await expect(env.services.service.importPackage({ source })).rejects.toThrow('缺少.hjcvs、无法解析.hjcvs')
    expect(await fsp.readFile(source)).toEqual(original)
    expect(env.catalog.listProjects()).toEqual([])
    expect(await fsp.readdir(path.join(env.workRoot, '项目'))).toEqual([])
  })

  it('单个文档：包含容器里的文件、内嵌图层包与收集进来的外部文件；导入到另一个项目时 ID 冲突换新、引用改写到新位置', async () => {
    const { service } = env.services
    const source = await service.createProject({ name: '短片' })
    const created = await service.createDocument({ kind: 'canvas', container: { kind: 'project', projectId: source.id }, name: '分镜' })
    const generated = write(path.join(source.path, '生成结果', '镜头 1.png'), 'png-1')
    const layer = write(path.join(source.path, '.henji', 'canvas-layers', 'layer-a.hjlyr'), 'layer')
    const external = write(path.join(env.outside, '参考.jpg'), 'ref')
    const missing = path.join(env.outside, '已删除.mp4')
    await service.saveDocument({
      target: { id: created.meta.id, path: created.meta.path },
      expectedRevision: 0,
      content: { nodes: [{ imageUrl: generated }, { ref: external }, { video: missing }], layerPackages: { a: layer } },
    })

    const exported = await service.exportDocumentPackage({ target: { id: created.meta.id } })
    expect(exported.path).toBe(path.join(env.workRoot, '导出', '分镜.hjpak'))
    expect(exported.missingPaths).toEqual([missing])
    // 不给位置时重名自动加序号
    const second = await service.exportDocumentPackage({ target: { id: created.meta.id } })
    expect(path.basename(second.path)).toBe('分镜 (2).hjpak')

    const target = await service.createProject({ name: '另一个' })
    const imported = await service.importPackage({ source: exported.path, container: { kind: 'project', projectId: target.id } })
    if (imported.type !== 'document') throw new Error('应为文档包')
    expect(imported.meta.id).not.toBe(created.meta.id)
    expect(imported.meta.path).toBe(path.join(target.path, '分镜.hjcvs'))
    expect(await listFiles(target.path)).toEqual([
      '.henji/canvas-layers/layer-a.hjlyr',
      '.henji/project.json',
      '分镜.hjcvs',
      '生成结果/镜头 1.png',
      '素材/参考.jpg',
    ])
    const stored = await readJson(imported.meta.path)
    expect(stored.content).toEqual({
      nodes: [{ imageUrl: 'henji:/生成结果/镜头 1.png' }, { ref: 'henji:/素材/参考.jpg' }, { video: missing }],
      layerPackages: { a: 'henji:/.henji/canvas-layers/layer-a.hjlyr' },
    })
    expect(JSON.stringify(stored)).not.toContain(env.programRoot)
    // 原文档与原文件不动
    expect(fs.readFileSync(generated, 'utf8')).toBe('png-1')
    expect((await service.readDocument({ id: created.meta.id })).meta.path).toBe(created.meta.path)
  })

  it('整个项目：导入两次得到两个项目，第二次项目与文档换新 ID、文档间引用跟着改、文件夹名加序号', async () => {
    const { service } = env.services
    const project = await service.createProject({ name: '旅行' })
    const container = { kind: 'project' as const, projectId: project.id }
    const canvas = await service.createDocument({ kind: 'canvas', container, name: '画布' })
    const other = await service.createDocument({ kind: 'canvas', container, name: '引用方' })
    const external = write(path.join(env.outside, '外部.mp4'), 'video')
    write(path.join(project.path, '自建文件夹', '笔记.txt'), 'note')
    await service.saveDocument({
      target: { id: other.meta.id },
      expectedRevision: 0,
      content: { source: { docId: canvas.meta.id, path: canvas.meta.path }, clip: external },
    })
    const exported = await service.exportProjectPackage({ projectId: project.id, destination: path.join(env.outside, '旅行') })
    expect(exported.path).toBe(path.join(env.outside, '旅行.hjpak'))

    const first = await service.importPackage({ source: exported.path })
    const again = await service.importPackage({ source: exported.path })
    if (first.type !== 'project' || again.type !== 'project') throw new Error('应为项目包')
    expect(first.project.name).toBe('旅行 (2)')
    expect(again.project.name).toBe('旅行 (3)')
    expect(new Set([project.id, first.project.id, again.project.id]).size).toBe(3)
    expect(again.documents).toBe(2)
    expect(await listFiles(again.project.path)).toEqual(['.henji/project.json', '引用方.hjcvs', '画布.hjcvs', '素材/外部.mp4', '自建文件夹/笔记.txt'])
    const documents = await service.listDocuments({ container: { kind: 'project', projectId: again.project.id } })
    expect(documents).toHaveLength(2)
    const importedCanvas = documents.find((document) => document.name === '画布')!
    const importedOther = documents.find((document) => document.name === '引用方')!
    expect(importedCanvas.id).not.toBe(canvas.meta.id)
    const read = await service.readDocument({ id: importedOther.id })
    expect(read.content).toEqual({
      source: { docId: importedCanvas.id, path: importedCanvas.path },
      clip: path.join(again.project.path, '素材', '外部.mp4'),
    })
    // 暂存文件夹不留
    expect((await fsp.readdir(path.join(env.workRoot, '项目'))).filter((name) => name.startsWith('.'))).toEqual([])
  })

  it('成片历史不作依赖：读取、收集、文档包与项目包忽略缺失成片；项目目录内现有成片仍随目录带走', async () => {
    const { service } = env.services
    const project = await service.createProject({ name: '成片历史' })
    const container = { kind: 'project' as const, projectId: project.id }
    const internal = write(path.join(project.path, '导出', '内置成片.mp4'), 'internal-output')
    const external = write(path.join(env.outside, '外部成片.mp4'), 'external-output')
    const golden = await readJson('tests/fixtures/persistence/document.video_edit/v17.json')
    const history = videoEditExportHistorySchema.parse((golden.content as Record<string, unknown>).exportHistory)
    const outputPaths = ['/persistence-project/导出/黄金.mp4', 'Z:\\缺失\\成片.mp4', path.join(project.path, '导出', '已删除.mp4'), internal, external]
    const exportHistory = outputPaths.map((output, index) => ({ ...history[0], id: `output-${index}`, path: output }))
    const edit = await service.createDocument({ kind: 'video_edit', container, name: '剪辑',
      content: { media: [], bins: [], items: [], sequences: [], exportHistory } })
    expect(edit.missingPaths).toEqual([])
    expect((await service.readDocument({ id: edit.meta.id })).missingPaths).toEqual([])
    expect(await service.collectDocumentMedia({ id: edit.meta.id })).toMatchObject({ copiedFiles: 0, missingPaths: [] })

    const single = await service.exportDocumentPackage({ target: { id: edit.meta.id } })
    expect(single.missingPaths).toEqual([])
    expect(single.files).toBe(1)
    const exported = await service.exportProjectPackage({ projectId: project.id })
    expect(exported.missingPaths).toEqual([])
    const imported = await service.importPackage({ source: exported.path })
    if (imported.type !== 'project') throw new Error('应为项目包')
    expect(await listFiles(imported.project.path)).toEqual(['.henji/project.json', '剪辑.hjvid', '导出/内置成片.mp4'])
    const document = env.catalog.listDocuments({ projectId: imported.project.id, kind: 'video_edit' })[0]
    const read = await service.readDocument({ id: document.id })
    expect(read.missingPaths).toEqual([])
    const reopened = videoEditExportHistorySchema.parse((read.content as Record<string, unknown>).exportHistory)
    expect(reopened.map(entry => entry.path)).toEqual(outputPaths.map(output => output === internal ? path.join(imported.project.path, '导出', '内置成片.mp4') : output === outputPaths[2] ? path.join(imported.project.path, '导出', '已删除.mp4') : output))
    const destination = await service.createProject({ name: '移动成片历史' })
    expect(await service.moveDocument({ target: { id: document.id }, container: { kind: 'project', projectId: destination.id } })).toMatchObject({ copiedFiles: 0, missingPaths: [] })
    expect(await listFiles(destination.path)).toEqual(['.henji/project.json', '剪辑.hjvid'])
  })

  it('成片重新作为源素材使用时仍是依赖，Windows 与 POSIX 缺失源素材均如实报告', async () => {
    const { service } = env.services
    const project = await service.createProject({ name: '成片复用' })
    const golden = await readJson('tests/fixtures/persistence/document.video_edit/v17.json')
    const history = videoEditExportHistorySchema.parse((golden.content as Record<string, unknown>).exportHistory)
    const missing = ['/persistence-project/导出/黄金.mp4', 'Z:\\缺失\\成片.mp4']
    const source = write(path.join(env.outside, '复用成片.mp4'), 'source-output')
    const edit = await service.createDocument({ kind: 'video_edit', container: { kind: 'project', projectId: project.id }, name: '复用剪辑',
      content: { media: [...missing, source].map((file, index) => ({ id: `media-${index}`, path: file })), bins: [], items: [], sequences: [],
        exportHistory: [...missing, source].map((file, index) => ({ ...history[0], id: `output-${index}`, path: file })) } })
    // 读取会并发 stat，本机与异平台路径的完成顺序可以不同。
    expect([...edit.missingPaths].sort()).toEqual([...missing].sort())
    expect((await service.readDocument({ id: edit.meta.id })).missingPaths.sort()).toEqual([...missing].sort())
    const exported = await service.exportProjectPackage({ projectId: project.id })
    expect(exported.missingPaths).toEqual(missing)
    const imported = await service.importPackage({ source: exported.path })
    if (imported.type !== 'project') throw new Error('应为项目包')
    expect(await listFiles(imported.project.path)).toContain('素材/复用成片.mp4')
    expect((await service.collectDocumentMedia({ id: edit.meta.id })).missingPaths).toEqual(missing)
  })

  it('不安全或无法识别的包：拒绝且不留暂存', async () => {
    const unsafe = path.join(env.outside, '坏包.hjpak')
    await writeZip(unsafe, {
      'henji-package.json': JSON.stringify({ format: 'henji-package', version: 1, type: 'project', name: '坏', exportedAt: '', folders: { generated: '生成结果', materials: '素材' }, documents: [] }),
      'content/../逃逸.txt': 'x',
    })
    await expect(env.services.service.importPackage({ source: unsafe })).rejects.toMatchObject({ name: 'DocumentFormatError' })
    expect(fs.existsSync(path.join(env.workRoot, '逃逸.txt'))).toBe(false)
    expect((await fsp.readdir(path.join(env.workRoot, '项目')))).toEqual([])

    const newer = path.join(env.outside, '新版本.hjpak')
    await writeZip(newer, { 'henji-package.json': JSON.stringify({ format: 'henji-package', version: 9 }) })
    await expect(env.services.service.importPackage({ source: newer })).rejects.toThrow('更新版本')
    const notPackage = write(path.join(env.outside, '随便.hjpak'), 'not a zip')
    await expect(env.services.service.importPackage({ source: notPackage })).rejects.toMatchObject({ name: 'DocumentFormatError' })
  })

  it('剪辑文档包可导入作品目录并按独立文档读取', async () => {
    const project = await env.services.service.createProject({ name: '剪辑项目' })
    const edit = await env.services.service.createDocument({ kind: 'video_edit', container: { kind: 'project', projectId: project.id }, name: '主剪辑' })
    const exported = await env.services.service.exportDocumentPackage({ target: { id: edit.meta.id } })
    const result = await env.services.service.importPackage({ source: exported.path })
    expect(result.type).toBe('document')
    if (result.type === 'document') expect(result.meta.container).toEqual({ kind: 'user' })
  })

  it('复制进另一个容器（复制进本项目）：新 ID、素材一并复制', async () => {
    const { service } = env.services
    const standalone = await service.createDocument({ kind: 'canvas', container: { kind: 'user' }, name: '独立画布' })
    const generated = write(path.join(env.workRoot, '生成结果', 'a.png'), 'a')
    await service.saveDocument({ target: { id: standalone.meta.id }, expectedRevision: 0, content: { image: generated } })
    const project = await service.createProject({ name: '收纳' })
    const copied = await service.duplicateDocument({ target: { id: standalone.meta.id }, container: { kind: 'project', projectId: project.id }, onConflict: 'keepBoth' })
    expect(copied.meta.id).not.toBe(standalone.meta.id)
    expect(copied.meta.container).toEqual({ kind: 'project', projectId: project.id })
    expect(copied.copiedFiles).toBe(1)
    expect((await service.readDocument({ id: copied.meta.id })).content).toEqual({ image: path.join(project.path, '生成结果', 'a.png') })
    expect((await service.readDocument({ id: standalone.meta.id })).content).toEqual({ image: generated })
  })

  it('改写文档间引用只动 { docId, path } 形状里的 docId', () => {
    const idMap = new Map([['old', 'new']])
    const content = { a: { docId: 'old', path: '/x' }, b: { docId: 'old' }, c: ['old', { docId: 'other', path: '/y' }] }
    expect(remapDocumentLinks(content, idMap)).toEqual({ a: { docId: 'new', path: '/x' }, b: { docId: 'old' }, c: ['old', { docId: 'other', path: '/y' }] })
    const untouched = { d: 1 }
    expect(remapDocumentLinks(untouched, idMap)).toBe(untouched)
  })
})
