import { registerApplicationCloseGuard } from '@/core/applicationLifecycle/applicationCloseGuards'
import { registerNavigationGuard } from '@/core/applicationLifecycle/navigationGuards'
import { importCapturedAudio } from './importCapturedAudio'
import { getPlatform } from '@/platform/runtime'
import { requestAlertConfirmation } from '@/stores/alertDialogStore'
import { CaptureSession } from './captureSession'
import { getAudioEditProjectInstance, lockAudioEditRecording, restoreAudioEditTake, useAudioEditPlaybackStore } from '@/features/audioEdit'

let session: CaptureSession | undefined
export function readAudioCaptureSession(): { visible: boolean; phase: string; durationSeconds: number } {
  const state = session?.store.getState()
  return { visible: state?.visible ?? false, phase: state?.phase ?? 'idle', durationSeconds: session?.durationSeconds ?? 0 }
}
export function getAudioCaptureSession(): CaptureSession {
  if (session) return session
  const current = new CaptureSession(getPlatform().audioCapture, importCapturedAudio, discard => requestAlertConfirmation({
    title: discard ? '放弃录音？' : '停止录音并离开？',
    message: discard ? '录音文件将移到回收站。' : '已录内容会保留，可以在音频编辑首页恢复并打开。',
    confirmLabel: discard ? '放弃录音' : '停止并保留', confirmTone: discard ? 'danger' : 'default', type: 'warning',
  }), {
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
