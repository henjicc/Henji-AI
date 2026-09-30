import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createVideoEditDocument, videoEditComposition, type VideoEditClip } from '@/core/videoEdit/document'
import { VideoEditRenderer } from './videoEditRenderer'

const boundary = vi.hoisted(() => ({ disposed: [] as string[], pictures: [] as number[] }))
vi.mock('mediabunny', async () => {
  const actual = await vi.importActual<typeof import('mediabunny')>('mediabunny')
  return { ...actual,
    UrlSource: class { constructor(readonly path: string) {} },
    Input: class {
      readonly path: string
      constructor(options: { source: { path: string } }) { this.path = options.source.path }
      async getPrimaryVideoTrack() { return { path: this.path, getDecoderConfig: async () => ({ codec: 'avc1' }) } }
      async getPrimaryAudioTrack() { return { path: this.path } }
      dispose(): void { boundary.disposed.push(this.path) }
    },
    VideoSampleSink: class {
      constructor(readonly track: { path: string }) {}
      async getSample() { return { timestamp: this.track.path.includes('B') ? 2 : 1, close: vi.fn() } }
    },
    AudioSampleSink: class {
      constructor(readonly track: { path: string }) {}
      async *samples() { const path = this.track.path; yield { timestamp: 0, duration: 2, numberOfFrames: 96000, sampleRate: 48000, numberOfChannels: 2,
        copyTo(data: Float32Array, options: { planeIndex: number }): void { data.fill(path.includes('B') ? .75 : options.planeIndex === 0 ? .25 : .5) }, close: vi.fn() } }
    },
  }
})
vi.mock('./videoEditGpuCompositor', () => ({ VideoEditGpuCompositor: class {
  async draw(_document: unknown, _clips: unknown, pictures: Array<{ timestamp: number }>) { boundary.pictures = pictures.map(picture => picture.timestamp); return { presented: true, completion: Promise.resolve() } }
  async dispose(): Promise<void> {}
  cancelPresentation(): void {}
} }))
beforeEach(() => {
  boundary.disposed = []; boundary.pictures = []
  vi.stubGlobal('OffscreenCanvas', class { constructor(public width: number, public height: number) {} })
  vi.stubGlobal('VideoDecoder', { isConfigSupported: async () => ({ supported: true }) })
})
afterEach(() => { vi.unstubAllGlobals() })
function fixture(): ReturnType<typeof videoEditComposition> {
  const document = createVideoEditDocument('媒体绑定')
  document.media = ['A', 'B'].map(id => ({ id, name: id, path: `D:/${id}.mp4`, kind: 'video', width: 3840, height: 2160, durationSeconds: 2 }))
  document.items = document.media.map(media => ({ id: `item-${media.id}`, name: media.name, kind: media.kind, mediaId: media.id }))
  const clip: VideoEditClip = { id: 'clip', itemId: 'item-A', name: '片段', kind: 'video', track: 1, start: 0, duration: 60, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1, brightness: 1, text: '' }
  document.sequences[0].clips = [clip]
  return videoEditComposition(document, document.sequences[0].id)
}
it('修改项目项引用后画面与声音共同使用新素材，关闭旧解码输入', async () => {
  const document = fixture(); const renderer = new VideoEditRenderer(document)
  try {
    await renderer.render(0); expect(boundary.pictures).toEqual([1])
    expect((await renderer.mixAudio(0, .01))[0][0]).toBe(.25)
    await renderer.updateDocument({ ...document, clips: document.clips.map(clip => ({ ...clip, itemId: 'item-B' })) })
    expect(boundary.disposed).toEqual(['D:/A.mp4', 'D:/A.mp4'])
    await renderer.render(0); expect(boundary.pictures).toEqual([2])
    expect((await renderer.mixAudio(0, .01))[0][0]).toBe(.75)
  } finally { await renderer.dispose() }
  expect(boundary.disposed).toEqual(['D:/A.mp4', 'D:/A.mp4', 'D:/B.mp4', 'D:/B.mp4'])
})
it('44.1kHz 单声道实际混音包含两源声道，NTSC 分块样本边界连续', async () => {
  const document = { ...fixture(), sampleRate: 44100 as const, channels: 1 as const, frameRate: { numerator: 30000, denominator: 1001 }, fps: 30000 / 1001 }
  const renderer = new VideoEditRenderer(document)
  try {
    const duration = 30 / document.fps
    const first = await renderer.mixAudio(0, duration); const second = await renderer.mixAudio(duration, duration)
    expect(first).toHaveLength(1); expect(first[0][0]).toBe(.375)
    expect(first[0].length + second[0].length).toBe(Math.ceil(2 * duration * 44100 - 1e-7))
    await renderer.updateDocument({ ...document, tracks: document.tracks.map(track => ({ ...track, muted: true })) })
    expect((await renderer.mixAudio(0, .01))[0].every(sample => sample === 0)).toBe(true)
  } finally { await renderer.dispose() }
})
