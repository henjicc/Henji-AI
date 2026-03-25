export interface MinimaxVoiceClonePanelValue {
  voiceName: string
  cloneAudioFilePath: string
  cloneAudioFileName: string
  promptEnabled: boolean
  promptAudioFilePath: string
  promptAudioFileName: string
  promptText: string
  previewText: string
  previewModel: string
  accuracy: number
  needNoiseReduction: boolean
  needVolumeNormalization: boolean
  lastPreviewAudioUrl: string
  lastPreviewAudioFilePath: string
}

export interface StatusMessage {
  type: 'success' | 'error'
  text: string
}

export const DEFAULT_PREVIEW_MODELS = [
  { value: 'speech-02-hd', label: 'speech-02-hd' },
  { value: 'speech-02-turbo', label: 'speech-02-turbo' },
  { value: 'speech-2.5-hd-preview', label: 'speech-2.5-hd-preview' },
  { value: 'speech-2.5-turbo-preview', label: 'speech-2.5-turbo-preview' },
]

export const AUDIO_ACCEPT_LIST = ['audio/mpeg', 'audio/mp4', 'audio/wav', '.mp3', '.m4a', '.wav']
export const AUDIO_ACCEPT = AUDIO_ACCEPT_LIST.join(',')
export const MAX_AUDIO_SIZE_MB = 20

export const DEFAULT_VALUE: MinimaxVoiceClonePanelValue = {
  voiceName: '',
  cloneAudioFilePath: '',
  cloneAudioFileName: '',
  promptEnabled: false,
  promptAudioFilePath: '',
  promptAudioFileName: '',
  promptText: '',
  previewText: '',
  previewModel: 'speech-2.5-turbo-preview',
  accuracy: 0.7,
  needNoiseReduction: false,
  needVolumeNormalization: false,
  lastPreviewAudioUrl: '',
  lastPreviewAudioFilePath: '',
}
