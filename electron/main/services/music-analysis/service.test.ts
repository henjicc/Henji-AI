import { describe, expect, it, vi } from 'vitest'
import { steadyMusicAnalysis } from '../../../../src/core/audioAnalysis/music/musicTestFixtures'
import type { ContentDiskCache } from '../media/content-disk-cache'
import { MusicAnalysisService, musicAnalysisIdentity, type MusicAnalysisServiceDependencies } from './service'

function memoryCache(): ContentDiskCache & { entries: Map<string, Uint8Array> } {
  const entries = new Map<string, Uint8Array>()
  const unsupported = (): never => { throw new Error('音乐分析不使用此缓存方法') }
  return { entries, read: async key => entries.get(key), write: async (key, bytes) => { entries.set(key, bytes) }, remove: async key => { entries.delete(key) }, locate: unsupported, prepareTemporary: unsupported, adopt: unsupported, prune: unsupported }
}

function setup(patch: Partial<MusicAnalysisServiceDependencies> = {}) {
  const cache = memoryCache()
  let identity = 'a'.repeat(64)
  const analysis = steadyMusicAnalysis()
  const run = vi.fn(async (_source: string, model: Parameters<MusicAnalysisServiceDependencies['run']>[1], _signal: AbortSignal, progress: (value: number) => void): ReturnType<MusicAnalysisServiceDependencies['run']> => { progress(1); return { analysis: { ...analysis, beatSource: model ? 'beat_this' : 'spectral_flux' }, provider: model ? 'dml' : null, decodeMs: 1, inferenceMs: 2, featureMs: 3 } })
  const ensureModel = vi.fn(async () => ({ modelPath: 'beat_this.onnx', filterbankPath: 'mel-filterbank.bin' }))
  const log = vi.fn()
  const service = new MusicAnalysisService({ cache, identify: async source => ({ path: source, identity }), ensureModel, run, log, ...patch })
  return { service, cache, run, ensureModel, log, setIdentity: (value: string) => { identity = value } }
}

describe('音乐结构分析服务', () => {
  it('首次用节拍模型分析并按内容身份缓存，第二次直接读缓存', async () => {
    const { service, run, ensureModel } = setup()
    const progress = vi.fn()
    const first = await service.analyze('/music/a.mp3', new AbortController().signal, progress)
    expect(first).toMatchObject({ cached: false, model: 'used', analysisIdentity: musicAnalysisIdentity('beat_this', 'a'.repeat(64)) })
    expect(first.analysis.beatSource).toBe('beat_this')
    expect(progress).toHaveBeenCalledWith({ phase: 'analyze', progress: 1 })
    const second = await service.analyze('/music/a.mp3', new AbortController().signal, () => undefined)
    expect(second).toMatchObject({ cached: true, model: 'used' })
    expect(run).toHaveBeenCalledTimes(1)
    expect(ensureModel).toHaveBeenCalledTimes(1)
  })

  it('模型不可用时用谱通量回退并单独缓存；模型可用后重新分析', async () => {
    const failing = vi.fn(async () => { throw new Error('offline') })
    const { service, run, cache, log } = setup({ ensureModel: failing })
    const fallback = await service.analyze('/music/a.mp3', new AbortController().signal, () => undefined)
    expect(fallback).toMatchObject({ cached: false, model: 'fallback', analysis: { beatSource: 'spectral_flux' } })
    expect(log).toHaveBeenCalledWith('warn', expect.any(String), 'music_analysis.model.unavailable', expect.any(Object))
    expect(await service.analyze('/music/a.mp3', new AbortController().signal, () => undefined)).toMatchObject({ cached: true, model: 'fallback' })
    const recovered = new MusicAnalysisService({ cache, identify: async source => ({ path: source, identity: 'a'.repeat(64) }), ensureModel: async () => ({ modelPath: 'm', filterbankPath: 'f' }), run, log })
    expect(await recovered.analyze('/music/a.mp3', new AbortController().signal, () => undefined)).toMatchObject({ cached: false, model: 'used', analysis: { beatSource: 'beat_this' } })
  })

  it('内容变化后不复用旧分析；分析期间文件被改写则拒绝写缓存', async () => {
    const { service, run, setIdentity, cache } = setup()
    await service.analyze('/music/a.mp3', new AbortController().signal, () => undefined)
    setIdentity('b'.repeat(64))
    expect(await service.analyze('/music/a.mp3', new AbortController().signal, () => undefined)).toMatchObject({ cached: false })
    expect(run).toHaveBeenCalledTimes(2)
    const racing = setup()
    racing.run.mockImplementationOnce(async () => { racing.setIdentity('c'.repeat(64)); return { analysis: steadyMusicAnalysis(), provider: null, decodeMs: 0, inferenceMs: 0, featureMs: 0 } })
    await expect(racing.service.analyze('/music/a.mp3', new AbortController().signal, () => undefined)).rejects.toThrow('已改变')
    expect(racing.cache.entries.size).toBe(0)
    expect(cache.entries.size).toBe(2)
  })

  it('损坏的缓存被丢弃并重新分析', async () => {
    const { service, cache, run } = setup()
    await service.analyze('/music/a.mp3', new AbortController().signal, () => undefined)
    for (const key of cache.entries.keys()) cache.entries.set(key, new TextEncoder().encode('{"version":1}'))
    expect(await service.analyze('/music/a.mp3', new AbortController().signal, () => undefined)).toMatchObject({ cached: false })
    expect(run).toHaveBeenCalledTimes(2)
  })
})
