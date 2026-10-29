import { parseGitCodeLocation } from '../../../../src/core/storage/gitCodeLocation'
import { CodeGitRepository } from './code-git'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestEnvironment, type TestEnvironment } from './documents.test-support'

let env: TestEnvironment
beforeEach(() => { env = createTestEnvironment() })
afterEach(async () => { await env.cleanup() })
async function setup() {
  const service = env.services.service; const project = await service.createProject({ name: '代码项目' })
  const document = await service.createDocument({ kind: 'video_edit', container: { kind: 'project', projectId: project.id }, name: '剪辑' })
  const target = { id: document.meta.id }
  const write = (definitionId = 'definition', name = '霓虹/标题') => service.writeCodeVersion({ target, definitionId, name, contents: { entry: 'main.ts', files: { 'main.ts': 'export default {}', 'parts/card.ts': 'export const width=20' } } })
  return { service, project, document, target, write }
}
const worktreePath = (location: string) => { const reference = parseGitCodeLocation(location)!; return path.join(reference.repository, reference.filepath) }
it('工程闭包跨项目收集、单文档包和整项目包带齐源码并重写 project 提交', async () => {
  const { service, target, project } = await setup()
  const sources = { 'entries/a.ts': 'export { value } from "../style/tokens"; import "../style/desk.wgsl"', 'style/tokens.ts': 'export const value=1', 'style/desk.wgsl': 'fn desk() {}', 'README.md': '不属于闭包的作者说明' }
  const commit = await service.changeCodeProject({ target, message: '作者源码树', changes: Object.entries(sources).map(([path, source]) => ({ path, source, expectedHash: null })) })
  const closure = await service.resolveCodeProject({ target, entry: 'entries/a.ts' })
  const content = { media: [], bins: [], items: [], sequences: [], codeMaterials: [{ id: 'project-material', versions: [{ id: 'v1', entry: closure.entry, files: closure.files, imports: [], project: { commit, entry: closure.entry } }] }] }
  await service.saveDocument({ target, expectedRevision: 0, content })
  const verify = async (id: string) => {
    const read = await service.readDocument({ id }); expect(read.missingPaths).toEqual([])
    const version = (read.content as typeof content).codeMaterials[0].versions[0]
    expect(version.files.map(file => file.path)).toEqual(['entries/a.ts', 'style/desk.wgsl', 'style/tokens.ts'])
    for (const file of version.files) {
      expect(await service.readCodeFile(file)).toBe(sources[file.path as keyof typeof sources])
      expect(parseGitCodeLocation(file.location)?.oid).toBe(version.project.commit)
    }
    return version
  }
  const destination = await service.createProject({ name: '闭包收集' })
  const other = await service.createDocument({ kind: 'video_edit', container: { kind: 'project', projectId: destination.id }, name: '副本' })
  await service.saveDocument({ target: { id: other.meta.id }, expectedRevision: 0, content })
  expect((await service.collectDocumentMedia({ id: other.meta.id })).copiedFiles).toBe(3)
  await verify(other.meta.id)
  const single = await service.exportDocumentPackage({ target, destination: path.join(env.outside, '入口包') })
  const imported = await service.importPackage({ source: single.path, container: { kind: 'project', projectId: destination.id } })
  expect(imported.type).toBe('document')
  for (const document of await service.listDocuments({ container: { kind: 'project', projectId: destination.id } })) await verify(document.id)
  const full = await service.exportProjectPackage({ projectId: project.id, destination: path.join(env.outside, '源码工程包') })
  const importedProject = await service.importPackage({ source: full.path })
  if (importedProject.type !== 'project') throw new Error('应导入项目')
  const projects = await service.listProjects({})
  const copied = projects.find(value => value.id === importedProject.project.id)!
  expect(await fsp.readFile(path.join(copied.path, '代码/README.md'), 'utf8')).toBe(sources['README.md'])
  for (const document of await service.listDocuments({ container: { kind: 'project', projectId: copied.id } })) await verify(document.id)
  const sibling = await service.createDocument({ kind: 'video_edit', container: { kind: 'project', projectId: project.id }, name: '空白兄弟文档' })
  // Simulate a lost repository without deleting any source or Git objects.
  await fsp.rename(path.join(project.path, '代码/.git'), path.join(env.outside, 'lost-git-backup'))
  await expect(service.commitCodeProject({ target: { id: sibling.meta.id }, message: '不能重建' })).rejects.toThrow('.git 缺失')
  expect(await fsp.readFile(path.join(project.path, '代码/README.md'), 'utf8')).toBe(sources['README.md'])
})
describe('项目源码 Git 仓库', () => {
  it('替换非法名称，固定素材文件夹，同名定义加后缀，版本只创建不覆盖', async () => {
    const { service, write, target } = await setup(); const first = await write()
    expect(first.folder).toBe('霓虹_标题'); expect(parseGitCodeLocation(first.files[0].location)?.filepath).toBe('legacy/materials/霓虹_标题/main.ts')
    const next = await service.writeCodeVersion({ target, definitionId: 'definition', name: '已改名', folder: first.folder, contents: { entry: 'main.ts', files: { 'main.ts': '第二版' } } })
    expect(next.folder).toBe(first.folder); expect(next.files[0].location).not.toBe(first.files[0].location)
    expect(await service.readCodeFile(first.files[0])).toBe('export default {}')
    expect((await write('other')).folder).toBe('霓虹_标题 (2)')
  })
  it('拒绝路径越界、伪造素材目录与目录链接', async () => {
    const { service, target, write, project } = await setup()
    const contents = { entry: 'main.ts', files: { 'main.ts': 'x' } }
    await expect(service.writeCodeVersion({ target, definitionId: 'x', name: 'x', folder: '../outside', contents })).rejects.toThrow('越界')
    const first = await write()
    await expect(service.writeCodeVersion({ target, definitionId: 'other', name: 'x', folder: first.folder, contents })).rejects.toThrow('另一份')
    await expect(service.writeCodeVersion({ target, definitionId: 'x', name: 'x', contents: { entry: 'main.ts', files: { '../outside.ts': 'x' } } })).rejects.toThrow('相对')
    await fsp.mkdir(path.join(project.path, '代码', 'legacy', 'materials', '链接'), { recursive: true }); await fsp.rm(path.join(project.path, '代码', 'legacy', 'materials', '链接'), { recursive: true })
    await fsp.symlink(env.outside, path.join(project.path, '代码', 'legacy', 'materials', '链接'), 'junction')
    await expect(service.writeCodeVersion({ target, definitionId: 'x', name: '链接', contents })).rejects.toThrow('链接')
  })
  it('按提交内容缓存，修改和删除工作区文件不影响固定版本', async () => {
    const { service, target, write } = await setup(); const { files } = await write(); const file = files[0]
    const bom = await service.writeCodeVersion({ target, definitionId: 'bom', name: '带BOM', contents: { entry: 'main.ts', files: { 'main.ts': '\uFEFFexport const value=1;' } } })
    expect(await service.readCodeFile(bom.files[0])).toBe('\uFEFFexport const value=1;')
    expect(await service.readCodeFile(file)).toBe('export default {}'); expect(await service.readCodeFile(file)).toBe('export default {}')
    await fsp.writeFile(worktreePath(file.location), '改过的源码')
    expect(await service.readCodeFile(file)).toBe('export default {}')
    await fsp.rm(worktreePath(file.location))
    expect(await service.readCodeFile(file)).toBe('export default {}')
    await expect(service.readCodeFile({ ...file, location: path.join(env.outside, 'outside.ts') })).rejects.toThrow('源码位置无效')
  })
  it('同项目的不同剪辑共用组件，各版本与钉住的依赖完整读回', async () => {
    const { service, target, project } = await setup()
    const base = await service.publishCodeComponent({ target, name: '颜色', source: 'export const color=[1,0,0,1];', description: '红色', exports: ['color'], imports: [] })
    const component = await service.publishCodeComponent({ target, name: '人名条', source: 'import {color} from "@组件/颜色";export const fill=color;', description: '下三分之一', exports: ['fill'], imports: [base] })
    await service.publishCodeComponent({ target, name: '颜色', source: 'export const color=[0,1,0,1];', description: '绿色', exports: ['color'], imports: [] })
    const other = await service.createDocument({ kind: 'video_edit', container: { kind: 'project', projectId: project.id }, name: '另一剪辑' })
    const library = await service.listCodeComponents({ id: other.meta.id })
    expect(library.find(value => value.name === '颜色')?.latestVersion).toBe(2)
    expect(library.find(value => value.name === '人名条')?.versions[0].imports[0]).toMatchObject({ version: 1, hash: base.hash })
    expect(await service.readCodeFile({ path: '人名条', ...component })).toContain('export const fill=color')
    const duplicate = await service.publishCodeComponent({ target, name: '颜色', source: 'export const color=1;', description: '', exports: ['color'], imports: [], keepBoth: true })
    expect(duplicate.name).toBe('颜色 (2)')
  })
  it('最新组件也校验外部篡改；撤回只隐藏发布，文件与固定引用仍可读取且序号不复用', async () => {
    const { service, target } = await setup()
    const request = { target, name: '测试组件', source: 'export const value=1;', description: '', exports: ['value'], imports: [] }
    const version = await service.publishCodeComponent(request)
    await service.withdrawCodeComponent({ target, location: version.location, hash: version.hash })
    expect(await service.listCodeComponents(target)).toEqual([])
    expect(await service.readCodeFile({ ...version, path: '测试组件' })).toBe(version.source)
    const next = await service.publishCodeComponent(request); expect(next.version).toBe(2)
    const content = { media: [], bins: [], items: [], sequences: [], codeMaterials: [{ id: 'definition', versions: [{ files: [], imports: [{ name: version.name, version: version.version, location: version.location, hash: version.hash, imports: [] }] }] }] }
    await service.saveDocument({ target, expectedRevision: 0, content })
    const destination = await service.createProject({ name: '撤回副本' })
    const copy = await service.duplicateDocument({ target, container: { kind: 'project', projectId: destination.id }, onConflict: 'keepBoth' })
    expect(await service.listCodeComponents({ id: copy.meta.id })).toEqual([])
    await fsp.writeFile(worktreePath(next.location), next.source.replace('value=1', 'value=2'))
    expect((await service.listCodeComponents(target))[0].versions[0].source).toContain('value=1')
  })
  it('移动、复制、收集及项目/文档包都保留代码路径和组件文件', async () => {
    const { service, target, write } = await setup(); const stored = await write()
    const component = await service.publishCodeComponent({ target, name: '颜色', source: 'export const color=1;', description: '', exports: ['color'], imports: [] })
    const content = { media: [], bins: [], items: [], sequences: [], codeMaterials: [{ id: 'definition', folder: stored.folder, versions: [{ files: stored.files, imports: [{ name: component.name, version: component.version, location: component.location, hash: component.hash, imports: [] }] }] }] }
    await service.saveDocument({ target, expectedRevision: 0, content })
    const raw = await fsp.readFile((await service.readDocument(target)).meta.path, 'utf8')
    expect(raw).toContain(encodeURIComponent('henji:/代码')); expect(raw).not.toContain('export const')
    const destination = await service.createProject({ name: '目标' })
    const duplicate = await service.duplicateDocument({ target, container: { kind: 'project', projectId: destination.id }, onConflict: 'keepBoth' })
    expect(duplicate.copiedFiles).toBe(3)
    expect(await fsp.readFile(path.join(destination.path, '代码', 'legacy', 'materials', stored.folder, 'parts', 'card.ts'), 'utf8')).toBe('export const width=20')
    await service.moveDocument({ target, container: { kind: 'project', projectId: destination.id }, onConflict: 'keepBoth' })
    const moved = await service.readDocument(target); expect(moved.missingPaths).toEqual([])
    const documentPackage = await service.exportDocumentPackage({ target, destination: path.join(env.outside, '单剪辑') })
    const exported = await service.exportProjectPackage({ projectId: destination.id, destination: path.join(env.outside, '完整项目') })
    const imported = await service.importPackage({ source: exported.path }); expect(imported.type).toBe('project'); if (imported.type !== 'project') throw new Error('项目包导入结果类型错误')
    const fresh = await service.createProject({ name: '包导入' })
    await service.importPackage({ source: documentPackage.path, container: { kind: 'project', projectId: fresh.id } })
    expect(await fsp.readFile(path.join(fresh.path, '代码', 'legacy', 'components', '颜色', 'main.ts'), 'utf8')).toContain('export const color=1')
    expect((await service.listCodeComponents({ id: (await service.listDocuments({ container: { kind: 'project', projectId: fresh.id } }))[0].id }))[0].name).toBe('颜色')
    const collectTarget = await service.createProject({name:'收集目标'})
    const external = await service.createDocument({ kind: 'video_edit', container: { kind: 'project', projectId: collectTarget.id }, name: '收集' })
    await service.saveDocument({ target: { id: external.meta.id }, expectedRevision: 0, content: { media: [], bins: [], items: [], sequences: [], codeMaterials: [{ id: 'definition', versions: [{ files: [stored.files[0]] }] }] } })
    const collected = await service.collectDocumentMedia({ id: external.meta.id }); expect(collected.copiedFiles).toBe(1)
    const collectedDoc = await service.readDocument({ id: external.meta.id }); expect(collectedDoc.missingPaths).toEqual([])
  })
  it('跨项目同名素材及同名同版本组件按整个目录加后缀，保存新版本沿新目录继续', async () => {
    const { service, target, write } = await setup(); const original = await write()
    const sourceComponent = await service.publishCodeComponent({ target, name: '颜色', source: 'export const fill=1;', description: '', exports: ['fill'], imports: [] })
    const content = { media: [], bins: [], items: [], sequences: [], codeMaterials: [{ id: 'definition', folder: original.folder, versions: [{ files: original.files, imports: [{ name: sourceComponent.name, version: sourceComponent.version, location: sourceComponent.location, hash: sourceComponent.hash, imports: [] }] }] }] }
    await service.saveDocument({ target, expectedRevision: 0, content })
    const destination = await service.createProject({ name: '冲突目标' })
    const existingDoc = await service.createDocument({ kind: 'video_edit', container: { kind: 'project', projectId: destination.id }, name: '原剪辑' }); const existingTarget = { id: existingDoc.meta.id }
    const existing = await service.writeCodeVersion({ target: existingTarget, definitionId: 'other', name: '霓虹/标题', contents: { entry: 'main.ts', files: { 'main.ts': '另一份源码' } } })
    const existingComponent = await service.publishCodeComponent({ target: existingTarget, name: '颜色', source: 'export const fill=2;', description: '', exports: ['fill'], imports: [] })
    const copied = await service.duplicateDocument({ target, container: { kind: 'project', projectId: destination.id }, onConflict: 'keepBoth' })
    const loaded = (await service.readDocument({ id: copied.meta.id })).content as typeof content
    const definition = loaded.codeMaterials[0]; expect(definition.folder).toBe(`${original.folder} (2)`)
    expect(parseGitCodeLocation(definition.versions[0].imports[0].location)?.filepath).toBe('legacy/components/颜色 (2)/main.ts')
    expect((await service.listCodeComponents({ id: copied.meta.id })).map(component => component.name)).toEqual(expect.arrayContaining(['颜色', '颜色 (2)']))
    expect(await service.readCodeFile({ ...definition.versions[0].imports[0], path: '颜色' })).toBe(sourceComponent.source)
    expect(await service.readCodeFile({ ...existingComponent, path: '原颜色' })).toContain('fill=2')
    const next = await service.writeCodeVersion({ target: { id: copied.meta.id }, definitionId: definition.id, name: '改名', folder: definition.folder, contents: { entry: 'main.ts', files: { 'main.ts': '新版' } } })
    expect(next.folder).toBe(definition.folder); expect(await service.readCodeFile(existing.files[0])).toBe('另一份源码')
    const unsafeProject = await service.createProject({ name: '链接目标' })
    await fsp.mkdir(path.join(unsafeProject.path, '代码', 'legacy', 'materials'), { recursive: true })
    await fsp.symlink(env.outside, path.join(unsafeProject.path, '代码', 'legacy', 'materials', original.folder), 'junction')
    await expect(service.duplicateDocument({ target, container: { kind: 'project', projectId: unsafeProject.id }, onConflict: 'keepBoth' })).rejects.toThrow('链接')
  })
})

