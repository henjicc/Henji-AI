import { registerApplicationCloseGuard } from '@/core/applicationLifecycle/applicationCloseGuards'
import { registerNavigationGuard } from '@/core/applicationLifecycle/navigationGuards'
import { importCapturedAudio } from './importCapturedAudio'
import { getPlatform } from '@/platform/runtime'
import { CaptureSession } from './captureSession'
import { getAudioEditProjectInstance, lockAudioEditRecording, restoreAudioEditTake, useAudioEditPlaybackStore } from '@/features/audioEdit'

let session: CaptureSession | undefined
export function readAudioCaptureSession(): { visible: boolean; phase: string; durationSeconds: number } {
  const state = session?.store.getState()
  return { visible: state?.visible ?? false, phase: state?.phase ?? 'idle', durationSeconds: session?.durationSeconds ?? 0 }
}
export function getAudioCaptureSession(): CaptureSession {
  if (session) return session
  const current = new CaptureSession(getPlatform().audioCapture, importCapturedAudio, {
    lock: lockAudioEditRecording,
    commit: (outputPath, placement) => restoreAudioEditTake({ outputPath, name: '', placement }, true),
    rate: id => getAudioEditProjectInstance(id)?.document.source.sampleRate ?? 48000,
    progress: (placement, seconds) => {
      const rate = getAudioEditProjectInstance(placement.projectId)?.document.source.sampleRate ?? 48000
      const frame = placement.startFrame + Math.round(seconds * rate)
      useAudioEditPlaybackStore.getState().updatePosition(frame, frame, null)
    },
  })
  session = current
  registerApplicationCloseGuard(async () => { if (current.store.getState().visible && !await current.leave()) throw new Error('已取消关闭，录音仍保留在工作面') })
  registerNavigationGuard((destination, proceed) => {
    if (!current.store.getState().visible || destination.workspace === 'tools' && destination.toolId === 'audioEdit') return true
    void current.leave().then(accepted => { if (accepted) proceed() })
    return false
  })
  return current
}
