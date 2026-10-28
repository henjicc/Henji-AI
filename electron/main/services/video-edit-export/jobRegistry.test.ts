import { EventEmitter } from 'node:events'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { VideoEditExportJobRegistry, watchVideoEditExportSender, type VideoEditExportPage, type VideoEditExportRegistryLimits } from './jobRegistry'

vi.mock('../logging', () => ({ createMainLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }))

let root: string
const oldPage: VideoEditExportPage = { senderId: 1, pageId: 'page-before' }
const newPage: VideoEditExportPage = { senderId: 1, pageId: 'page-after' }
const files = {
  createExclusive: (target: string) => fs.writeFile(target, new Uint8Array(), { flag: 'wx' }),
  async identify(target: string) {
    try { const stats = await fs.lstat(target, { bigint: true }); return stats.isFile() ? { dev: stats.dev, ino: stats.ino, birthtimeNs: stats.birthtimeNs } : null } catch { return null }
  },
  remove: (target: string) => fs.rm(target),
}
const registry = (limits?: VideoEditExportRegistryLimits): VideoEditExportJobRegistry => new VideoEditExportJobRegistry(files, limits)
const job = (id: string, outputs: string[], snapshotIndex: number | undefined = 0, restorable = true) => ({ id, projectId: 'project', name: '序列', presetName: '默认', outputPaths: outputs, restorable, snapshotIndex, payload: { settings: id } })
const exists = (target: string): Promise<boolean> => fs.access(target).then(() => true, () => false)
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-export-registry-')) })
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }) })

it('换页时正在跑的项标成中断并只删主进程替本项创建的文件，排队项交给新页面接管', async () => {
  const exports = registry()
  const running = path.join(root, 'running.mp4'); const caption = path.join(root, 'running.srt'); const queued = path.join(root, 'queued.mp4')
  expect(exports.register(oldPage, { snapshots: [JSON.stringify({ id: 'sequence' })], jobs: [job('a', [running, caption]), job('b', [queued])] })).toEqual([{ id: 'a', retained: true }, { id: 'b', retained: true }])
  exports.update(oldPage, { id: 'a', state: 'running', progress: .4 })
  await exports.createOutput(oldPage, 'a', running)
  // 字幕路径上有别人的文件：本项没创建过它，绝不能删；也不能经登记覆盖它。
  await fs.writeFile(caption, 'someone else')
  await expect(exports.createOutput(oldPage, 'a', caption)).rejects.toThrow()
  await expect(exports.createOutput(oldPage, 'a', path.join(root, 'other.mp4'))).rejects.toThrow('不属于')
  const restored = await exports.restore(newPage)
  expect(await exists(running)).toBe(false); expect(await fs.readFile(caption, 'utf8')).toBe('someone else')
  expect(restored.map(value => [value.id, value.state])).toEqual([['a', 'interrupted'], ['b', 'queued']])
  expect(restored[1]).toMatchObject({ snapshotJson: JSON.stringify({ id: 'sequence' }), payload: { settings: 'b' } })
  // 旧页面迟到的进度和创建都不再生效。
  exports.update(oldPage, { id: 'a', state: 'failed', progress: .5 })
  await expect(exports.createOutput(oldPage, 'a', running)).rejects.toThrow('接管')
  expect(await exists(running)).toBe(false)
  expect(exports.list().find(value => value.id === 'a')?.state).toBe('interrupted')
  expect(await exports.restore({ senderId: 2, pageId: 'another' })).toEqual([])
})

it('被拦下的导航不触发中断；只有渲染进程退出或销毁才算离开', async () => {
  const exports = registry(); const sender = new EventEmitter()
  watchVideoEditExportSender(sender, oldPage.senderId, exports)
  const output = path.join(root, 'live.mp4')
  exports.register(oldPage, { snapshots: ['{}'], jobs: [job('a', [output])] })
  exports.update(oldPage, { id: 'a', state: 'running', progress: .2 })
  await exports.createOutput(oldPage, 'a', output)
  for (const event of ['will-navigate', 'did-start-navigation', 'did-fail-load']) sender.emit(event, {}, 'file:///dropped.png', false, true)
  await Promise.resolve()
  expect(await exists(output)).toBe(true)
  exports.update(oldPage, { id: 'a', state: 'running', progress: .6 })
  expect(exports.list()[0]).toMatchObject({ state: 'running', progress: .6 })
  sender.emit('render-process-gone', {}, { reason: 'crashed' })
  await vi.waitFor(async () => expect(await exists(output)).toBe(false))
  expect(exports.list()[0].state).toBe('interrupted')
})

