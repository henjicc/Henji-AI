import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import git from 'isomorphic-git'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { CodeProjectRepository } from './code-project'
import { codeDigest } from './code-git'
import { transferGitCode } from './code-git-transfer'
import { parseGitCodeLocation } from '../../../../src/core/storage/gitCodeLocation'
let root: string
let repo: CodeProjectRepository
beforeEach(async () => { root = await fsp.mkdtemp(path.join(os.tmpdir(), 'henji-code-project-')); await fsp.mkdir(path.join(root, '.henji')); repo = new CodeProjectRepository(path.join(root, '代码')) })
afterEach(async () => { vi.restoreAllMocks(); await fsp.rm(root, { recursive: true, force: true }) })
const edit = (file: string, source: string | null, before: string | null = null) => ({ path: file, source, expectedHash: before === null ? null : codeDigest(before) })
it('整批只提交一次；工作区可读，历史固定，撤销追加新提交', async () => {
  expect(await repo.state()).toMatchObject({ head: null, files: [], log: [] })
  expect(await fsp.stat(path.join(repo.dir, '.git')).catch(() => null)).toBeNull()
  const first = await repo.change({ message: '创建工程', changes: [edit('README.md', '说明'), edit('entries/opening.ts', 'one'), edit('style/tokens.ts', 'color')] })
  expect((await repo.state()).log).toHaveLength(1)
  expect((await repo.state()).log[0]).toMatchObject({ message: '创建工程', paths: ['README.md', 'entries/opening.ts', 'style/tokens.ts'] })
  await repo.change({ message: '改名与源码', changes: [edit('entries/opening.ts', null, 'one'), edit('entries/intro.ts', 'two')] })
  expect(await repo.sourceAt(first, 'entries/opening.ts')).toBe('one')
  await repo.change({ message: '撤销', changes: [edit('entries/intro.ts', null, 'two'), edit('entries/opening.ts', 'one')] })
  expect((await repo.state()).log).toHaveLength(3)
  expect((await repo.state()).changes).toEqual([])
})
it('点名外部修改，保持文件原文；不相关修改不进入自动提交；显式提交外部状态', async () => {
  await repo.change({ message: '开始', changes: [edit('a.ts', 'a'), edit('b.ts', 'b')] })
  await fsp.writeFile(path.join(repo.dir, 'a.ts'), 'external')
  await expect(repo.change({ message: '错误覆盖', changes: [edit('a.ts', 'new', 'external')] })).rejects.toThrow('a.ts')
  await repo.change({ message: '修改b', changes: [edit('b.ts', 'new', 'b')] })
  expect((await repo.state()).changes).toEqual([{ path: 'a.ts', kind: 'modified' }])
  const oid = await repo.commitWorkspace('外部编辑')
  expect(await repo.sourceAt(oid, 'a.ts')).toBe('external')
  expect((await repo.state()).changes).toEqual([])
})
it('并发写入串行化并校验基线；损坏仓库不重建', async () => {
  await repo.change({ message: '开始', changes: [edit('a.ts', 'a')] })
  const results = await Promise.allSettled(['b', 'c'].map(source => new CodeProjectRepository(repo.dir).change({ message: source, changes: [edit('a.ts', source, 'a')] })))
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
  expect((await repo.state()).log).toHaveLength(2)
  await fsp.writeFile(path.join(repo.dir, '.git/refs/heads/main'), 'a'.repeat(40))
  await expect(repo.state()).rejects.toThrow('恢复')
})
it('提交失败恢复文件与暂存区；拒绝捕获用户暂存区', async () => {
  await repo.change({ message: '开始', changes: [edit('a.ts', 'a')] })
  const mocked = vi.spyOn(git, 'commit').mockRejectedValueOnce(new Error('磁盘失败'))
  await expect(repo.change({ message: '失败', changes: [edit('a.ts', 'new', 'a'), edit('new.ts', 'new')] })).rejects.toThrow('磁盘失败')
  mocked.mockRestore()
  expect((await repo.state()).changes).toEqual([])
  await fsp.writeFile(path.join(repo.dir, 'user.ts'), 'user')
  await git.add({ fs, dir: repo.dir, filepath: 'user.ts' })
  await expect(repo.change({ message: '不能混入', changes: [edit('a.ts', 'new', 'a')] })).rejects.toThrow('user.ts')
  const index = await fsp.readFile(path.join(repo.dir, '.git/index'))
  vi.spyOn(git, 'commit').mockRejectedValueOnce(new Error('外部提交磁盘失败'))
  await expect(repo.commitWorkspace('失败')).rejects.toThrow('工作区原文保留')
  expect(await fsp.readFile(path.join(repo.dir, '.git/index'))).toEqual(index)
  expect(await fsp.readFile(path.join(repo.dir, 'user.ts'), 'utf8')).toBe('user')
})

