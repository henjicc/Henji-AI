import fsp from 'node:fs/promises'
import fs from 'node:fs'
import git from 'isomorphic-git'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createTestEnvironment, type TestEnvironment } from './documents.test-support'
import { CodeGitRepository, codeDigest } from './code-git'
import { packageComponentSource } from '../../../../src/core/videoEdit/codeMaterial/components'
import { parseGitCodeLocation } from '../../../../src/core/storage/gitCodeLocation'
import { PersistenceError } from '../../../../src/core/persistence/migrations'

let env: TestEnvironment
beforeEach(() => { env = createTestEnvironment() })
afterEach(async () => { vi.restoreAllMocks(); await env.cleanup() })

async function legacy() {
  const service = env.services.service
  const project = await service.createProject({ name: '历史工程' })
  const document = await service.createDocument({ kind: 'video_edit', container: { kind: 'project', projectId: project.id }, name: '旧剪辑' })
  const target = { id: document.meta.id }
  const root = path.join(project.path, '代码')
  const files = []
  for (const version of [1, 3]) {
    const location = path.join(root, '开场', `v${version}`, 'parts/title.ts')
    const source = `export const title=${version}`
    await fsp.mkdir(path.dirname(location), { recursive: true }); await fsp.writeFile(location, source)
    files.push({ path: 'parts/title.ts', location, hash: codeDigest(source) })
  }
  await fsp.writeFile(path.join(root, '开场', '.definition'), 'definition')
  const componentSource = packageComponentSource('export const color=1', { name: '颜色', version: 2, description: '', exports: ['color'], imports: [] })
  const component = { name: '颜色', version: 2, location: path.join(root, '组件库', '颜色', 'v2.ts'), hash: codeDigest(componentSource), imports: [] }
  await fsp.mkdir(path.dirname(component.location), { recursive: true })
  await fsp.writeFile(component.location, componentSource); await fsp.writeFile(`${component.location}.sha256`, component.hash)
  const content = { media: [], bins: [], items: [], sequences: [], codeMaterials: [{ id: 'definition', folder: '开场', versions: files.map(file => ({ files: [file], imports: [component] })) }] }
  await service.saveDocument({ target, expectedRevision: 0, content })
  return { service, project, document, target, root, files, component, content }
}

it('旧路径只读兼容；逐版本导入、保存读回后归档，重跑不增加提交或修订', async () => {
  const { service, project, target, root, files, component, content } = await legacy()
  expect(await service.readCodeFile(files[0])).toBe('export const title=1')
  expect((await service.listCodeComponents(target))[0].latestVersion).toBe(2)
  await fsp.writeFile(`${component.location}.withdrawn`, component.hash)
  const result = await service.migrateCodeStorage(project.id)
  expect(result).toMatchObject({ importedVersions: 3, archivedFolders: 2, retainedFolders: 0 })
  const read = await service.readDocument(target)
  const migrated = read.content as typeof content
  expect(migrated.codeMaterials[0].versions.map(version => version.files[0].hash)).toEqual(files.map(file => file.hash))
  for (const [index, version] of migrated.codeMaterials[0].versions.entries()) {
    expect(parseGitCodeLocation(version.files[0].location)).not.toBeNull()
    expect(await service.readCodeFile(version.files[0])).toBe(`export const title=${index === 0 ? 1 : 3}`)
    expect(await service.readCodeFile({ ...version.imports[0], path: '颜色' })).toContain('export const color=1')
  }
  expect(await service.listCodeComponents(target)).toEqual([])
  expect(await fsp.stat(path.join(root, '开场')).catch(() => null)).toBeNull()
  expect(await fsp.readFile(path.join(root, '素材/开场/parts/title.ts'), 'utf8')).toBe('export const title=3')
  const backups = await fsp.readdir(path.join(project.path, '.henji/backups'))
  expect(backups.some(name => name.startsWith('code-git-'))).toBe(true)
  expect(await service.migrateCodeStorage(project.id)).toMatchObject({ importedVersions: 0, archivedFolders: 0 })
  expect((await service.readDocument(target)).meta.revision).toBe(read.meta.revision)
})

it('保存中断后旧文件全保留；重跑复用已导入标签且补齐引用', async () => {
  const { service, project, root, files, target, content } = await legacy()
  const save = vi.spyOn(env.services.repository, 'save').mockRejectedValueOnce(new Error('模拟磁盘写入失败'))
  await expect(service.migrateCodeStorage(project.id)).rejects.toThrow('磁盘写入失败')
  for (const file of files) expect(await service.readCodeFile(file)).toContain('export const title=')
  expect(((await service.readDocument(target)).content as typeof content).codeMaterials[0].versions[0].files[0].location).toBe(files[0].location)
  expect(await new CodeGitRepository(root).versions()).toHaveLength(3)
  save.mockRestore()
  expect(await service.migrateCodeStorage(project.id)).toMatchObject({ importedVersions: 0, archivedFolders: 2 })
})

