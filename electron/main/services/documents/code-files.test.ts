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
describe('项目源码普通文件', () => {
  it('替换非法名称，固定素材文件夹，同名定义加后缀，版本只创建不覆盖', async () => {
    const { service, write, target } = await setup(); const first = await write()
    expect(first.folder).toBe('霓虹_标题'); expect(first.files[0].location).toContain(`${path.sep}代码${path.sep}霓虹_标题${path.sep}v1${path.sep}`)
    const next = await service.writeCodeVersion({ target, definitionId: 'definition', name: '已改名', folder: first.folder, contents: { entry: 'main.ts', files: { 'main.ts': '第二版' } } })
    expect(next.folder).toBe(first.folder); expect(next.files[0].location).toContain(`${path.sep}v2${path.sep}`)
    expect(await fsp.readFile(first.files[0].location, 'utf8')).toBe('export default {}')
    expect((await write('other')).folder).toBe('霓虹_标题 (2)')
  })
  it('拒绝路径越界、伪造素材目录与目录链接', async () => {
    const { service, target, write, project } = await setup()
    const contents = { entry: 'main.ts', files: { 'main.ts': 'x' } }
    await expect(service.writeCodeVersion({ target, definitionId: 'x', name: 'x', folder: '../outside', contents })).rejects.toThrow('越界')
    const first = await write()
    await expect(service.writeCodeVersion({ target, definitionId: 'other', name: 'x', folder: first.folder, contents })).rejects.toThrow('另一份')
    await expect(service.writeCodeVersion({ target, definitionId: 'x', name: 'x', contents: { entry: 'main.ts', files: { '../outside.ts': 'x' } } })).rejects.toThrow('相对')
    await fsp.mkdir(path.join(project.path, '代码', '链接'), { recursive: true }); await fsp.rm(path.join(project.path, '代码', '链接'), { recursive: true })
    await fsp.symlink(env.outside, path.join(project.path, '代码', '链接'), 'junction')
    await expect(service.writeCodeVersion({ target, definitionId: 'x', name: '链接', contents })).rejects.toThrow('链接')
  })
  it('按 hash 缓存仍核对磁盘，缺失与篡改给中文恢复提示', async () => {
    const { service, target, write } = await setup(); const { files } = await write(); const file = files[0]
    const bom = await service.writeCodeVersion({ target, definitionId: 'bom', name: '带BOM', contents: { entry: 'main.ts', files: { 'main.ts': '\uFEFFexport const value=1;' } } })
    expect(await service.readCodeFile(bom.files[0])).toBe('\uFEFFexport const value=1;')
    expect(await service.readCodeFile(file)).toBe('export default {}'); expect(await service.readCodeFile(file)).toBe('export default {}')
    await fsp.writeFile(file.location, '改过的源码')
    await expect(service.readCodeFile(file)).rejects.toThrow('外部修改')
    await fsp.rm(file.location)
    await expect(service.readCodeFile(file)).rejects.toThrow('从项目备份恢复到原位置')
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
    await fsp.writeFile(next.location, next.source.replace('value=1', 'value=2'))
    await expect(service.listCodeComponents(target)).rejects.toThrow('已被外部修改')
  })
  it('移动、复制、收集及项目/文档包都保留代码路径和组件文件', async () => {
    const { service, target, write, project } = await setup(); const stored = await write()
    const component = await service.publishCodeComponent({ target, name: '颜色', source: 'export const color=1;', description: '', exports: ['color'], imports: [] })
    const content = { media: [], bins: [], items: [], sequences: [], codeMaterials: [{ id: 'definition', folder: stored.folder, versions: [{ files: stored.files, imports: [{ name: component.name, version: component.version, location: component.location, hash: component.hash, imports: [] }] }] }] }
    await service.saveDocument({ target, expectedRevision: 0, content })
    const raw = await fsp.readFile((await service.readDocument(target)).meta.path, 'utf8')
    expect(raw).toContain('henji:/代码/'); expect(raw).not.toContain('export const')
    const destination = await service.createProject({ name: '目标' })
    const duplicate = await service.duplicateDocument({ target, container: { kind: 'project', projectId: destination.id }, onConflict: 'keepBoth' })
    expect(duplicate.copiedFiles).toBe(3)
    expect(await fsp.readFile(path.join(destination.path, '代码', stored.folder, 'v1', 'parts', 'card.ts'), 'utf8')).toBe('export const width=20')
    await service.moveDocument({ target, container: { kind: 'project', projectId: destination.id }, onConflict: 'keepBoth' })
    const moved = await service.readDocument(target); expect(JSON.stringify(moved.content)).toContain('代码')
    const documentPackage = await service.exportDocumentPackage({ target, destination: path.join(env.outside, '单剪辑') })
    const exported = await service.exportProjectPackage({ projectId: destination.id, destination: path.join(env.outside, '完整项目') })
    const imported = await service.importPackage({ source: exported.path }); expect(imported.type).toBe('project'); if (imported.type !== 'project') throw new Error('项目包导入结果类型错误')
    const fresh = await service.createProject({ name: '包导入' })
    await service.importPackage({ source: documentPackage.path, container: { kind: 'project', projectId: fresh.id } })
    expect(await fsp.readFile(path.join(fresh.path, '代码', '组件库', '颜色', 'v1.ts'), 'utf8')).toContain('export const color=1')
    expect((await service.listCodeComponents({ id: (await service.listDocuments({ container: { kind: 'project', projectId: fresh.id } }))[0].id }))[0].name).toBe('颜色')
    const collectTarget = await service.createProject({name:'收集目标'})
    const external = await service.createDocument({ kind: 'video_edit', container: { kind: 'project', projectId: collectTarget.id }, name: '收集' })
    await service.saveDocument({ target: { id: external.meta.id }, expectedRevision: 0, content: { media: [], bins: [], items: [], sequences: [], codeMaterials: [{ id: 'definition', versions: [{ files: [{ ...stored.files[0], location: path.join(project.path, '代码', stored.folder, 'v1', 'main.ts') }] }] }] } })
    const collected = await service.collectDocumentMedia({ id: external.meta.id }); expect(collected.copiedFiles).toBe(1)
    expect(JSON.stringify((await service.readDocument({ id: external.meta.id })).content)).toContain('代码')
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
    expect(definition.versions[0].imports[0].location).toContain(`颜色 (2)${path.sep}v1.ts`)
    expect((await service.listCodeComponents({ id: copied.meta.id })).map(component => component.name)).toEqual(expect.arrayContaining(['颜色', '颜色 (2)']))
    expect(await service.readCodeFile({ ...definition.versions[0].imports[0], path: '颜色' })).toBe(sourceComponent.source)
    expect(await service.readCodeFile({ ...existingComponent, path: '原颜色' })).toContain('fill=2')
    const next = await service.writeCodeVersion({ target: { id: copied.meta.id }, definitionId: definition.id, name: '改名', folder: definition.folder, contents: { entry: 'main.ts', files: { 'main.ts': '新版' } } })
    expect(next.folder).toBe(definition.folder); expect(await service.readCodeFile(existing.files[0])).toBe('另一份源码')
    const unsafeProject = await service.createProject({ name: '链接目标' })
    await fsp.mkdir(path.join(unsafeProject.path, '代码'), { recursive: true })
    await fsp.symlink(env.outside, path.join(unsafeProject.path, '代码', original.folder), 'junction')
    await expect(service.duplicateDocument({ target, container: { kind: 'project', projectId: unsafeProject.id }, onConflict: 'keepBoth' })).rejects.toThrow('链接')
  })
})

