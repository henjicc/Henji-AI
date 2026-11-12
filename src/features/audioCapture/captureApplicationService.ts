import { registerApplicationCloseGuard } from '@/core/applicationLifecycle/applicationCloseGuards'
import { importCapturedAudio } from './importCapturedAudio'
import { getPlatform } from '@/platform/runtime'
import { CaptureSession } from './captureSession'
import { getAudioEditProjectInstance, lockAudioEditRecording, openAudioEditDocument, restoreAudioEditTake, useAudioEditPlaybackStore } from '@/features/audioEdit'
import { selectToolboxTool, switchWorkspace } from '@/stores/navigationStore'
import { bindCaptureIndicator } from './captureIndicatorBinding'

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
    open: id => openAudioEditDocument({ id }),
  })
  session = current
  // 录音与页面是否显示无关：切换工作区、最小化都继续录，只有关闭窗口才停止并拼回原位置。
  registerApplicationCloseGuard(async () => {
    const state = current.store.getState()
    if ((state.visible || current.active) && !await current.leave()) throw new Error('已取消关闭，录音仍保留在工作面')
  })
  bindCaptureIndicator({ store: current.store, durationSeconds: () => current.durationSeconds, stop: () => current.stop(), show: () => showAudioCaptureRecording(current) })
  return current
}

/** 从任何页面回到正在录音的那份作品：音频编辑里显示它，再切到音频编辑。 */
async function showAudioCaptureRecording(current: CaptureSession): Promise<void> {
  const projectId = current.store.getState().placement?.projectId
  if (projectId) await openAudioEditDocument({ id: projectId })
  switchWorkspace('tools')
  selectToolboxTool('audioEdit')
}
