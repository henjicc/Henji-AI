import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { BOX_TRACK_FILE, BoxTrackWriter, type BoxItem } from './boxTrack'
import { readBoxTrack } from './boxTrackReader'

let root = ''
afterEach(async () => { if (root) await fs.rm(root, { recursive: true, force: true }); root = '' })

async function fixture(): Promise<void> {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-box-read-'))
  const writer = new BoxTrackWriter(path.join(root, BOX_TRACK_FILE))
  const node: BoxItem = ['node-a', 100.5, 100, 200, 50], other: BoxItem = ['act:open#0', 0, 0, 10, 20]
  await writer.write(0, { width: 1000, height: 500, items: [node, other] })
  await writer.write(100_000, { width: 1000, height: 500, items: [node, ['act:open#0', 10, 0, 10, 20]] })
  await writer.write(200_000, { width: 1000, height: 500, items: [['node-a', 200.5, 100, 300, 100], other] })
  await writer.write(300_000, { width: 2000, height: 1000, items: [['node-a', 200.5, 100, 300, 100]] })
  await writer.write(400_000, { width: 2000, height: 1000, items: [] })
  await writer.write(500_000, { width: 2000, height: 1000, items: [['node-a', -100, 950, 300, 200]] })
  await writer.close(600_000)
}

it('返回每个键的变化点、消失与再出现；CSS 坐标按当时视口换算、出界裁切', async () => {
  await fixture()
  const result = await readBoxTrack(root, { key: 'node-a' }, 0, 200)
  expect(result.entries).toEqual([
    { key: 'node-a', seconds: 0, rect: { x: 0.1005, y: 0.2, width: 0.2, height: 0.1 } },
    { key: 'node-a', seconds: 0.2, rect: { x: 0.2005, y: 0.2, width: 0.3, height: 0.2 } },
    { key: 'node-a', seconds: 0.3, rect: { x: 0.10025, y: 0.1, width: 0.15, height: 0.1 } },
    { key: 'node-a', seconds: 0.4, rect: null },
    { key: 'node-a', seconds: 0.5, rect: { x: 0, y: 0.95, width: 0.1, height: 0.05 } },
    { key: 'node-a', seconds: 0.6, rect: null },
  ])
  expect(result.total).toBe(6)
  expect(result.nextOffset).toBeNull()
})

it('前缀、精确键、闭区间时间与分页组合过滤；中途起点补已有位置', async () => {
  await fixture()
  const query = { keyPrefix: 'node-', fromSeconds: 0.15, toSeconds: 0.4 }
  const first = await readBoxTrack(root, query, 0, 2)
  const second = await readBoxTrack(root, query, first.nextOffset!, 2)
  expect(first.total).toBe(4)
  expect(first.nextOffset).toBe(2)
  expect([...first.entries, ...second.entries].map(e => e.seconds)).toEqual([0.15, 0.2, 0.3, 0.4])
  expect(second.nextOffset).toBeNull()
  expect((await readBoxTrack(root, { key: 'node-a', keyPrefix: 'act:' }, 0, 10)).total).toBe(0)
  expect((await readBoxTrack(root, { key: 'node-a', fromSeconds: 0.1, toSeconds: 0.1 }, 0, 10)).entries).toHaveLength(1)
  expect((await readBoxTrack(root, { fromSeconds: 1 }, 0, 10)).total).toBe(0)
  expect((await readBoxTrack(root, {}, 100, 10)).entries).toEqual([])
  await expect(readBoxTrack(root, { fromSeconds: 2, toSeconds: 1 }, 0, 10)).rejects.toThrow('toSeconds')
  await expect(readBoxTrack(root, {}, 0, 201)).rejects.toThrow()
})

it('没有 boxes 的旧录制报出明确重演指引，读取不创建或改写文件', async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-box-old-'))
  await fs.writeFile(path.join(root, 'recording.json'), '{"version":3}')
  await expect(readBoxTrack(root, {}, 0, 10)).rejects.toThrow('先用 render_web_app_replay 重演一遍（可 textOnly=true）')
  expect(await fs.readdir(root)).toEqual(['recording.json'])
  expect(await fs.readFile(path.join(root, 'recording.json'), 'utf8')).toBe('{"version":3}')
})

it('损坏行明确拒绝并给出恢复方法，不输出 NaN 或悄悄跳过', async () => {
  await fixture()
  await fs.writeFile(path.join(root, BOX_TRACK_FILE), '{"t":0,"width":0,"height":0,"items":[["bad",1,1,2,2]]}\n')
  await expect(readBoxTrack(root, {}, 0, 10)).rejects.toThrow('第 1 行无法读取')
})
