import { AudioSample, AudioSampleSource, Mp4OutputFormat, Output, StreamTarget, VideoSample, VideoSampleSource, WavOutputFormat, type VideoEncodingConfig } from 'mediabunny'
import { getPlatform } from '@/platform'
import { videoEditExportVideoOptions, videoEditExportVideoEncoderConfig } from '@/features/videoEdit'
import type { CapturedAudioBlock } from '@/features/creativeIntent'
import type { RecordingTrackKind, RecordingTrackSegment } from '@/core/screenRecording/tracks'
import type { ClockAnchor } from '@/core/captureLog/clock'

/** Five second independent files keep WAV gap-free and drift corrections editable; never buffer a whole take. */
export const RECORDING_SEGMENT_US = 5_000_000
export interface TrackOutput {
  audio(block: CapturedAudioBlock): Promise<void>
  video(frame: VideoFrame, monoUs: number, uncertaintyUs: number, compensationUs: number): Promise<void>
  close(): Promise<void>
  cancel(): Promise<void>
}
export function createTrackOutput(kind: RecordingTrackKind, directory: string, frameRate: number, sealed: (segment: RecordingTrackSegment) => Promise<void>): TrackOutput {
  let active: { output: Output; audio?: AudioSampleSource; video?: VideoSampleSource; segment: RecordingTrackSegment } | undefined
  const anchor = (monoUs: number, uncertaintyUs: number, segment: RecordingTrackSegment): ClockAnchor => ({ monoUs, presentedFrame: null, requestedFrame: null, sequenceRef: null, visitRef: null, playbackDirection: 0, playbackRate: 1, playing: false, epoch: 0, uncertaintyUs,
    ...(segment.sampleRate ? { audioSample: segment.units, audioSegmentRef: segment.id, audioRate: segment.sampleRate } : {}) })
  const close = async (boundaryUs?: number): Promise<void> => {
    const previous = active; active = undefined
    if (!previous) return
    if (boundaryUs !== undefined) {
      previous.segment.monoSpanUs[1] = Math.min(previous.segment.monoSpanUs[1], boundaryUs)
      previous.segment.anchors = previous.segment.anchors.filter(point => point.monoUs <= previous.segment.monoSpanUs[1])
    }
    const segment = previous.segment
    if (segment.anchors.at(-1)?.monoUs !== segment.monoSpanUs[1]) segment.anchors.push(anchor(segment.monoSpanUs[1], segment.anchors.at(-1)?.uncertaintyUs ?? 0, segment))
    try { previous.audio?.close(); previous.video?.close(); await previous.output.finalize(); await sealed(previous.segment) }
    catch (error) { await previous.output.cancel(); throw error }
  }
  const open = async (monoUs: number, sampleRate?: number, channels?: number, width?: number, height?: number, bitDepth: 16 | 24 | 32 = 16): Promise<NonNullable<typeof active>> => {
    let videoOptions: VideoEncodingConfig | undefined
    if (kind === 'camera') {
      const settings = { codec: 'avc' as const, width: width!, height: height!, fps: frameRate, videoBitrateMbps: 4, bitrateMode: 'vbr' as const, encoderPreference: 'hardware' as 'hardware' | 'software', keyframeInterval: 2 as const }
      const probe = async (): Promise<boolean> => {
        const config = videoEditExportVideoEncoderConfig({ ...settings, frameRate, bitrate: 4_000_000 })
        return (await VideoEncoder.isConfigSupported({ ...config, latencyMode: 'realtime' })).supported === true
      }
      if (!await probe()) { settings.encoderPreference = 'software'; if (!await probe()) throw new Error('当前设备无法编码摄像头视频，请关闭摄像头后重试') }
      videoOptions = videoEditExportVideoOptions(settings)
    }
    const id = crypto.randomUUID(); const file = `${id}.${kind === 'camera' ? 'mp4' : 'wav'}`
    const fs = getPlatform().system.fs
    const path = await getPlatform().system.paths.join(directory, file)
    await fs.writeFile(path, new Uint8Array(), { exclusive: true })
    const output = new Output({ format: kind === 'camera' ? new Mp4OutputFormat({ fastStart: 'fragmented' }) : new WavOutputFormat(), target: new StreamTarget(new WritableStream({ write: chunk => fs.writeFile(path, chunk.data, { position: chunk.position }) }), { chunked: true, chunkSize: 256 * 1024 }) })
    const segment: RecordingTrackSegment = { id, file, monoSpanUs: [monoUs, monoUs], units: 0, latencyCompensationUs: 0, anchors: [], ...(sampleRate ? { sampleRate, channels } : { width, height }) }
    const current: NonNullable<typeof active> = { output, segment }
    if (videoOptions) {
      current.video = new VideoSampleSource({ ...videoOptions, latencyMode: 'realtime' }); output.addVideoTrack(current.video)
    } else { current.audio = new AudioSampleSource({ codec: bitDepth === 32 ? 'pcm-f32' : bitDepth === 24 ? 'pcm-s24' : 'pcm-s16' }); output.addAudioTrack(current.audio) }
    active = current
    try { await output.start() } catch (error) { active = undefined; await output.cancel(); throw error }
    return current
  }
  return {
    audio: async block => {
      const channels = block.channels ?? 1
      const frames = block.samples.length / channels
      if (active && (block.monoStartUs - active.segment.monoSpanUs[0] >= RECORDING_SEGMENT_US || active.segment.sampleRate !== block.sampleRate || active.segment.channels !== channels)) await close(block.monoStartUs)
      const current = active ?? await open(block.monoStartUs, block.sampleRate, channels, undefined, undefined, block.bitDepth)
      const segment = current.segment
      if (!segment.units) {
        segment.anchors.push(anchor(block.monoStartUs, block.uncertaintyUs, segment))
        segment.latencyCompensationUs = block.latencyCompensationUs ?? 0
        segment.sourceClockOffsetUs = block.monoStartUs - Math.round(block.firstFrame * 1_000_000 / block.sampleRate)
      }
      // WAV has no time gaps. Offset each real file in the session instead of padding it with silence.
      const sample = new AudioSample({ data: block.samples, format: 'f32', numberOfChannels: channels, sampleRate: block.sampleRate, timestamp: segment.units / block.sampleRate })
      try { await current.audio!.add(sample) } finally { sample.close() }
      segment.units += frames
      segment.monoSpanUs[1] = block.monoStartUs + Math.round(frames * 1_000_000 / block.sampleRate)
      if (segment.monoSpanUs[1] - segment.anchors.at(-1)!.monoUs >= RECORDING_SEGMENT_US) segment.anchors.push(anchor(segment.monoSpanUs[1], block.uncertaintyUs, segment))
    },
    video: async (frame, monoUs, uncertaintyUs, compensationUs) => {
      if (active && monoUs - active.segment.monoSpanUs[0] >= RECORDING_SEGMENT_US) await close(monoUs)
      const current = active ?? await open(monoUs, undefined, undefined, frame.displayWidth, frame.displayHeight)
      const segment = current.segment
      if (!segment.units) { segment.anchors.push(anchor(monoUs, uncertaintyUs, segment)); segment.latencyCompensationUs = 0; segment.sourceClockOffsetUs = Math.round(compensationUs) }
      const duration = (frame.duration ?? Math.round(1_000_000 / frameRate)) / 1_000_000
      const sample = new VideoSample(frame, { timestamp: (monoUs - segment.monoSpanUs[0]) / 1_000_000, duration })
      try { await current.video!.add(sample) } finally { sample.close() }
      segment.units++; segment.monoSpanUs[1] = monoUs + Math.round(duration * 1_000_000)
    },
    close,
    cancel: async () => { const previous = active; active = undefined; await previous?.output.cancel() },
  }
}
