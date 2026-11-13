/** 录音特性的公共入口；音频编辑、设置和应用反射共用同一会话与表单。 */
export { AudioCaptureSettingsForm } from './AudioCaptureSettingsForm'
export { AudioCaptureRecoveryBanner } from './AudioCaptureRecoveryBanner'
export { getAudioCaptureSession, readAudioCaptureMain, readAudioCapturePendingFiles, readAudioCaptureRecording } from './captureApplicationService'
export { pauseAudioEditRecording, recoverAudioEditRecording, resumeAudioEditRecording, startAudioEditRecording, stopAudioEditRecording } from './audioEditRecording'
export { AudioCaptureLive } from './AudioCaptureLive'
export { isCaptureShortcut } from './captureLiveModel'
