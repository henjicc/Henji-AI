import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createVideoEditSequence, type VideoEditClip, type VideoEditComposition } from '@/core/videoEdit/document'
import { activeVideoEditEffects } from '@/core/videoEdit/compositing'
import type { CodeAuthorProgram } from '@/core/videoEdit/codeAuthorProgram'
import type { GpuDevice, GpuTexture } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import type { AuthorFrameInfo, AuthorGpuInputs } from './videoEditAuthorModule'
import type { PreparedVideoEditEffect } from './videoEditCodeSources'
import { VideoEditCodePicture } from './videoEditCodePicture'
import { VideoEditRenderer } from './videoEditRenderer'

const state = vi.hoisted(() => ({ calls: [] as Array<{ name: string; time: number; input: number; frames: Array<{ offset: number; value: number; available: boolean }> }>, references: [] as string[][], output: 0, fail: false, disposed: 0 }))
vi.mock('./videoEditTrackResults', async original => {
  const actual = await original<typeof import('./videoEditTrackResults')>()
  return { ...actual, applyVideoEditClipFollow: (...args: Parameters<typeof actual.applyVideoEditClipFollow>) => {
    state.references.push(args[0].clips.map(clip => clip.id))
    return actual.applyVideoEditClipFollow(...args)
  } }
})
vi.mock('@/core/logging', () => ({ createLogger: () => ({ debug: vi.fn(), warn: vi.fn() }) }))
const values = new WeakMap<GpuTexture, number>(), device = {} as GpuDevice
function picture(width: number, height: number, value = 0, format: VideoEditCodePicture['textureFormat'] = 'rgba8unorm'): VideoEditCodePicture {
  const texture = { createView: () => ({}), destroy: vi.fn() }; values.set(texture, value)
  return new VideoEditCodePicture(texture, width, height, device, format)
}
const pixel = (input: VideoEditCodePicture): number => values.get(input.texture)!
vi.mock('./videoEditGpuCompositor', () => ({ VideoEditGpuCompositor: class {
  private targets = new Map<string, VideoEditCodePicture>()
  fork() { return new this.constructorClass() }
  private get constructorClass() { return this.constructor as new () => typeof this }
  prepareImages() { return new Map() }
  setPictureDivisor() {}
  cancelPresentation() {}
  async dispose() { state.disposed++ }
  async code() {
    return {
      target: async (key: string, width: number, height: number, format?: VideoEditCodePicture['textureFormat']) => {
        if (!this.targets.has(key)) this.targets.set(key, picture(width, height, 0, format))
        return this.targets.get(key)!
      },
      releaseNestedFrames: (keep: Set<string>) => { for (const key of this.targets.keys()) if (key.startsWith('nested:') && !keep.has(key)) this.targets.delete(key) },
      authorFilter: async (_key: string, _instance: string, program: CodeAuthorProgram, _parameters: unknown, input: VideoEditCodePicture, info: AuthorFrameInfo, frames: AuthorGpuInputs['frames']) => {
        if (state.fail && program.name === 'first') throw new Error('前序滤镜失败')
        expect(input.owner).toBe(device)
        const samples = frames.map(value => ({ offset: value.offset, value: values.get(value.texture)!, available: value.available }))
        state.calls.push({ name: program.name, time: info.time, input: pixel(input), frames: samples })
        return picture(input.width, input.height, program.name === 'first' ? pixel(input) * 2 : pixel(input) + samples.reduce((sum, value) => sum + value.value, 0), input.textureFormat)
      },
      mix: async (_key: string, a: VideoEditCodePicture, b: VideoEditCodePicture, amount: number) => picture(a.width, a.height, pixel(a) * (1 - amount) + pixel(b) * amount),
    }
  }
  async draw(_document: unknown, clips: VideoEditClip[], pictures: VideoEditCodePicture[], current: () => boolean, _deadline: unknown, target?: VideoEditCodePicture) {
    const value = pictures.reduce((sum, input, index) => sum + pixel(input) * clips[index].opacity, 0)
    if (target) values.set(target.texture, value); else state.output = value
    return { presented: current(), completion: Promise.resolve() }
  }
} }))
vi.mock('./videoEditCodeSources', () => ({ VideoEditCodeSources: class {
  cancel() {}
  dispose() {}
  updateDocument() {}
  async prepareScenes() {}
  declarations() { return [] }
  async prepare(document: VideoEditComposition, clips: VideoEditClip[], frame: number, _current: unknown, images: Promise<unknown>) {
    await images
    const effects = new Map<string, PreparedVideoEditEffect[]>()
    for (const clip of clips) effects.set(clip.id, activeVideoEditEffects(clip).map(effect => {
      const program: CodeAuthorProgram = { apiVersion: 4, languageVersion: 4, name: effect.name, kind: 'filter', mode: 'dynamic', seed: 0, parameters: [], types: {}, frames: effect.name === 'first' ? [] : [-1, -.5, .5], hexColors: [], bundle: { code: '', map: '', locations: { layers: {} } } }
      return { effect, program, instanceKey: `${clip.id}:${effect.id}`, version: effect.id, parameters: {}, context: { time: frame / 60, localTime: frame / 60, sequenceTime: frame / 60, frame, fps: 60, width: document.width, height: document.height }, transitionHandles: false, info: { time: frame / 60, frameDuration: 1 / 60, clip: { time: frame / 60, duration: clip.duration / 60 } } }
    }))
    return { pictures: new Map(clips.filter(clip => clip.kind === 'code').map(clip => [clip.id, picture(document.width, document.height, clip.id === 'outside' ? 1000 : frame + 1)])), effects, sceneIssues: [], sourceTimestamps: [], cacheHits: 0 }
  }
} }))