it('失败补偿回收源码、归属文件和空目录，原版本及被保存文档引用的目录保留', async () => {
  const { service, project, target, write } = await setup()
  const first = await write()
  const second = await service.writeCodeVersion({ target, definitionId: 'definition', name: '新版', folder: first.folder, contents: { entry: 'main.ts', files: { 'main.ts': 'next' } } })
  await service.discardCodeFiles({ files: second.files, retainedLocations: [] })
  expect(await fsp.readdir(path.join(project.path, '代码', first.folder))).toEqual(expect.arrayContaining(['.definition', 'v1']))
  expect(await fsp.readdir(path.join(project.path, '代码', first.folder))).not.toContain('v2')
  const otherProject = await service.createProject({ name: '外部项目' })
  const other = await service.createDocument({ kind: 'video_edit', container: { kind: 'project', projectId: otherProject.id }, name: '外部引用' })
  await service.saveDocument({ target: { id: other.meta.id }, expectedRevision: 0, content: { ...other.content as Record<string, unknown>, codeMaterials: [{ id: 'reference', versions: [{ files: first.files }] }] } })
  await service.discardCodeFiles({ files: first.files, retainedLocations: [] })
  expect(await service.readCodeFile(first.files[0])).toBe('export default {}')
  const failed = await write('failed', '失败')
  await service.discardCodeFiles({ files: failed.files, retainedLocations: [] })
  expect(await fsp.readdir(path.join(project.path, '代码'))).toEqual([first.folder])
})

