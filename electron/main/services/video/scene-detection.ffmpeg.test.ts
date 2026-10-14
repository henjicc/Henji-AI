import { afterEach, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { loadFfmpegPath } from './ffmpeg-loader'
import { runLoudnessFfmpeg } from '../audio/loudness'
import { createContentDiskCache } from '../media/content-disk-cache'
import { detectScenesFfmpeg, SceneDetectionService } from './scene-detection'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true }))) })
it('静止证据来自真实解码，尾段闭合且非零起点保持源时间', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-stillness-')); directories.push(directory)
  const source = path.join(directory, 'still.mkv'), binary = await loadFfmpegPath(), signal = new AbortController().signal
  await runLoudnessFfmpeg(['-y', '-f', 'lavfi', '-i', 'color=blue:s=128x72:r=30:d=5', '-c:v', 'ffv1', source], signal, binary)
  const cache = createContentDiskCache({ directory: () => path.join(directory, 'cache'), extension: '.json' })
  const service = new SceneDetectionService(cache, (request, signal, progress, _binary, onStillness) => detectScenesFfmpeg(request, signal, progress, binary, onStillness))
  const request = { requestId: 'stillness', source, startSeconds: 1, endSeconds: 5, sensitivity: 50, includeStillness: true }
  const result = await service.detect(request, signal, () => undefined)
  expect(result.cutsSeconds).toEqual([])
  expect(result.stillness).toEqual([{ startSeconds: 1, endSeconds: 5 }])
  expect(await service.detect({ ...request, requestId: 'cached' }, signal, () => undefined)).toEqual(result)
  expect((await service.detect({ ...request, includeStillness: false }, signal, () => undefined)).stillness).toBeUndefined()
  const shorter = await service.detect({ ...request, endSeconds: 7 }, signal, () => undefined)
  expect(shorter.stillness).toEqual([{ startSeconds: 1, endSeconds: 5 }])
}, 20000)
it.each(['30', '30000/1001'])('%s fps：纯色/测试图案硬切误差不超过一帧，非零源范围与持久缓存命中', async rate => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-scenes-')); directories.push(directory)
  const source = path.join(directory, 'cuts.mkv'); const binary = await loadFfmpegPath()
  const fps = rate === '30' ? 30 : 30000 / 1001; const duration = 30 / fps
  const signal = new AbortController().signal
  await runLoudnessFfmpeg(['-y', '-f', 'lavfi', '-i', `color=black:s=128x72:r=${rate}:d=${duration}`, '-f', 'lavfi', '-i', `color=white:s=128x72:r=${rate}:d=${duration}`, '-f', 'lavfi', '-i', `testsrc2=s=128x72:r=${rate}:d=${duration}`, '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]', '-map', '[v]', '-c:v', 'ffv1', source], signal, binary)
  const request = { requestId: 'test', source, startSeconds: 0, endSeconds: duration * 3, sensitivity: 50 }
  let runs = 0
  const cache = createContentDiskCache({ directory: () => path.join(directory, 'cache'), extension: '.json' })
  const service = new SceneDetectionService(cache, async (request, signal, progress) => { runs++; return detectScenesFfmpeg(request, signal, progress, binary) })
  const progress: number[] = []
  const result = await service.detect(request, signal, value => progress.push(value))
  expect(result.cutsSeconds).toHaveLength(2)
  result.cutsSeconds.forEach((time, index) => expect(Math.abs(time - duration * (index + 1))).toBeLessThanOrEqual(1 / fps))
  expect(progress.at(-1)).toBe(1)
  const freshService = new SceneDetectionService(cache, async () => { throw new Error('命中后不能重复解码') })
  expect(await freshService.detect({ ...request, requestId: 'another-caller' }, signal, () => undefined)).toEqual(result)
  expect(runs).toBe(1)
  const cropped = await service.detect({ ...request, startSeconds: 15 / fps }, signal, () => undefined)
  expect(cropped.cutsSeconds).toHaveLength(2)
  cropped.cutsSeconds.forEach((time, index) => expect(Math.abs(time - duration * (index + 1))).toBeLessThanOrEqual(1 / fps))
  const cancelled = new AbortController(); cancelled.abort(new Error('已取消'))
  await expect(service.detect(request, cancelled.signal, () => undefined)).rejects.toThrow('已取消')
}, 20000)
