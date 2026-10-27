import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import git from 'isomorphic-git'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { CodeProjectRepository } from './code-project'
import { codeDigest } from './code-git'
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
})