function fixture(adjustment = false): VideoEditComposition {
  const clip = (id: string, track: number): VideoEditClip => ({ id, itemId: id, name: id, kind: 'code', track, start: 0, duration: 10, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 0, text: '', code: { definitionId: 'd', versionId: 'v', parameters: {} } })
  const source = clip('source', 1), owner = adjustment ? { ...clip('adjustment', 2), kind: 'adjustment' as const, code: undefined, opacity: .5, adjustment: { fromTrack: 1 } } : source
  owner.effects = ['first', 'temporal'].map(id => ({ id, name: id, enabled: true, amount: 1, code: { definitionId: 'd', versionId: id, parameters: {} } }))
  const sequence = createVideoEditSequence('滤镜')
  return { ...sequence, width: 100, height: 100, frameRate: { numerator: 60, denominator: 1 }, fps: 60, revision: 0, clips: adjustment ? [clip('outside', 0), source, owner] : [source], media: [], items: [], tracks: [0, 1, 2].map(index => ({ id: String(index), name: String(index), kind: 'video', index, enabled: true, locked: false, muted: true, solo: false })) }
}
beforeEach(() => {
  state.calls = []; state.references = []; state.output = 0; state.fail = false; state.disposed = 0
  vi.stubGlobal('OffscreenCanvas', class { constructor(public width: number, public height: number) {} })
})
afterEach(() => { vi.unstubAllGlobals() })
it('renders predecessor passes at exact fractional times on the same device', async () => {
  const renderer = new VideoEditRenderer(fixture())
  try {
    const result = await renderer.render(2); await result.completion
    expect(result.effectErrors).toEqual([])
    expect(state.calls.filter(value => value.name === 'first').map(value => value.time * 60)).toEqual([2, 1, 1.5, 2.5])
    expect(state.calls.at(-1)).toMatchObject({ name: 'temporal', input: 6, frames: [{ offset: -1, value: 4, available: true }, { offset: -.5, value: 5, available: true }, { offset: .5, value: 7, available: true }] })
    expect(state.output).toBe(22)
  } finally { await renderer.dispose() }
  expect(state.disposed).toBe(2)
})
it('reads only the adjustment band and applies its opacity once after the whole chain', async () => {
  const renderer = new VideoEditRenderer(fixture(true))
  try {
    await renderer.render(2)
    expect(state.calls.at(-1)?.frames.map(value => value.value)).toEqual([4, 5, 7])
    expect(state.output).toBe(1000 + (3 + 22) / 2)
    expect(state.references).toHaveLength(4)
    expect(state.references.every(ids => ids.join(',') === 'outside,source,adjustment')).toBe(true)
  } finally { await renderer.dispose() }
})
it('supplies transparent unavailable samples at a clip boundary instead of clamping to a different frame', async () => {
  const renderer = new VideoEditRenderer(fixture())
  try {
    await renderer.render(0)
    expect(state.calls.at(-1)?.frames[0]).toEqual({ offset: -1, value: 0, available: false })
  } finally { await renderer.dispose() }
})
it('samples predecessor source handles through a transition without blending the next clip into the input', async () => {
  const document = fixture()
  document.clips.push({ ...document.clips[0], id: 'next', start: 10, effects: undefined })
  document.transitions = [{ id: 'cut', kind: 'cross_dissolve', leftClipId: 'source', rightClipId: 'next', durationFrames: 4 }]
  const renderer = new VideoEditRenderer(document)
  try {
    const result = await renderer.render(9.5)
    expect(result.effectErrors).toEqual([])
    expect(state.calls.find(value => value.name === 'temporal')).toMatchObject({
      input: 21,
      frames: [{ offset: -1, value: 19, available: true }, { offset: -.5, value: 20, available: true }, { offset: .5, value: 22, available: true }],
    })
    expect(state.calls.filter(value => value.name === 'first').map(value => value.time * 60)).toEqual([9.5, 8.5, 9, 10])
  } finally { await renderer.dispose() }
})
it('does not feed a failed predecessor render to the temporal author', async () => {
  const renderer = new VideoEditRenderer(fixture()); state.fail = true
  try {
    const result = await renderer.render(2)
    expect(result.effectErrors).toHaveLength(2)
    expect(state.calls.some(value => value.name === 'temporal')).toBe(false)
  } finally { await renderer.dispose() }
})
