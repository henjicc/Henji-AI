import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => ({ fail: false, renders: [] as Array<Record<string, unknown>> }))
vi.mock('./player/player', () => ({
  WebRecordingPlayer: {
    open: () => ({
      async render(options: { output: string; textTrack: string; boxTrack: string; fps?: number }) {
        fake.renders.push(options)
        await fs.writeFile(options.output, 'video')
        await fs.writeFile(options.boxTrack, '{"t":0,"width":10,"height":10,"items":[]}\n')
        await fs.writeFile(options.textTrack, '{"t":0,"width":10,"height":10,"items":[]}\n')
        if (fake.fail) throw new Error('已取消重演')
        return {
          output: options.output, frames: 30, width: 3840, height: 2464, durationMs: 1000, issues: [{ t: 0, kind: 'warning', message: 'x' }], looseMatches: 0, unusedCalls: 0, locatorMisses: 0,
          takeTracks: { behavior: [{ kind: 'text', t: 100_000, data: '你' }], timeMap: { version: 1, fps: 30, durationUs: 1_000_000, frames: 30, pieces: [], cuts: [], frameRecUs: [] }, steps: ['typewriter[0]（逐字打字）'] },
        }
      },
    }),
  },
}))

import { listWebReplayTakes, readWebReplayTake, readWebReplayTakeBehavior, readWebReplayTakeDirector, renderWebReplayTake, takeDirectory } from './takes'
import { parseWebReplayDirector } from '../../../../src/core/webReplay/director'

let root = ''
afterEach(async () => { fake.fail = false; fake.renders = []; if (root) await fs.rm(root, { recursive: true, force: true }) })

const director = parseWebReplayDirector({ version: 1, typewriter: [{ at: 1 }] })
const request = { recordingId: 'rec', name: '首问', director, fps: 30, pointer: false }

it('版本写进 takes/<名字>/：视频、轨道、行为轨、时间对照、导演稿与清单都在，录制文件夹不动', async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-take-'))
  await fs.writeFile(path.join(root, 'boxes.jsonl'), 'recording boxes\n')
  const { take } = await renderWebReplayTake(root, request)
  expect(take.directory).toBe(path.join(root, 'takes', '首问'))
  expect((await fs.readdir(take.directory)).sort()).toEqual(['behavior.json', 'boxes.jsonl', 'director.json', 'take.json', 'text.jsonl', 'timemap.json', 'video.mp4'])
  expect(take).toMatchObject({ name: '首问', frames: 30, durationUs: 1_000_000, pointer: false, video: true, conflicts: 0, warnings: 1, videoPath: path.join(take.directory, 'video.mp4') })
  expect(await readWebReplayTakeBehavior(take.directory)).toEqual([{ kind: 'text', t: 100_000, data: '你' }])
  expect(await readWebReplayTakeDirector(take.directory)).toEqual(director)
  expect(await fs.readFile(path.join(root, 'boxes.jsonl'), 'utf8')).toBe('recording boxes\n')
  expect((await listWebReplayTakes(root)).map(item => item.name)).toEqual(['首问'])
  expect((await readWebReplayTake(root, '首问')).frames).toBe(30)
})

it('同名重出：新版本完整写好才换上；失败或取消时旧版本原样保留、暂存清掉', async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-take-replace-'))
  const { take } = await renderWebReplayTake(root, request)
  await fs.writeFile(path.join(take.directory, 'video.mp4'), 'old video')
  fake.fail = true
  await expect(renderWebReplayTake(root, request)).rejects.toThrow('已取消重演')
  expect(await fs.readFile(path.join(take.directory, 'video.mp4'), 'utf8')).toBe('old video')
  expect(await fs.readdir(path.join(root, 'takes'))).toEqual(['首问'])
  fake.fail = false
  await renderWebReplayTake(root, request)
  expect(await fs.readFile(path.join(take.directory, 'video.mp4'), 'utf8')).toBe('video')
  expect(await fs.readdir(path.join(root, 'takes'))).toEqual(['首问'])
})

it('只出轨道时没有视频；版本名不能跳出 takes/', async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-take-text-'))
  const { take } = await renderWebReplayTake(root, { ...request, name: '轨道', textOnly: true })
  expect(take.videoPath).toBeNull()
  expect(fake.renders[0]).toMatchObject({ video: false, output: path.join(root, 'takes', `.轨道.${(fake.renders[0].output as string).split('.轨道.')[1]}`) })
  expect(() => takeDirectory(root, '../外面')).toThrow('版本名不对')
  expect(() => takeDirectory(root, '.隐藏')).toThrow('版本名不对')
  await expect(readWebReplayTake(root, '没有')).rejects.toThrow('没有叫“没有”的版本')
})
