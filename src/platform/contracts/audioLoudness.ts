import type { VideoEditLoudnessMeasurement, VideoEditLoudnessSettings } from '../../core/videoEdit/loudness'
import type { VideoEditAudioActivity } from '../../core/videoEdit/audioDucking'

/** Bounded, sender-owned PCM spool. No renderer-supplied file paths or FFmpeg arguments. */
export interface AudioLoudnessPlatform {
  start(sampleRate: number, channels: number, sessionId: string): Promise<void>
  append(sessionId: string, channels: Float32Array[]): Promise<void>
  measure(sessionId: string): Promise<VideoEditLoudnessMeasurement>
  detectActivity(sessionId: string, sensitivity: number): Promise<VideoEditAudioActivity[]>
  normalize(sessionId: string, settings: VideoEditLoudnessSettings): Promise<VideoEditLoudnessMeasurement>
  read(sessionId: string, startFrame: number, frames: number): Promise<Float32Array[]>
  close(sessionId: string): Promise<void>
}