it('校验不一致在首个提交前拒绝，修正后可恢复', async () => {
  const { service, project, root, files } = await legacy()
  await fsp.writeFile(files[0].location, '外部改写')
  await expect(service.migrateCodeStorage(project.id)).rejects.toThrow('校验失败')
  expect(await new CodeGitRepository(root).exists()).toBe(false)
  await fsp.writeFile(files[0].location, 'export const title=1')
  expect(await service.migrateCodeStorage(project.id)).toMatchObject({ importedVersions: 3 })
})

it('混存时导入旧历史不降低最新工作区；其他文档仍引用的旧文件延后归档', async () => {
  const { service, project, root, target, content } = await legacy()
  const latest = await service.writeCodeVersion({ target, definitionId: 'definition', name: '开场', folder: '开场', contents: { entry: 'parts/title.ts', files: { 'parts/title.ts': 'export const title=4' } } })
  const otherProject = await service.createProject({ name: '外部引用' })
  const other = await service.createDocument({ kind: 'video_edit', container: { kind: 'project', projectId: otherProject.id }, name: '引用旧文件' })
  await service.saveDocument({ target: { id: other.meta.id }, expectedRevision: 0, content })
  expect(await service.migrateCodeStorage(project.id)).toMatchObject({ importedVersions: 3, archivedFolders: 0, retainedFolders: 2 })
  expect(await fsp.readFile(path.join(root, '素材/开场/parts/title.ts'), 'utf8')).toBe('export const title=4')
  expect(await service.readCodeFile(latest.files[0])).toBe('export const title=4')
  expect((await service.listCodeComponents(target))[0].versions).toHaveLength(1)
  await service.collectDocumentMedia({ id: other.meta.id })
  expect(await service.migrateCodeStorage(project.id)).toMatchObject({ importedVersions: 0, archivedFolders: 2 })
})

it('导入中断后手改工作区不被重试覆盖', async () => {
  const { service, project, target, root } = await legacy()
  await service.writeCodeVersion({ target, definitionId: 'definition', name: '开场', folder: '开场', contents: { entry: 'main.ts', files: { 'main.ts': 'newest' } } })
  await fsp.writeFile(path.join(root, '素材/开场/main.ts'), '用户改动')
  await expect(service.migrateCodeStorage(project.id)).rejects.toThrow('未提交')
  expect(await fsp.readFile(path.join(root, '素材/开场/main.ts'), 'utf8')).toBe('用户改动')
})

it('提交前进程中断留下部分工作区与索引，重跑恢复；索引含独有用户编辑时拒绝', async () => {
  const { service, project, root } = await legacy()
  await git.init({ fs, dir: root, defaultBranch: 'main' })
  const filepath = '素材/开场/parts/title.ts'
  await fsp.mkdir(path.dirname(path.join(root, filepath)), { recursive: true })
  await fsp.writeFile(path.join(root, filepath), '用户暂存的独有编辑')
  await git.add({ fs, dir: root, filepath })
  await fsp.writeFile(path.join(root, filepath), 'export const title=1')
  await expect(service.migrateCodeStorage(project.id)).rejects.toThrow('无法确认属于中断的迁移')
  await git.add({ fs, dir: root, filepath })
  expect(await service.migrateCodeStorage(project.id)).toMatchObject({ importedVersions: 3, archivedFolders: 2 })
  expect(await fsp.readFile(path.join(root, filepath), 'utf8')).toBe('export const title=3')
})

it('别处有打不开的旧格式文档时照常归档；读不了的其他原因仍延后归档', async () => {
  const { service, project } = await legacy()
  const otherProject = await service.createProject({ name: '旧格式' })
  const old = await service.createDocument({ kind: 'video_edit', container: { kind: 'project', projectId: otherProject.id }, name: '开发期旧剪辑' })
  const read = env.services.repository.read.bind(env.services.repository)
  const failure = { error: new PersistenceError('corrupt', 'document.video_edit', '剪辑', 1, 1) }
  vi.spyOn(env.services.repository, 'read').mockImplementation(async target => { if (target.id === old.meta.id) throw failure.error; return read(target) })
  expect(await service.migrateCodeStorage(project.id)).toMatchObject({ archivedFolders: 0, retainedFolders: 2 })
  failure.error = new PersistenceError('unsupported-version', 'document.video_edit', '剪辑', 10, 11)
  expect(await service.migrateCodeStorage(project.id)).toMatchObject({ importedVersions: 0, archivedFolders: 2 })
})
