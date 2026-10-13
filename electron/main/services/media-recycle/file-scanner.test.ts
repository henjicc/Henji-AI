import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { scanReferenceFiles } from './file-scanner'

let root: string
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-reference-scan-')) })
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }) })
it('无关 junction 不阻断，链接内作品的引用仍保护媒体且目录循环有界', async () => {
  const outside = path.join(root, 'outside'); const user = path.join(root, 'user')
  await fs.mkdir(outside); await fs.mkdir(user)
  await fs.writeFile(path.join(outside, 'saved.henji-canvas'), JSON.stringify({ image: 'D:/managed/held.png' }))
  await fs.symlink(outside, path.join(user, 'link'), 'junction')
  await fs.symlink(user, path.join(outside, 'loop'), 'junction')
  const refs: string[] = []
  await scanReferenceFiles([{ path: user }], ['.henji-canvas'], new AbortController().signal, async (_file, paths) => { refs.push(...paths) })
  expect(refs).toEqual(['D:/managed/held.png'])
})
it('无法解析的链接继续 fail-closed，取消扫描退出 worker', async () => {
  const target = path.join(root, 'target'); await fs.mkdir(target)
  await fs.symlink(target, path.join(root, 'broken'), 'junction'); await fs.rmdir(target)
  await expect(scanReferenceFiles([{ path: root }], ['.henji-canvas'], new AbortController().signal, async () => undefined)).rejects.toThrow()
  const controller = new AbortController(); controller.abort()
  await expect(scanReferenceFiles([{ path: root }], [], controller.signal, async () => undefined)).rejects.toThrow()
})
it('作品根跳过受管目录，显式文档仍扫描，重复文件只解析一次', async () => {
  const generated = path.join(root, 'generated'); await fs.mkdir(generated)
  await fs.writeFile(path.join(generated, 'unrelated.henji-canvas'), '{invalid')
  const document = path.join(root, 'saved.henji-canvas'); await fs.writeFile(document, JSON.stringify({ image: 'D:/held.png' }))
  const files: string[] = []
  await scanReferenceFiles([{ path: root, exclude: [generated] }, { path: document }], ['.henji-canvas'], new AbortController().signal, async file => { files.push(file) })
  expect(files).toEqual([document])
  await expect(scanReferenceFiles([{ path: path.join(generated, 'unrelated.henji-canvas') }], ['.henji-canvas'], new AbortController().signal, async () => undefined)).rejects.toThrow()
})
