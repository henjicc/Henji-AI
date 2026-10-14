import type { RecordingPrivacy } from '../../../../../src/core/screenRecording/privacy'
import type { LocalInferenceModelFile } from '../protocol'
import type { LocalExecutionProvider } from '../providers'
export interface OcrPrivacyJob {
  id: string; source: string; ffmpegPath: string; models: LocalInferenceModelFile[]; providers: LocalExecutionProvider[]
  seekSeconds: number; durationSeconds: number; startUs: number; endUs: number; fps: number
  mediaId: string; display: { width: number; height: number }
}
export interface OcrPrivacyResult { privacy: RecordingPrivacy; frames: number; inferredFrames: number }
