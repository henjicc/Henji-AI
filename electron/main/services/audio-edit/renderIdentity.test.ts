import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { audioEditProjectSchema } from '../../../../src/core/audioEdit/schema'
import type { AudioEditProjectDocument } from '../../../../src/core/audioEdit/types'
import { migrateAudioEqualizerModes, migrateAudioMergedEffects } from '../../../../src/core/audio/effects/mergedEffectsMigration'
import { audioBuiltinIdentity } from '../../../../src/core/audio/effects/audioIdentity'

const state = vi.hoisted(() => ({ directory: '', effects: 0, declick: 0 }))
vi.mock('node:worker_threads', async () => {
  const { EventEmitter } = await import('node:events')
  return { Worker: class extends EventEmitter {
    constructor(_file: string, options: { workerData: { input: string; output: string } }) {
      super(); state.effects++
      void fs.copyFile(options.workerData.input, options.workerData.output).then(() => this.emit('message', { type: 'done' }))
    }
    async terminate() { return 0 }
  } }
})
vi.mock('./media', () => ({ audioEditCacheDirectory: () => state.directory, verifyAudioEditSource: vi.fn(), prepareAudioEditAudio: async () => path.join(state.directory, 'source.wav'), validateAudioEditAudio: vi.fn() }))
vi.mock('./dsp-adapter', async () => ({ ...await vi.importActual<typeof import('./dsp-adapter')>('./dsp-adapter'), runAudioMouthDeclick: async (input: string, output: string) => { state.declick++; await fs.copyFile(input, output) } }))
vi.mock('./processors', () => ({}))
vi.mock('../audio-separation/runtime', () => ({}))
vi.mock('../video/ffmpeg-loader', () => ({}))
import { prepareAudioEditRenderSource } from './render'
import { createF32WavWriter } from './pcm-wav'
import { audioRenderKey } from './render-cache'

let project: AudioEditProjectDocument
beforeEach(async () => {
  state.directory = await fs.mkdtemp(path.join(os.tmpdir(), 'audio-identity-')); state.effects = 0; state.declick = 0
  const writer = await createF32WavWriter(path.join(state.directory, 'source.wav'), 48000, 1, 48000)
  await writer.write(new Float32Array(48000).fill(.2)); await writer.close()
  project = { id: 'audio', name: '声音', source: { mediaType: 'audio', sourcePath: '/source.wav', audioPath: '/source.wav', durationFrames: 48000, sampleRate: 48000, channels: 1, identity: { digest: 'a'.repeat(64), size: 192000, mtimeMs: 1 } }, referenceScript: '', transcript: [], suggestions: [], revision: 1, createdAt: 1, updatedAt: 1,
    effectChain: [{ id: 'eq', kind: 'builtin', name: '均衡', enabled: true, amount: .7, builtin: { id: 'parametric_eq', params: { preset: 'warm', low: 3 } } }, { id: 'click', kind: 'mouth_declick', enabled: true, analyzed: true, sensitivity: 50, clicks: [{ startFrame: 1000, endFrame: 1100 }] }] }
})
afterEach(async () => { await fs.rm(state.directory, { recursive: true, force: true }) })

it.each(['beforeMerge', 'beforeEqualizer', 'current'] as const)('%s 的整段逐阶段缓存迁移后命中；剪切、重命名与重新打开不重处理，真改参数从受影响阶段重算', async phase => {
  const merged = migrateAudioMergedEffects(project)
  const current = audioEditProjectSchema.parse(migrateAudioEqualizerModes(merged)) as AudioEditProjectDocument
  const old = (phase === 'beforeMerge' ? project : phase === 'beforeEqualizer' ? merged : current).effectChain![0]
  if (old.kind !== 'builtin') throw new Error('测试输入必须包含均衡器')
  const effects = [{ builtin: audioBuiltinIdentity(old.builtin), amount: old.amount }]
  const source = path.join(state.directory, 'source.wav')
  const fx = path.join(state.directory, `fx-${audioRenderKey(['effects-v1', path.basename(source), effects])}.wav`)
  await fs.copyFile(source, fx)
  const base = audioRenderKey(['audio-render-v1', project.source.identity!.digest, 48000, 1, undefined])
  const upstream = audioRenderKey([base, 'realtime', effects])
  const output = path.join(state.directory, `declick-${audioRenderKey([upstream, ['mouth_declick-v1', [{ startFrame: 1000, endFrame: 1100 }]]])}.wav`)
  await fs.copyFile(fx, output)
  expect(await prepareAudioEditRenderSource(current)).toBe(output)
  expect(await prepareAudioEditRenderSource(current, undefined, { beforeItemId: 'click' })).toBe(fx)
  const reopened = audioEditProjectSchema.parse(JSON.parse(JSON.stringify(current))) as AudioEditProjectDocument
  reopened.effectChain![0].id = 'renamed'
  reopened.cuts = [{ id: 'cut', startFrame: 3000, endFrame: 4000, enabled: true, reason: 'manual' }]
  expect(await prepareAudioEditRenderSource(reopened)).toBe(output)
  expect([state.effects, state.declick]).toEqual([0, 0])
  const eq = reopened.effectChain![0]
  if (eq.kind !== 'builtin') throw new Error('测试输入必须包含均衡器')
  eq.builtin.params.simple_low = 8
  expect(await prepareAudioEditRenderSource(reopened)).not.toBe(output)
  expect([state.effects, state.declick]).toEqual([1, 1])
  expect(await prepareAudioEditRenderSource(reopened)).not.toBe(output)
  expect([state.effects, state.declick]).toEqual([1, 1])
})
