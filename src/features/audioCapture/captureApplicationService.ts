import { registerApplicationCloseGuard } from '@/core/applicationLifecycle/applicationCloseGuards'
import { importCapturedAudio } from './importCapturedAudio'
import { getPlatform } from '@/platform/runtime'
import { CaptureSession } from './captureSession'
import { getAudioEditProjectInstance, lockAudioEditRecording, openAudioEditDocument, restoreAudioEditTake, useAudioEditPlaybackStore } from '@/features/audioEdit'
import { selectToolboxTool, switchWorkspace } from '@/stores/navigationStore'
import { bindCaptureIndicator } from './captureIndicatorBinding'
import type { AudioCaptureHealth, AudioCapturePlacement, AudioCaptureRecordingState } from '@/core/audioCapture/contracts'
import { audioEditContentSchema } from '@/core/documents/kinds/audioEdit'

let session: CaptureSession | undefined

/** 录音会话的读回：给助手看的事实，与界面显示的同一份会话。 */
export interface AudioCaptureRecordingFacts {
  visible: boolean
  phase: 'idle' | 'recording' | 'paused' | 'stopped' | 'interrupted'
  durationSeconds: number
  documentId: string | null
  positionSeconds: number | null
  replaceUntilSeconds: number | null
  busy: boolean
  attached: boolean
  error: string | null
  notice: string | null
  outputPath: string | null
  health: AudioCaptureHealth | null
  microphoneInUse: boolean
  /**
   * 助手最近一次让录音拼回作品的那一段（含等不及、在后台做完的）：outputPath 是哪一段的录音文件；
   * state 为 saving 还在拼回，saved 已拼回并保存（undoRef 交给 undo_audio_edit），failed 没拼回（error 是原因，文件还在就用 recover 拼回）。
   */
  lastTake: AudioEditTakeOutcome | null
}
export type AudioEditTakeOutcome = { documentId: string; outputPath: string | null; state: 'saving' | 'saved' | 'failed'; undoRef?: string; error?: string }
export interface AudioCapturePendingFact { name: string; outputPath: string; durationSeconds: number; documentId: string | null; positionSeconds: number | null; interruption: string | null }

let lastTake: AudioEditTakeOutcome | null = null
/**
 * 助手发起的暂停、停止、恢复：拼回开始时登记 saving（清掉上一段的结果），做完再登记成败。
 * 能力等不及返回时，助手之后从读回里看这一段的结果，不会拿到上一段的撤销引用。
 */
export function noteAudioEditTake(outcome: AudioEditTakeOutcome): void { lastTake = outcome }

async function documentRate(id: string): Promise<number | null> {
  const instance = getAudioEditProjectInstance(id)
  if (instance) return instance.document.source.sampleRate
  try {
    const read = await getPlatform().documents.readDocument({ id })
    // 还没有素材的口播按空素材的 48 kHz 计，与音频编辑打开它时一致。
    return audioEditContentSchema.safeParse(read.content).data?.source?.sampleRate ?? 48000
  } catch { return null }
}
async function placementFacts(placement: AudioCapturePlacement | null | undefined): Promise<Pick<AudioCaptureRecordingFacts, 'documentId' | 'positionSeconds' | 'replaceUntilSeconds'>> {
  if (!placement) return { documentId: null, positionSeconds: null, replaceUntilSeconds: null }
  const rate = await documentRate(placement.projectId)
  return { documentId: placement.projectId, positionSeconds: rate ? placement.startFrame / rate : null, replaceUntilSeconds: rate && placement.endFrame > placement.startFrame ? placement.endFrame / rate : null }
}

/** 主进程里录音的真实状态。只走一次不排队的 IPC：读回与写入前检查不会被正在进行的开始、停止、授权或重连拖住。 */
export function readAudioCaptureMain(): Promise<AudioCaptureRecordingState> { return getPlatform().audioCapture.recordingState() }

/**
 * 是否在录、录到哪、中断原因以主进程为准：界面重载后到标题栏接管之前，界面里的会话还是空的，但录音一直在进行。
 * 界面会话只补主进程不知道的事：拼回前的暂停、正在保存、提示文字。
 */
export async function readAudioCaptureRecording(main?: AudioCaptureRecordingState): Promise<AudioCaptureRecordingFacts> {
  main ??= await readAudioCaptureMain()
  const pending = main.pending
  const local = session?.store.getState()
  const live = main.recording
  const interrupted = local?.phase === 'interrupted' ? { outputPath: local.outputPath, message: local.error } : main.interruption && pending.some(file => file.outputPath === main.interruption!.outputPath) ? main.interruption : null
  const outputPath = live?.outputPath ?? interrupted?.outputPath ?? null
  const placement = (outputPath ? pending.find(file => file.outputPath === outputPath)?.placement : undefined) ?? (local?.placement && (!outputPath || local.outputPath === outputPath) ? local.placement : null)
  const phase: AudioCaptureRecordingFacts['phase'] = live ? live.state : interrupted ? 'interrupted' : local?.phase === 'paused' || local?.phase === 'stopped' ? local.phase : 'idle'
  const durationSeconds = live ? live.durationSeconds : interrupted ? pending.find(file => file.outputPath === interrupted.outputPath)?.durationSeconds ?? session?.durationSeconds ?? 0 : phase === 'idle' ? 0 : session?.durationSeconds ?? 0
  return {
    visible: local?.visible ?? false, phase, durationSeconds, ...await placementFacts(placement), busy: local?.busy ?? false,
    attached: Boolean(live && local?.outputPath === live.outputPath), error: interrupted?.message || null, notice: local?.notice ?? null,
    outputPath, health: live?.health ?? null, microphoneInUse: main.sharedMicrophone, lastTake,
  }
}

/** 还没拼回作品、也没另存的录音文件（不含正在录的那个）。 */
export async function readAudioCapturePendingFiles(main?: AudioCaptureRecordingState): Promise<AudioCapturePendingFact[]> {
  main ??= await readAudioCaptureMain()
  const result: AudioCapturePendingFact[] = []
  for (const file of main.pending) {
    if (file.outputPath === main.recording?.outputPath) continue
    const { documentId, positionSeconds } = await placementFacts(file.placement)
    result.push({ name: file.name, outputPath: file.outputPath, durationSeconds: file.durationSeconds ?? 0, documentId, positionSeconds, interruption: main.interruption?.outputPath === file.outputPath ? main.interruption.message : null })
  }
  return result
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