it('补偿保留所有历史对象和工作区用户编辑，未被文档引用的组件从发现中撤回', async () => {
  const { service, target, write } = await setup()
  const first = await write()
  const second = await service.writeCodeVersion({ target, definitionId: 'definition', name: '新版', folder: first.folder, contents: { entry: 'main.ts', files: { 'main.ts': 'next' } } })
  await fsp.writeFile(worktreePath(second.files[0].location), '用户编辑')
  await service.discardCodeFiles({ files: [...first.files, ...second.files], retainedLocations: [] })
  expect(await service.readCodeFile(first.files[0])).toBe('export default {}')
  expect(await service.readCodeFile(second.files[0])).toBe('next')
  expect(await fsp.readFile(worktreePath(second.files[0].location), 'utf8')).toBe('用户编辑')
})

it('发布失败恢复已写文件与索引，原版本仍可读取，恢复后可重试', async () => {
  const { service, project, target, write } = await setup()
  const first = await write()
  const writeFile = fsp.writeFile.bind(fsp)
  const failure = vi.spyOn(fsp, 'writeFile').mockImplementation(async (...args: Parameters<typeof fsp.writeFile>) => {
    if (String(args[0]).includes('bad.ts')) throw new Error('磁盘失败')
    return writeFile(...args)
  })
  try {
    await expect(service.writeCodeVersion({ target, definitionId: 'bad', name: '失败', contents: { entry: 'main.ts', files: { 'main.ts': 'good', 'nested/bad.ts': 'bad' } } })).rejects.toThrow('磁盘失败')
  } finally { failure.mockRestore() }
  expect(await service.readCodeFile(first.files[0])).toBe('export default {}')
  expect(await new CodeGitRepository(path.join(project.path, '代码')).versions()).toHaveLength(1)
  await expect(service.writeCodeVersion({ target, definitionId: 'bad', name: '失败', contents: { entry: 'main.ts', files: { 'main.ts': 'retry' } } })).resolves.toMatchObject({ folder: '失败' })
  await expect(service.publishCodeComponent({ target, name: '超限', source: 'x'.repeat(16 * 1024 ** 2), description: '', exports: [], imports: [] })).rejects.toThrow('16MiB')
})

