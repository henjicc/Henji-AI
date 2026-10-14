import { getPlatform } from '@/platform'
import { RecordingTracksSession, readRecordingTracks } from './session'
import { recordingTrackPlacement } from '@/core/screenRecording/tracks'
import { ALL_FORMATS, AudioSampleSink, Input, UrlSource, VideoSampleSink } from 'mediabunny'
import { toFetchableMediaUrl } from '@/services/imageSource'

/** Development bundle only; requires the automation-only main fixture before any device/file is opened. */
export function installRecordingTracksTourFixture(): void {
  const host = window as unknown as { __recordingTracksTour?: ReturnType<typeof createFixture> }
  host.__recordingTracksTour = createFixture()
}
function createFixture() {
  let session: RecordingTracksSession | undefined
  let audio: AudioContext | undefined
  let directory: string | undefined
  let failure: string | undefined
  const signal = new AbortController().signal
  return {
    start: async (): Promise<void> => {
      if (session) throw new Error('巡检轨道已启动')
      const fixture = await window.henjiNative.testFixtures.recordingControl('read')
      if (!fixture.tracksDirectory || fixture.originUs === undefined || !fixture.snapshot) throw new Error('请先准备隔离的轨道巡检会话')
      const targetDirectory = fixture.tracksDirectory
      directory = targetDirectory
      await getPlatform().screenRecording.grant({ sessionId: fixture.snapshot.sessionId, userReceipt: crypto.randomUUID(), kinds: ['microphone', 'camera'] })
      // A separate stereo virtual system track exercises the same real AudioWorklet without capturing unrelated apps.
      audio = new AudioContext(); await audio.resume()
      const destination = audio.createMediaStreamDestination()
      const tone = audio.createOscillator(); tone.frequency.value = 440; tone.connect(destination); tone.start()
      session = new RecordingTracksSession({ sessionId: fixture.snapshot.sessionId, originUs: fixture.originUs, directory: targetDirectory, tracks: { microphone: {}, systemAudio: true, camera: { width: 640, height: 480, frameRate: 30 } },
        displayAudio: async () => new MediaStream(destination.stream.getAudioTracks().map(track => track.clone())), onFailure: error => { failure = String(error) },
      }, { silentRisk: false })
      await session.start(signal)
    },
    pause: async (): Promise<void> => { await session?.pause(signal) },
    resume: async (): Promise<void> => { await session?.resume(signal) },
    stop: async (): Promise<void> => { await session?.stop(signal); if (audio && audio.state !== 'closed') await audio.close() },
    read: async () => {
      if (failure) throw new Error(failure)
      if (!directory) throw new Error('巡检未开始')
      const data = await readRecordingTracks(directory)
      const files: Array<{ kind: string; video: boolean; audio: boolean; duration: number; placementErrorUs: number; startUs: number; uncertaintyUs: number }> = []
      for (const track of data.tracks) for (const segment of track.segments) {
        const path = await getPlatform().system.paths.join(directory, segment.file)
        const input = new Input({ source: new UrlSource(toFetchableMediaUrl(path)), formats: ALL_FORMATS })
        try {
          const video = await input.getPrimaryVideoTrack(); const sound = await input.getPrimaryAudioTrack()
          const sample = video ? await new VideoSampleSink(video).getSample(0) : sound ? await new AudioSampleSink(sound).getSample(0) : null
          if (!sample) throw new Error('分段没有可解码样本')
          sample.close()
          const placement = recordingTrackPlacement(segment, 0, 30)
          files.push({ kind: track.kind, video: Boolean(video), audio: Boolean(sound), duration: await input.computeDuration(), placementErrorUs: Math.abs(placement.startFrame / 30 * 1_000_000 - segment.monoSpanUs[0]), startUs: segment.monoSpanUs[0], uncertaintyUs: Math.max(...segment.anchors.map(anchor => anchor.uncertaintyUs)) })
        } finally { input.dispose() }
      }
      return { data, files, clockUs: await getPlatform().screenRecording.clock(), failure }
    },
    cleanup: async (): Promise<void> => { try { await session?.cancel() } finally { if (audio && audio.state !== 'closed') await audio.close(); session = undefined } },
  }
}
