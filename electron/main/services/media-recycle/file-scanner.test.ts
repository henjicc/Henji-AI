import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { WorkerOptions } from 'node:worker_threads'
const workerMocks = vi.hoisted(() => ({ prefix: '' }))
vi.mock('node:worker_threads', async importOriginal => {
  const original = await importOriginal<typeof import('node:worker_threads')>()
  return { ...original, Worker: class extends original.Worker {
    constructor(file: string | URL, options?: WorkerOptions) { super(typeof file === 'string' && options?.eval ? workerMocks.prefix + file : file, options) }
  } }
})
import { scanReferenceFiles } from './file-scanner'

let root: string
beforeEach(async () => { workerMocks.prefix = ''; root = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-reference-scan-')) })
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }) })
it('无关 junction 不阻断，链接内作品的引用仍保护媒体且目录循环有界', async () => {
  const outside = path.join(root, 'outside'); const user = path.join(root, 'user')
  await fs.mkdir(outside); await fs.mkdir(user)
  await fs.writeFile(path.join(outside, 'saved.hjcvs'), JSON.stringify({ image: 'D:/managed/held.png' }))
  await fs.symlink(outside, path.join(user, 'link'), 'junction')
  await fs.symlink(user, path.join(outside, 'loop'), 'junction')
  const refs: string[] = []
  await scanReferenceFiles([{ path: user }], ['.hjcvs'], new AbortController().signal, async (_file, paths) => { refs.push(...paths) })
  expect(refs).toEqual(['D:/managed/held.png'])
})
it('无法解析的链接继续 fail-closed，其他作品仍扫描，取消扫描退出 worker', async () => {
  const target = path.join(root, 'target'); await fs.mkdir(target)
  await fs.symlink(target, path.join(root, 'broken'), 'junction'); await fs.rmdir(target)
  const document = path.join(root, 'saved.hjcvs'); await fs.writeFile(document, JSON.stringify({ image: 'D:/held.png' }))
  const refs: string[] = []
  const report = await scanReferenceFiles([{ path: root }], ['.hjcvs'], new AbortController().signal, async (_file, values) => { refs.push(...values) })
  expect(report.skippedLinks).toEqual([path.join(root, 'broken')])
  expect(report.unreadableLinks).toEqual([path.join(root, 'broken')])
  expect(refs).toEqual(['D:/held.png'])
  const controller = new AbortController(); controller.abort()
  await expect(scanReferenceFiles([{ path: root }], [], controller.signal, async () => undefined)).rejects.toThrow()
})
it.each(['ENOTDIR', 'ELOOP'])('跟随链接失败仅对循环链接免除保守保护：%s', async code => {
  const target = path.join(root, 'target'); await fs.mkdir(target)
  const link = path.join(root, 'unavailable'); await fs.symlink(target, link, 'junction')
  workerMocks.prefix = `
    const shim = require('node:fs/promises'), stat = shim.stat.bind(shim);
    shim.stat = async (file, ...args) => { if (String(file).endsWith('unavailable')) { const error = new Error('link unavailable'); error.code = '${code}'; throw error; } return stat(file, ...args); };
  `
  const report = await scanReferenceFiles([{ path: root, exclude: [target] }], ['.hjcvs'], new AbortController().signal, async () => undefined)
  expect(report.skippedLinks).toEqual([link])
  expect(report.unreadableLinks).toEqual(code === 'ELOOP' ? [] : [link])
})
it('作品根跳过受管目录，显式文档仍扫描，重复文件只解析一次', async () => {
  const generated = path.join(root, 'generated'); await fs.mkdir(generated)
  await fs.writeFile(path.join(generated, 'unrelated.hjcvs'), '{invalid')
  const document = path.join(root, 'saved.hjcvs'); await fs.writeFile(document, JSON.stringify({ image: 'D:/held.png' }))
  const files: string[] = []
  await scanReferenceFiles([{ path: root, exclude: [generated] }, { path: document }], ['.hjcvs'], new AbortController().signal, async file => { files.push(file) })
  expect(files).toEqual([document])
  await expect(scanReferenceFiles([{ path: path.join(generated, 'unrelated.hjcvs') }], ['.hjcvs'], new AbortController().signal, async () => undefined)).rejects.toThrow()
})

it('同一目录以不同排除范围登记时，后一个根仍能保护先前跳过的作品', async () => {
  const nested = path.join(root, 'nested'); await fs.mkdir(nested)
  const document = path.join(nested, 'saved.hjcvs')
  await fs.writeFile(document, JSON.stringify({ image: 'D:/managed/held.png' }))
  const files: string[] = []
  await scanReferenceFiles([{ path: root, exclude: [nested] }, { path: root }], ['.hjcvs'], new AbortController().signal, async file => { files.push(file) })
  expect(files).toEqual([document])
})

it('目录项误报为链接的云占位文件按 lstat 类型处理，无关占位文件无需跟随', async () => {
  await fs.writeFile(path.join(root, 'cloud.bin'), '{invalid')
  await fs.writeFile(path.join(root, 'cloud.hjcvs'), JSON.stringify({ image: 'D:/held.png' }))
  // 模拟 Windows Dirent 对重解析点的类型；lstat 仍使用真实文件系统，保持普通文件语义。
  workerMocks.prefix = `
    const shim = require('node:fs/promises');
    const open = shim.opendir.bind(shim), realpath = shim.realpath.bind(shim);
    shim.opendir = async (...args) => {
      const dir = await open(...args);
      return { async *[Symbol.asyncIterator]() { for await (const entry of dir) {
        if (entry.name.startsWith('cloud.')) { entry.isFile = () => false; entry.isSymbolicLink = () => true; }
        yield entry;
      } } };
    };
    shim.realpath = async file => { if (String(file).includes('cloud.')) throw new Error('placeholder has no link target'); return realpath(file); };
  `
  const refs: string[] = []
  const report = await scanReferenceFiles([{ path: root }], ['.hjcvs'], new AbortController().signal, async (_file, values) => { refs.push(...values) })
  expect(refs).toEqual(['D:/held.png'])
  expect(report.skippedLinks).toEqual([])
})

it.each(['stat', 'opendir', 'open'])('真实链接的元数据、目录或后代文件访问失败会报告不确定引用：%s', async operation => {
  const target = path.join(root, 'target'); await fs.mkdir(target)
  await fs.writeFile(path.join(target, 'disappeared.hjcvs'), '{}')
  const link = path.join(root, 'unreadable'); await fs.symlink(target, link, 'junction')
  workerMocks.prefix = `
    const shim = require('node:fs/promises'), read = shim.${operation}.bind(shim);
    shim.${operation} = async (file, ...args) => { if (String(file).endsWith('${operation === 'open' ? 'disappeared.hjcvs' : 'unreadable'}')) { const error = new Error('unreadable entry'); error.code = '${operation === 'open' ? 'ENOENT' : 'EACCES'}'; throw error; } return read(file, ...args); };
  `
  const report = await scanReferenceFiles([{ path: root, exclude: [target] }], ['.hjcvs'], new AbortController().signal, async () => undefined)
  expect(report.skippedLinks).toEqual([link])
  expect(report.unreadableLinks).toEqual([link])
})