it('活跃历史与组件引用保护文件，回收未引用组件时也清除校验文件和空目录', async () => {
  const { service, project, target, write } = await setup()
  const stored = await write()
  await service.discardCodeFiles({ files: stored.files, retainedLocations: [stored.files[0].location] })
  expect(await service.readCodeFile(stored.files[1])).toBe('export const width=20')
  const base = await service.publishCodeComponent({ target, name: '基础', source: 'export const value=1;', description: '', exports: ['value'], imports: [] })
  const parent = await service.publishCodeComponent({ target, name: '引用', source: 'export const value=2;', description: '', exports: ['value'], imports: [base] })
  const ref = (version: typeof base) => ({ path: version.name, location: version.location, hash: version.hash })
  await service.discardCodeFiles({ files: [ref(base)], retainedLocations: [] })
  expect(await service.readCodeFile(ref(base))).toBe(base.source)
  await service.discardCodeFiles({ files: [ref(base), ref(parent)], retainedLocations: [parent.location] })
  expect(await service.readCodeFile(ref(base))).toBe(base.source)
  await service.discardCodeFiles({ files: [ref(base), ref(parent)], retainedLocations: [] })
  expect(await fsp.readdir(path.join(project.path, '代码'))).toEqual([stored.folder])
})

it('部分写盘失败会回收本次源码及组件 sidecar，不删除原有版本', async () => {
  const { service, project, target, write } = await setup()
  const first = await write()
  const open = fsp.open.bind(fsp)
  const failure = vi.spyOn(fsp, 'open').mockImplementation(async (...args: Parameters<typeof fsp.open>) => {
    if (String(args[0]).includes('bad.ts')) throw new Error('磁盘失败')
    return open(...args)
  })
  await expect(service.writeCodeVersion({ target, definitionId: 'bad', name: '失败', contents: { entry: 'main.ts', files: { 'main.ts': 'good', 'nested/bad.ts': 'bad' } } })).rejects.toThrow('磁盘失败')
  failure.mockRestore()
  expect(await fsp.readdir(path.join(project.path, '代码'))).toEqual([first.folder])
  await expect(service.publishCodeComponent({ target, name: '超限', source: 'x'.repeat(16 * 1024 ** 2), description: '', exports: [], imports: [] })).rejects.toThrow('16MiB')
  expect(await fsp.readdir(path.join(project.path, '代码'))).toEqual([first.folder])
})

it('同批次多个新版本补偿后归属目录也消失，非本次新建文件和被篡改源码不删除', async () => {
  const { service, project, target, write } = await setup()
  const first = await write()
  const second = await service.writeCodeVersion({ target, definitionId: 'definition', name: '第二版', folder: first.folder, contents: { entry: 'main.ts', files: { 'main.ts': 'next' } } })
  await service.discardCodeFiles({ files: [...first.files, ...second.files], retainedLocations: [] })
  expect(await fsp.readdir(path.join(project.path, '代码'))).toEqual([])
  const changed = await write()
  await fsp.writeFile(changed.files[0].location, '用户修改')
  await expect(service.discardCodeFiles({ files: changed.files, retainedLocations: [] })).rejects.toThrow('外部修改')
  expect(await fsp.readFile(changed.files[0].location, 'utf8')).toBe('用户修改')
  const unknown = path.join(project.path, '代码', '自建.ts')
  await fsp.writeFile(unknown, 'user')
  await service.discardCodeFiles({ files: [{ path: '自建.ts', location: unknown, hash: 'a'.repeat(64) }], retainedLocations: [] })
  expect(await fsp.readFile(unknown, 'utf8')).toBe('user')
})

it('组件源码发布失败回收已写校验文件', async () => {
  const { service, project, target } = await setup()
  const open = fsp.open.bind(fsp)
  const failure = vi.spyOn(fsp, 'open').mockImplementation(async (...args: Parameters<typeof fsp.open>) => {
    if (String(args[0]).includes('v1.ts') && !String(args[0]).includes('sha256')) throw new Error('源码写入失败')
    return open(...args)
  })
  try {
    await expect(service.publishCodeComponent({ target, name: '失败', source: 'export const value=1;', description: '', exports: ['value'], imports: [] })).rejects.toThrow('源码写入失败')
  } finally { failure.mockRestore() }
  expect(await fsp.readdir(path.join(project.path, '代码'))).toEqual([])
})
