import { z } from 'zod'
import { systemAudioHealthSchema, type SystemAudioHealth } from '../../../../src/core/audioCapture/contracts'
import { AudioCaptureClient } from './client'
import { audioCaptureExecutablePath } from './executable'
import { NativeTrackRecorder, type NativeTrackRecording, type NativeTrackSource, type NativeTrackSummary } from './native-track'
import { createMainLogger } from '../logging'

const logger = createMainLogger('main.audio_capture.system')
const statusSchema = z.object({ sampleRate: z.number(), device: z.string(), systemHealth: systemAudioHealthSchema })
const ZERO_HEALTH: SystemAudioHealth = { segments: 0, silenceSeconds: 0, unavailableSeconds: 0, trimmedFrames: 0, discontinuities: 0, droppedFrames: 0, deviceSwitches: 0, maxWriteMs: 0 }

export type SystemAudioRecorder = NativeTrackRecorder<SystemAudioHealth>
export type SystemAudioRecording = NativeTrackRecording
export type SystemAudioSummary = NativeTrackSummary<SystemAudioHealth>

/** 系统声的原生服务：与麦克风分开的另一个录音进程，麦克风驱动出问题不影响系统声，反之亦然。 */
export class SystemAudioCaptureService {
  private readonly client: AudioCaptureClient
  private readonly recorders = new Set<SystemAudioRecorder>()
  private readonly source: NativeTrackSource<SystemAudioHealth>
  constructor(executable: () => string) {
    this.client = new AudioCaptureClient(executable, event => { if ('sessionId' in event) [...this.recorders].find(recorder => recorder.owns(event.sessionId))?.event(event) }, loss => { for (const recorder of [...this.recorders]) recorder.lost(loss) })
    this.source = {
      kind: 'systemAudio', label: '系统声', event: 'audio_capture.system_audio', logger, client: this.client, zero: ZERO_HEALTH,
      begin: async (sessionId, directory) => {
        const status = statusSchema.parse(await this.client.request('startSystemAudio', { sessionId, directory }))
        // 客户端失联时会把“正在录”清掉：每开一段原生会话都重新声明，免得空闲计时把进程关掉。
        this.client.setActive(true)
        return status
      },
      health: result => statusSchema.pick({ systemHealth: true }).parse(result).systemHealth,
      glitchKeys: ['droppedFrames', 'discontinuities'],
      // 原生只在写盘失败时结束系统声会话；设备没了、换了都补静音继续。
      deviceLost: () => false,
    }
  }
  async start(options: SystemAudioRecording): Promise<SystemAudioRecorder> {
    const recorder: SystemAudioRecorder = new NativeTrackRecorder(this.source, options, value => { this.recorders.delete(value); this.client.setActive(this.recorders.size > 0) })
    this.recorders.add(recorder)
    logger.info('开始录制系统声', { event: 'audio_capture.system_audio.start' })
    try { await recorder.open() } catch (error) {
      this.recorders.delete(recorder); this.client.setActive(this.recorders.size > 0)
      logger.warn('系统声没能开始', { event: 'audio_capture.system_audio.start.failed', error })
      throw error
    }
    return recorder
  }
  /** 应用退出：先让每一路收尾封口，再关原生进程。 */
  async dispose(): Promise<void> {
    await Promise.allSettled([...this.recorders].map(recorder => recorder.stop()))
    await this.client.dispose()
  }
}

let shared: SystemAudioCaptureService | undefined
/** 主进程里唯一的系统声服务；录屏与界面自己的录制共用。 */
export function systemAudioCapture(): SystemAudioCaptureService { return shared ??= new SystemAudioCaptureService(audioCaptureExecutablePath) }
export async function disposeSystemAudioCapture(): Promise<void> { const service = shared; shared = undefined; await service?.dispose() }
