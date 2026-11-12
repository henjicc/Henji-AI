import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { runAudioEditEffectsWorker, type AudioEditEffectsWorkerJob } from './effects-worker-client'

/* 用极小的真实线程脚本走一遍线程入口：完成与进度、报错、非零退出、取消。 */

let directory = ''
const job: AudioEditEffectsWorkerJob = { kind: 'gains', input: 'in.wav', output: 'out.wav', layers: [] }
async function script(name: string, body: string): Promise<string> {
  const file = path.join(directory, `${name}.cjs`)
  await fs.writeFile(file, `const { parentPort, workerData } = require('node:worker_threads')\n${body}\n`)
  return file
}
beforeAll(async () => { directory = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-effects-worker-')) })
afterAll(() => fs.rm(directory, { recursive: true, force: true }))

it('完成时带回进度，收到的是原样的活', async () => {
  const progress: number[] = []
  await runAudioEditEffectsWorker(job, undefined, value => progress.push(value),
    await script('done', "parentPort.postMessage({ type: 'progress', value: workerData.kind === 'gains' ? 0.5 : 0 }); parentPort.postMessage({ type: 'done' })"))
  expect(progress).toEqual([0.5])
})

it('线程报错、非零退出、没说完成就退出都变成失败', async () => {
  await expect(runAudioEditEffectsWorker(job, undefined, undefined, await script('error', "parentPort.postMessage({ type: 'error', message: '读不了' })"))).rejects.toThrow('声音处理失败：读不了')
  await expect(runAudioEditEffectsWorker(job, undefined, undefined, await script('exit', 'process.exit(3)'))).rejects.toThrow('声音处理未完成：3')
  await expect(runAudioEditEffectsWorker(job, undefined, undefined, await script('silent', ''))).rejects.toThrow('提前结束')
})

it('取消时结束线程并按取消原因失败', async () => {
  const controller = new AbortController()
  const running = runAudioEditEffectsWorker(job, controller.signal, () => controller.abort(new Error('用户取消')),
    await script('hang', "parentPort.postMessage({ type: 'progress', value: 0.1 }); setInterval(() => undefined, 1000)"))
  await expect(running).rejects.toThrow('用户取消')
})
