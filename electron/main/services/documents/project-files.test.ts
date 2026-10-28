import { afterEach, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { resolveProjectRelativePaths } from './project-files'

const style = process.platform === 'win32' ? 'win32' : 'posix'
const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }) })
async function fixture(): Promise<{ project: string; outside: string }> {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-project-files-')); roots.push(base)
  const project = path.join(base, '项目'); const outside = path.join(base, '项目外')
  await fs.mkdir(path.join(project, '素材', '截图'), { recursive: true }); await fs.mkdir(outside)
  await fs.writeFile(path.join(project, '素材', '截图', '产品主页.png'), 'png')
  await fs.writeFile(path.join(outside, '机密.png'), 'png')
  return { project, outside }
}

it('项目内相对路径按真实路径解析出文件与文件夹，两种分隔符与 . 都接受', async () => {
  const { project } = await fixture()
  const result = await resolveProjectRelativePaths(project, ['素材/截图/产品主页.png', '素材\\截图', './素材/截图/'], style)
  const real = await fs.realpath(project)
  expect(result.root).toBe(real)
  expect(result.entries).toEqual([
    { input: '素材/截图/产品主页.png', status: 'resolved', relativePath: '素材/截图/产品主页.png', path: path.join(real, '素材', '截图', '产品主页.png'), kind: 'file' },
    { input: '素材\\截图', status: 'resolved', relativePath: '素材/截图', path: path.join(real, '素材', '截图'), kind: 'directory' },
    { input: './素材/截图/', status: 'resolved', relativePath: '素材/截图', path: path.join(real, '素材', '截图'), kind: 'directory' },
  ])
})

it('绝对路径、盘符、网络路径、.. 与空路径逐条拒绝并点名原因，不碰文件系统之外的位置', async () => {
  const { project, outside } = await fixture()
  const inputs = [path.join(outside, '机密.png'), 'C:/Windows/win.ini', 'D:素材', '\\\\server\\share\\a.png', '/etc/passwd', '../项目外/机密.png', '素材/../../项目外/机密.png', '', '  ', '.', '素材/a\u0000.png']
  const result = await resolveProjectRelativePaths(project, inputs, style)
  expect(result.entries.map(entry => entry.status === 'rejected' ? entry.reason : entry.status)).toEqual([
    'absolute_path', 'absolute_path', 'absolute_path', 'absolute_path', 'absolute_path', 'parent_segment', 'parent_segment', 'invalid_path', 'invalid_path', 'invalid_path', 'invalid_path',
  ])
  for (const [index, entry] of result.entries.entries()) {
    expect(entry.input).toBe(inputs[index])
    if (entry.status === 'rejected') expect(entry.message).toContain(`“${inputs[index]}”`)
  }
  // 消息只回显原样输入，不另外带出项目文件夹的绝对位置
  const real = await fs.realpath(project)
  expect(result.entries.some(entry => entry.status === 'rejected' && entry.message.replace(`“${entry.input}”`, '').includes(real))).toBe(false)
})

it('联接点或符号链接把真实位置带出项目时拒绝为 outside_project；项目里不存在的报 not_found', async () => {
  const { project, outside } = await fixture()
  await fs.symlink(outside, path.join(project, '素材', '外链'), process.platform === 'win32' ? 'junction' : 'dir')
  const result = await resolveProjectRelativePaths(project, ['素材/外链', '素材/外链/机密.png', '素材/没有这个.png'], style)
  expect(result.entries.map(entry => entry.status === 'rejected' ? entry.reason : entry.status)).toEqual(['outside_project', 'outside_project', 'not_found'])
})

it('指回项目文件夹本身的链接不算项目里的文件', async () => {
  const { project } = await fixture()
  await fs.symlink(project, path.join(project, '素材', '回到根'), process.platform === 'win32' ? 'junction' : 'dir')
  const [entry] = (await resolveProjectRelativePaths(project, ['素材/回到根'], style)).entries
  expect(entry).toMatchObject({ status: 'rejected', reason: 'invalid_path' })
})