it('记录50文件工程的批量提交与闭包缓存耗时', async () => {
  const sources = Object.fromEntries(Array.from({ length: 49 }, (_, index) => [`style/m${index}.ts`, `export const v=${index}`]))
  sources['entries/main.ts'] = Object.keys(sources).map(file => `export * from "../${file}";`).join('\n')
  await repo.change({ message: '50文件工程', changes: Object.entries(sources).map(([file, source]) => edit(file, source)) })
  const times: number[] = []
  for (let version = 0; version < 8; version++) {
    const paths = Object.keys(sources).slice(0, 10)
    const changes = paths.map(file => edit(file, `${sources[file]}\n//${version}`, sources[file]))
    const start = performance.now(); await repo.change({ message: `修改${version}`, changes }); times.push(performance.now() - start)
    for (const change of changes) sources[change.path] = change.source!
  }
  const cold = performance.now(); const closure = await repo.resolve('entries/main.ts'); const coldMs = performance.now() - cold
  const warm = performance.now(); for (let index = 0; index < 50; index++) await repo.resolve('entries/main.ts', closure.commit)
  process.stdout.write(`工程基准（50文件，每次改10个，8批）：提交中位${times.sort((a, b) => a - b)[4].toFixed(2)}ms，闭包冷读${coldMs.toFixed(2)}ms，缓存均值${((performance.now() - warm) / 50).toFixed(3)}ms\n`)
  expect(closure.files).toHaveLength(50)
})
it('入口闭包递归相对导入、重导出、循环、着色器，忽略说明和外部模块，按提交缓存', async () => {
  const first = await repo.change({ message: '源码树', changes: [
    edit('entries/opening.ts', 'import {x} from "../style"; import shader from "../style/a.wgsl"; import "https://example.test/m.js"; export default {x,shader};'),
    edit('style/index.ts', 'export {x} from "./tokens"'), edit('style/tokens.ts', 'import "./index"; export const x=1'), edit('style/a.wgsl', 'fn main() {}'), edit('README.md', '说明'), edit('archive/unused.ts', 'unused'),
  ] })
  const closure = await repo.resolve('entries/opening.ts')
  expect(closure.files.map(file => file.path)).toEqual(['entries/opening.ts', 'style/a.wgsl', 'style/index.ts', 'style/tokens.ts'])
  await repo.change({ message: '更新共享样式', changes: [edit('style/tokens.ts', 'export const x=2', 'import "./index"; export const x=1')] })
  expect(await repo.resolve('entries/opening.ts', first)).toEqual(closure)
  expect((await repo.resolve('entries/opening.ts')).commit).not.toBe(first)
  await expect(repo.resolve('missing.ts')).rejects.toThrow('missing.ts')
  const broken = await repo.change({ message: '缺失依赖', changes: [edit('broken.ts', 'export * from "../outside"')] })
  await expect(repo.resolve('broken.ts', broken)).rejects.toThrow('broken.ts 导入 ../outside')
})
it('跨项目收集工程闭包保留所有路径与字节，不覆盖目标作者树', async () => {
  await repo.change({ message: '源码树', changes: [edit('entries/a.ts', 'import "../style/a.wgsl"'), edit('style/a.wgsl', 'shader')] })
  const closure = await repo.resolve('entries/a.ts')
  const target = new CodeProjectRepository(path.join(root, 'other', '代码'))
  await fsp.mkdir(path.join(root, 'other', '.henji'), { recursive: true })
  const head = await target.change({ message: '目标树', changes: [edit('entries/a.ts', 'keep')] })
  const mapped = await transferGitCode(closure.files.map(file => file.location), target.dir)
  for (const file of closure.files) expect(await target.read(mapped.get(file.location)!, file.hash)).toBe(await repo.read(file.location, file.hash))
  expect(await target.head()).toBe(head)
  expect(await fsp.readFile(path.join(target.dir, 'entries/a.ts'), 'utf8')).toBe('keep')
  const snapshot = parseGitCodeLocation(mapped.get(closure.files[0].location)!)!
  expect((await target.resolve(closure.entry, snapshot.oid)).files).toHaveLength(2)
})