it('正式写入入口并发分配版本序号，没有覆盖或丢失提交', async () => {
  const { service, project, target, write } = await setup()
  const first = await write()
  const results = await Promise.all(Array.from({ length: 5 }, (_, index) => service.writeCodeVersion({ target, definitionId: 'definition', name: '并发', folder: first.folder, contents: { entry: 'main.ts', files: { 'main.ts': String(index) } } })))
  expect(new Set(results.map(result => result.files[0].location)).size).toBe(5)
  expect((await new CodeGitRepository(path.join(project.path, '代码')).versions()).map(version => version.version)).toEqual([1, 2, 3, 4, 5, 6])
  for (const [index, result] of results.entries()) expect(await service.readCodeFile(result.files[0])).toBe(String(index))
})

it('本机和历史文档没有标记；外部导入只给导入批次的记录打标，复制沿用标记', async () => {
  const { service, document, target, write } = await setup()
  const written = await write()
  const content = { media: [], bins: [], items: [], sequences: [], codeMaterials: [{ id: 'definition', defaultVersionId: 'version', name: '代码', versions: [{ id: 'version', apiVersion: 4, languageVersion: 4, entry: 'main.ts', files: written.files }] }] }
  await service.saveDocument({ target, expectedRevision: 0, content })
  const local = await service.readDocument(target)
  expect(local.content).not.toHaveProperty('foreign')
  expect(local.content).toMatchObject({ codeMaterials: [{ versions: [expect.not.objectContaining({ foreign: expect.anything() })] }] })
  const importedPath = path.join(env.outside, '外部剪辑.hjvid')
  const siblingPath = path.join(env.outside, '相邻剪辑.hjvid')
  await fsp.copyFile(document.meta.path, importedPath)
  await fsp.copyFile(document.meta.path, siblingPath)
  const imported = await service.registerExternalDocument(importedPath)
  const foreign = { id: imported.id, sourceName: imported.name, sourceType: 'document_package' }
  expect((await service.readDocument({ id: imported.id })).content).toMatchObject({ foreign, codeMaterials: [{ versions: [{ foreign }] }] })
  const copied = await service.duplicateDocument({ target: { id: imported.id }, name: '派生副本', onConflict: 'keepBoth' })
  expect((await service.readDocument({ id: copied.meta.id })).content).toMatchObject({ foreign, codeMaterials: [{ versions: [{ foreign }] }] })
  expect((await service.readDocument(target)).content).not.toHaveProperty('foreign')
  const sibling = await service.registerExternalDocument(siblingPath)
  expect((await service.readDocument({ id: sibling.id })).content).toHaveProperty('foreign')
})

