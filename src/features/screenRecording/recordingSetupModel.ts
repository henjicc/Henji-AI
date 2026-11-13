import type { RecordingTrackOptions } from '@/core/screenRecording/tracks'
import type { RecordingSetup } from '@/services/recordingSetupModel'

/** 录制设备偏好与剪辑讲解共用，旧入口保持兼容。 */
export * from '@/services/recordingSetupModel'

/** 按保存的录屏设置决定录哪些声音与摄像头：录屏页“开始录制”与助手省略 tracks 时共用。快速录制只出一个 MP4，不录摄像头。 */
export function recordingTracksFromSetup(setup: Pick<RecordingSetup, 'microphone' | 'systemAudio' | 'camera' | 'cameraId'>, quick = false): RecordingTrackOptions {
  return { systemAudio: setup.systemAudio, ...(setup.microphone ? { microphone: {} } : {}), ...(setup.camera && !quick ? { camera: { ...(setup.cameraId ? { deviceId: setup.cameraId } : {}), width: 1280, height: 720, frameRate: 30 } } : {}) }
}
