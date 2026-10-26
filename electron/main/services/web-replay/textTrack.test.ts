import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { readTextTrack, searchTextTrack, TEXT_TRACK_FILE, TextTrackWriter } from './textTrack'

let root = ''
afterEach(async () => { if (root) await fs.rm(root, { recursive: true, force: true }) })

it('文字轨只记变化；按文字搜出每次出现的起止时间与按画面比例的位置，换了位置算新的一次', async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-text-track-'))
  const writer = new TextTrackWriter(path.join(root, TEXT_TRACK_FILE))
  const screen = (items: Array<[string, number, number, number, number]>) => ({ width: 1280, height: 800, items })
  writer.write(0, screen([['准备检索', 110, 170, 60, 16]]))
  writer.write(200_000, screen([['准备检索', 110, 170, 60, 16]]))
  writer.write(1_000_000, screen([['元宝搜索 0.3 秒返回 20 条结果', 110, 188, 180, 16]]))
  writer.write(3_000_000, screen([['元宝搜索 0.3 秒返回 20 条结果，正在查阅 8 个来源', 110, 188, 240, 16]]))
  writer.write(4_000_000, screen([['元宝搜索 0.3 秒返回 20 条结果，正在查阅 8 个来源', 110, 240, 240, 16]]))
  await writer.close(5_000_000)
  const lines = (await fs.readFile(path.join(root, TEXT_TRACK_FILE), 'utf8')).trim().split('\n')
  expect(lines).toHaveLength(5)
  const found = await searchTextTrack(root, '0.3 秒返回 20', 10)
  expect(found.total).toBe(3)
  expect(found.matches.map(match => [match.fromSeconds, match.toSeconds])).toEqual([[1, 3], [3, 4], [4, 5]])
  expect(found.matches[0].rect).toEqual({ x: 110 / 1280, y: 188 / 800, width: 180 / 1280, height: 16 / 800 })
  expect((await searchTextTrack(root, '元宝搜索', 1)).matches).toHaveLength(1)
  const snapshots = await readTextTrack(root, 0, 10)
  expect(snapshots.total).toBe(4)
  expect(snapshots.entries[0]).toMatchObject({ seconds: 0, items: [['准备检索', 110, 170, 60, 16]] })
})

it('还没有文字轨时说明先重演出文字轨', async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-text-track-'))
  await expect(searchTextTrack(root, '任何字', 10)).rejects.toThrow('textOnly')
})
