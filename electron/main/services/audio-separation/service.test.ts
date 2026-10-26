import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import type { AudioSeparationJobResult } from '../local-inference/separation/protocol'
import { float32WavHeader } from '../local-inference/separation/wav'
import { createContentDiskCache } from '../media/content-disk-cache'
import { AudioSeparationService, type AudioSeparationRun, type AudioSeparationServiceDependencies } from './service'

const root = path.join(os.tmpdir(), `henji-audio-separation-${process.pid}`)
afterAll(async () => { await fs.rm(root, { recursive: true, force: true }) })
let fixtures = 0

async function writeWav(file: string, sampleRate: number, channels: number, frames: number): Promise<void> {
  const header = float32WavHeader({ sampleRate, channels }, frames)
  const bytes = new Uint8Array(header.length + frames * channels * 4)
  bytes.set(header)
  await fs.writeFile(file, bytes)
}

function fixture(overrides: Partial<AudioSeparationServiceDependencies> = {}) {
  const directory = path.join(root, `cache-${++fixtures}`)
  const identities = new Map<string, string>([['voice.wav', 'identity-a']])
  const runs: AudioSeparationRun[] = []
  const logs: string[] = []
  const run = vi.fn(async (request: AudioSeparationRun, _signal: AbortSignal, progress: (value: number) => void): Promise<AudioSeparationJobResult> => {
    runs.push(request)
    progress(0.5)
    const primaryPath = path.join(request.outputDirectory, 'primary.wav.tmp'), residualPath = path.join(request.outputDirectory, 'residual.wav.tmp')
    await writeWav(primaryPath, 48_000, 1, 100); await writeWav(residualPath, 48_000, 1, 100)
    return { primaryPath, residualPath, sampleRate: 48_000, channels: 1, provider: 'dml', decodeMs: 1, inferenceMs: 2 }
  })
  const deps: AudioSeparationServiceDependencies = {
    cache: createContentDiskCache({ directory: () => directory, extension: '.wav' }),
    identify: async source => ({ path: source, identity: identities.get(source) ?? source }),
    modelSha256: mode => `sha-${mode}`,
    ensureModel: async mode => `${mode}.onnx`,
    run,
    log: (_level, _message, event) => { logs.push(event) },
    ...overrides,
  }
  return { service: new AudioSeparationService(deps), deps, directory, identities, runs, run, logs }
}

const signal = (): AbortSignal => new AbortController().signal

describe('人声分离服务', () => {
  it('第一次推理并改名进缓存（临时目录随即删除）；再次请求直接命中，不重复推理', async () => {
    const { service, directory, runs, run, logs } = fixture()
    const progress = vi.fn()
    const first = await service.separate('voice.wav', 'vocals', signal(), progress)
    expect(first).toMatchObject({ sampleRate: 48_000, channels: 1, cached: false, provider: 'dml' })
    expect(path.dirname(first.primaryPath)).toBe(directory)
    expect(first.primaryPath).toMatch(/[0-9a-f]{64}\.wav$/)
    expect(first.residualPath).not.toBe(first.primaryPath)
    expect(runs[0]).toMatchObject({ source: 'voice.wav', mode: 'vocals', modelPath: 'vocals.onnx' })
    expect(path.dirname(runs[0].outputDirectory)).toBe(directory)
    expect(progress).toHaveBeenCalledWith(0.5)
    expect((await fs.readdir(directory)).sort()).toEqual([path.basename(first.primaryPath), path.basename(first.residualPath)].sort())
    expect(logs).toContain('audio_separation.job.completed')
    const second = await service.separate('voice.wav', 'vocals', signal())
    expect(second).toEqual({ ...first, cached: true, provider: null })
    expect(run).toHaveBeenCalledTimes(1)
    expect(service.hasActiveJobs()).toBe(false)
  })

  it('同一素材同一方式并发请求共用一次计算；方式或模型不同分别缓存', async () => {
    let sha = 'one'
    const { service, run } = fixture({ modelSha256: () => sha })
    const [a, b] = await Promise.all([service.separate('voice.wav', 'dereverb', signal()), service.separate('voice.wav', 'dereverb', signal())])
    expect(a.primaryPath).toBe(b.primaryPath)
    expect(run).toHaveBeenCalledTimes(1)
    const vocals = await service.separate('voice.wav', 'vocals', signal())
    expect(vocals.primaryPath).not.toBe(a.primaryPath)
    sha = 'two'
    expect((await service.separate('voice.wav', 'dereverb', signal())).cached).toBe(false)
    expect(run).toHaveBeenCalledTimes(3)
  })

  it('分离期间文件被改写：报错且不写缓存', async () => {
    const holder: { identities?: Map<string, string> } = {}
    const { service, directory, identities } = fixture({
      run: async (request) => {
        holder.identities!.set('voice.wav', 'identity-b')
        const primaryPath = path.join(request.outputDirectory, 'primary.wav.tmp'), residualPath = path.join(request.outputDirectory, 'residual.wav.tmp')
        await writeWav(primaryPath, 44_100, 2, 10); await writeWav(residualPath, 44_100, 2, 10)
        return { primaryPath, residualPath, sampleRate: 44_100, channels: 2, provider: 'cpu', decodeMs: 0, inferenceMs: 0 }
      },
    })
    holder.identities = identities
    await expect(service.separate('voice.wav', 'vocals', signal())).rejects.toThrow('已改变')
    expect(await fs.readdir(directory)).toEqual([])
  })

  it('取消：中止后台作业，删除临时目录，不再算作忙碌', async () => {
    const controller = new AbortController()
    let seen: AbortSignal | undefined
    const { service, directory, logs } = fixture({
      run: (request, jobSignal) => new Promise((_resolve, reject) => {
        seen = jobSignal
        void fs.writeFile(path.join(request.outputDirectory, 'primary.wav.tmp'), 'partial')
        jobSignal.addEventListener('abort', () => reject(jobSignal.reason), { once: true })
      }),
    })
    const pending = service.separate('voice.wav', 'vocals', controller.signal)
    await vi.waitFor(() => expect(seen).toBeDefined())
    expect(service.hasActiveJobs()).toBe(true)
    controller.abort(new Error('已取消'))
    await expect(pending).rejects.toThrow('已取消')
    expect(seen!.aborted).toBe(true)
    await vi.waitFor(async () => { expect(await fs.readdir(directory)).toEqual([]); expect(service.hasActiveJobs()).toBe(false) })
    expect(logs).toContain('audio_separation.job.cancelled')
  })

  it('缓存里的结果坏了（只剩一个或文件头无效）就丢弃重算', async () => {
    const { service, run } = fixture()
    const first = await service.separate('voice.wav', 'vocals', signal())
    await fs.writeFile(first.residualPath, 'broken')
    const again = await service.separate('voice.wav', 'vocals', signal())
    expect(again.cached).toBe(false)
    await fs.rm(again.primaryPath)
    expect((await service.separate('voice.wav', 'vocals', signal())).cached).toBe(false)
    expect(run).toHaveBeenCalledTimes(3)
  })
})
