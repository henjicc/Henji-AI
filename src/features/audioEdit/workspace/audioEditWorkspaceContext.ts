import { createContext, useContext } from 'react'
import type { NotificationMessage } from '@/i18n/notifications'
import type { AudioEditAsrModel } from '@/platform/contracts/audioEdit'
import type { AudioEditProcessorDescriptor, AudioEditProjectDocument, AudioEditRange, AudioEditTask, AudioEditTranscriptBlock } from '@/core/audioEdit/types'
import type { AudioEditDelivery } from '../AudioEditPlaybackModeSwitch'
import type { AudioEditTextSearch } from '../useAudioEditTextSearch'
import type { AudioWaveEditorState, audioWaveActions } from '../spectral/audioWaveEditorState'

export type AudioEditDeliveryFormat = 'xml' | 'wav'

/**
 * 音频编辑各面板共用的宿主状态：作品、选区、播放、处理任务与交付设置都只在 AudioEditApp 里有一份，
 * 面板（编辑器、文字稿、处理、效果组、选区、历史、交付）通过它读写，拖到哪里、合并成哪组标签都不影响行为。
 */
export interface AudioEditWorkspace {
  project: AudioEditProjectDocument
  disabled: boolean
  sourceError: string
  run: (operation: () => Promise<unknown>) => Promise<void>
  notifyError: (error: unknown) => void
  notify: (message: NotificationMessage) => void
  update: (patch: Partial<AudioEditProjectDocument>) => void
  /** 撤销 / 重做与历史（快照栈，越靠后越新）。 */
  history: { past: readonly AudioEditProjectDocument[]; future: readonly AudioEditProjectDocument[]; undo: () => void; redo: () => void }
  textSearch: AudioEditTextSearch
  wave: AudioWaveEditorState
  waveActions: ReturnType<typeof audioWaveActions>
  waveSelection: AudioEditRange | null
  setWaveSelection: (range: AudioEditRange | null) => void
  editSelection: (mode: 'delete' | 'mute' | 'restore') => void
  seek: (frame: number) => void
  navigateToFrame: (frame: number) => void
  togglePlayback: () => Promise<void>
  delivery: AudioEditDelivery
  silencePreview: { ranges: AudioEditRange[]; pending: boolean; error?: string }
  /** 处理只作用于选区（文字选中的词或波形选区）。 */
  selectionOnly: boolean
  setSelectionOnly: (value: boolean) => void
  processRange: AudioEditRange | undefined
  selectedBlocks: readonly AudioEditTranscriptBlock[]
  selectedBlockIds: readonly string[]
  setSelectedBlockIds: (ids: string[]) => void
  setBlocksIncluded: (ids: string[], included: boolean) => void
  setReferenceScript: (text: string) => void
  setVstEnabled: (enabled: boolean) => void
  editBlock: (id: string) => void
  deleteBlock: (id: string) => void
  resolveSuggestions: (ids: string[], apply: boolean) => void
  asrModels: readonly AudioEditAsrModel[]
  processors: readonly AudioEditProcessorDescriptor[]
  tasks: readonly AudioEditTask[]
  deliveryFormat: AudioEditDeliveryFormat
  setDeliveryFormat: (format: AudioEditDeliveryFormat) => void
  withSrt: boolean
  setWithSrt: (value: boolean) => void
  withProcessing: boolean
  setWithProcessing: (value: boolean) => void
  openViewSettings: () => void
}

export const AudioEditWorkspaceContext = createContext<AudioEditWorkspace | null>(null)

export function useAudioEditWorkspace(): AudioEditWorkspace {
  const value = useContext(AudioEditWorkspaceContext)
  if (!value) throw new Error('音频编辑面板宿主尚未就绪')
  return value
}