it('从单个外部文档打开工程时，工程其他目录的代码也带来源标记', async () => {
  const { service, project, target, document, write } = await setup()
  const written = await write()
  await service.saveDocument({ target, expectedRevision: 0, content: { media: [], bins: [], items: [], sequences: [], codeMaterials: [{ id: 'definition', versions: [{ files: written.files }] }] } })
  const externalPath = path.join(env.outside, '外来工程')
  await fsp.cp(project.path, externalPath, { recursive: true })
  const selected = path.join(externalPath, path.relative(project.path, document.meta.path))
  const nested = path.join(externalPath, '另一目录', '另一个.hjvid')
  await fsp.mkdir(path.dirname(nested), { recursive: true })
  await fsp.copyFile(selected, nested)
  const opened = await service.registerExternalDocument(selected)
  if (opened.container.kind !== 'project') throw new Error('应属于外部工程')
  const rows = await service.listDocuments({ kind: 'video_edit', container: opened.container })
  expect(rows).toHaveLength(2)
  for (const row of rows) expect((await service.readDocument({ id: row.id })).content).toMatchObject({ codeMaterials: [{ versions: [{ foreign: { sourceType: 'project', id: opened.container.projectId } }] }] })
  expect((await service.readDocument(target)).content).not.toHaveProperty('foreign')
})