it('同一路径换成了别的文件、或成片已发布，都不删除', async () => {
  const exports = registry()
  const replaced = path.join(root, 'replaced.mp4'); const published = path.join(root, 'published.mp4')
  exports.register(oldPage, { snapshots: ['{}'], jobs: [job('a', [replaced]), job('b', [published])] })
  for (const id of ['a', 'b']) exports.update(oldPage, { id, state: 'running', progress: 0 })
  await exports.createOutput(oldPage, 'a', replaced)
  await fs.rm(replaced); await fs.writeFile(path.join(root, 'spacer'), 'x'); await fs.writeFile(replaced, 'theirs')
  await exports.createOutput(oldPage, 'b', published); exports.outputPublished(oldPage, 'b')
  await exports.leave(oldPage.senderId, 'destroyed')
  expect(await fs.readFile(replaced, 'utf8')).toBe('theirs'); expect(await exists(published)).toBe(true)
  expect(exports.list().map(value => [value.id, value.state])).toEqual([['a', 'interrupted'], ['b', 'failed']])
})

it('创建进行中页面离开：创建完成后立刻清理；重试前清掉清理失败留下的本项文件', async () => {
  let failRemove = true
  const exports = new VideoEditExportJobRegistry({ ...files, remove: async target => { if (failRemove) throw new Error('busy'); await fs.rm(target) } })
  const output = path.join(root, 'leftover.mp4')
  exports.register(oldPage, { snapshots: ['{}'], jobs: [job('a', [output])] })
  exports.update(oldPage, { id: 'a', state: 'running', progress: 0 })
  await exports.createOutput(oldPage, 'a', output)
  await exports.restore(newPage)
  expect(await exists(output)).toBe(true)
  failRemove = false
  exports.update(newPage, { id: 'a', state: 'queued', progress: 0 })
  await exports.discardLeftovers(newPage, 'a')
  expect(await exists(output)).toBe(false)
  // 迟到创建：创建期间被新页面接管。
  const late = path.join(root, 'late.mp4')
  const racing = new VideoEditExportJobRegistry({ ...files, createExclusive: async target => { await files.createExclusive(target); await racing.restore({ senderId: 1, pageId: 'third' }) } })
  racing.register(oldPage, { snapshots: ['{}'], jobs: [job('b', [late])] })
  racing.update(oldPage, { id: 'b', state: 'running', progress: 0 })
  await racing.createOutput(oldPage, 'b', late)
  expect(await exists(late)).toBe(false)
})

it('快照先按字节数判断单份与本批合计，其余按内容去重；超限的项不保留但输出文件仍受保护', async () => {
  const exports = registry({ jobs: 10, snapshotBytes: 100, totalSnapshotBytes: 200, payloadChars: 1000 })
  const medium = JSON.stringify({ text: 'y'.repeat(80) })
  const results = exports.register(oldPage, { snapshots: [medium, medium, JSON.stringify({ text: 'x'.repeat(200) }), JSON.stringify({ text: 'z'.repeat(80) })], jobs: [job('a', [path.join(root, 'a.mp4')], 0), job('b', [path.join(root, 'b.mp4')], 1), job('c', [path.join(root, 'c.mp4')], 2), job('d', [path.join(root, 'd.mp4')], 3)] })
  expect(results).toEqual([{ id: 'a', retained: true }, { id: 'b', retained: true }, { id: 'c', retained: false, reason: 'snapshot_too_large' }, { id: 'd', retained: false, reason: 'registry_full' }])
  const output = path.join(root, 'c.mp4')
  exports.update(oldPage, { id: 'c', state: 'running', progress: 0 })
  await exports.createOutput(oldPage, 'c', output)
  await exports.leave(oldPage.senderId, 'destroyed')
  expect(await exists(output)).toBe(false)
  expect((await exports.restore(newPage)).map(value => value.id)).toEqual(['a', 'b'])
})

it('取消后仍有本项未删掉的文件：保留登记，界面离开时按身份清理且不再恢复', async () => {
  const exports = registry()
  const output = path.join(root, 'cancelled.mp4')
  exports.register(oldPage, { snapshots: ['{}'], jobs: [job('a', [output])] })
  exports.update(oldPage, { id: 'a', state: 'running', progress: .3 })
  await exports.createOutput(oldPage, 'a', output)
  exports.update(oldPage, { id: 'a', state: 'cancelled', progress: .3 })
  expect(exports.list().map(value => value.id)).toEqual(['a'])
  expect(await exports.restore(newPage)).toEqual([])
  expect(await exists(output)).toBe(false); expect(exports.list()).toEqual([])
})
