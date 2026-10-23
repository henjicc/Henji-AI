import { afterEach, expect, it, vi } from 'vitest'
import { ALL_FORMATS, AudioSampleSink, BufferSource, Input } from 'mediabunny'
import type { RecordingTrackSegment } from '@/core/screenRecording/tracks'
import { createTrackOutput } from './output'

const files = vi.hoisted(() => new Map<string, Uint8Array>())
vi.mock('@/platform', () => ({ getPlatform: () => ({ system: { paths: { join: async (...parts: string[]) => parts.join('/') }, fs: {
  writeFile: async (path: string, bytes: Uint8Array, options?: { exclusive?: boolean; position?: number }) => {
    if (options?.exclusive && files.has(path)) throw new Error('exists')
    const old = files.get(path) ?? new Uint8Array(); const offset = options?.position ?? 0
    const next = new Uint8Array(Math.max(old.length, offset + bytes.length)); next.set(old); next.set(bytes, offset); files.set(path, next)
  },
} } }) }))
afterEach(() => { files.clear(); vi.unstubAllGlobals() })
it('摄像头编码能力不足明确拒绝，不留下虚假分段或空文件', async () => {
  const probe = vi.fn(async () => ({ supported: false }))
  vi.stubGlobal('VideoEncoder', { isConfigSupported: probe })
  const output = createTrackOutput('camera', 'temp', 30, vi.fn())
  await expect(output.video({ displayWidth: 640, displayHeight: 480 } as VideoFrame, 0, 0, 0)).rejects.toThrow('无法编码摄像头')
  expect(probe).toHaveBeenCalledTimes(2); expect(files.size).toBe(0)
})
it.each([16, 24, 32] as const)('正式Mediabunny输出 %s 位双声道WAV并回读，保留声道与暂停空隙', async bitDepth => {
  const segments: RecordingTrackSegment[] = []
  const output = createTrackOutput('microphone', 'temp', 30, async segment => { segments.push(segment) })
  const samples = new Float32Array(4800 * 2)
  for (let i = 0; i < samples.length; i += 2) { samples[i] = .25; samples[i + 1] = -.5 }
  await output.audio({ firstFrame: 0, samples, sampleRate: 48000, channels: 2, bitDepth, monoStartUs: 500_000, uncertaintyUs: 12 })
  await output.audio({ firstFrame: 4800, samples, sampleRate: 48000, channels: 2, bitDepth, monoStartUs: 5_600_000, uncertaintyUs: 15 })
  await output.close()
  expect(segments.map(segment => segment.monoSpanUs)).toEqual([[500_000, 600_000], [5_600_000, 5_700_000]])
  for (const segment of segments) {
    const input = new Input({ formats: ALL_FORMATS, source: new BufferSource(files.get(`temp/${segment.file}`)!) })
    try {
      const track = await input.getPrimaryAudioTrack(); expect(track!.numberOfChannels).toBe(2)
      expect(track!.codec).toBe(bitDepth === 32 ? 'pcm-f32' : bitDepth === 24 ? 'pcm-s24' : 'pcm-s16')
      expect(await input.computeDuration()).toBeCloseTo(.1, 5)
      const sample = await new AudioSampleSink(track!).getSample(0)
      try {
        const decoded = new Float32Array(sample!.numberOfFrames * 2)
        sample!.copyTo(decoded, { planeIndex: 0, format: 'f32' })
        expect(decoded[0]).toBeCloseTo(.25, 3); expect(decoded[1]).toBeCloseTo(-.5, 3)
      } finally { sample?.close() }
      expect(segment.anchors[0]).toMatchObject({ audioSample: 0, audioRate: 48000, monoUs: segment.monoSpanUs[0] })
    } finally { input.dispose() }
  }
})
