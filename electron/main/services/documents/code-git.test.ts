import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import git from 'isomorphic-git'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { CodeGitRepository, codeDigest } from './code-git'
import { gitCodeLocation, parseGitCodeLocation } from '../../../../src/core/storage/gitCodeLocation'

let root: string
let repository: CodeGitRepository
beforeEach(async () => { root = await fsp.mkdtemp(path.join(os.tmpdir(), 'henji-code-git-')); repository = new CodeGitRepository(path.join(root, '代码')) })
afterEach(async () => { await fsp.rm(root, { recursive: true, force: true }) })
const version = (value: number) => ({ kind: '素材' as const, name: '开场', version: value, files: { 'main.ts': `export default ${value}`, 'parts/card.ts': 'export const card=1' } })

it('标准 Git 历史、轻量标签、多文件与历史 blob 独立于工作区', async () => {
  const first = await repository.write(version(1))
  const second = await repository.write({ ...version(2), files: { 'main.ts': 'export default 2' } })
  expect(await fsp.readFile(path.join(repository.dir, '素材/开场/main.ts'), 'utf8')).toBe('export default 2')
  expect(await fsp.stat(path.join(repository.dir, '素材/开场/parts/card.ts')).catch(() => null)).toBeNull()
  expect((await git.log({ fs, dir: repository.dir })).map(value => value.commit.message)).toEqual([expect.stringContaining('第 2 版'), expect.stringContaining('第 1 版')])
  expect(await git.listTags({ fs, dir: repository.dir })).toEqual(['素材/开场@v1', '素材/开场@v2'])
  await fsp.writeFile(path.join(repository.dir, '素材/开场/main.ts'), '外部编辑')
  expect(await repository.read(first.files[0].location, first.files[0].hash)).toBe('export default 1')
  expect(await repository.read(second.files[0].location, second.files[0].hash)).toBe('export default 2')
  await expect(repository.write(version(3))).rejects.toThrow('未提交')
  expect(await fsp.readFile(path.join(repository.dir, '素材/开场/main.ts'), 'utf8')).toBe('外部编辑')
})

it('同仓库多个实例串行提交，重试同版本幂等，不复用不同内容', async () => {
  await Promise.all(Array.from({ length: 8 }, (_, index) => new CodeGitRepository(repository.dir).write({ ...version(1), name: `模块${index}` })))
  expect(await git.log({ fs, dir: repository.dir })).toHaveLength(8)
  const first = await repository.write(version(1))
  expect(await repository.write(version(1))).toEqual(first)
  await expect(repository.write({ ...version(1), files: { 'main.ts': 'different' } })).rejects.toThrow('不能覆盖')
})

it('拒绝损坏引用、哈希、缺失对象、越界路径和符号链接', async () => {
  expect(() => parseGitCodeLocation('git:bad')).toThrow('引用无效')
  expect(() => gitCodeLocation({ oid: 'a'.repeat(40), repository: '/tmp/代码', filepath: '../outside.ts' })).toThrow('越界')
  await expect(repository.write({ ...version(1), files: { '../outside.ts': 'x' } })).rejects.toThrow('越界')
  const first = await repository.write(version(1))
  await expect(repository.read(first.files[0].location, codeDigest('different'))).rejects.toThrow('校验失败')
  const parsed = parseGitCodeLocation(first.files[0].location)!
  await expect(repository.read(gitCodeLocation({ ...parsed, oid: 'a'.repeat(40) }), first.files[0].hash)).rejects.toThrow('备份恢复')
  await fsp.mkdir(path.join(root, 'outside'))
  await fsp.symlink(path.join(root, 'outside'), path.join(repository.dir, '素材/链接'), 'junction')
  await expect(repository.write({ ...version(1), name: '链接' })).rejects.toThrow('包含链接')
})

it('支持中文和需转义的版本标签及 UTF-8 BOM，保留未跟踪旧版本文件', async () => {
  await fsp.mkdir(path.join(repository.dir, '旧素材/v9'), { recursive: true })
  await fsp.writeFile(path.join(repository.dir, '旧素材/v9/main.ts'), 'old')
  const result = await repository.write({ ...version(1), name: '开场 (2)', files: { 'main.ts': '\uFEFF你好' } })
  expect((await repository.versions())[0].name).toBe('开场 (2)')
  expect(await repository.read(result.files[0].location, result.files[0].hash)).toBe('\uFEFF你好')
  expect(await fsp.readFile(path.join(repository.dir, '旧素材/v9/main.ts'), 'utf8')).toBe('old')
  expect(await repository.files(result.oid)).toEqual(['素材/开场 (2)/main.ts'])
})
