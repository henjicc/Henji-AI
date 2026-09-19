import type { ApplicationStoreActionLedger } from '@/core/application-control'

import type { useAudioEditStore } from '../store/audioEditStore'

type State = ReturnType<typeof useAudioEditStore.getState>
type ActionName = {
  [K in keyof State]-?: State[K] extends (...args: never[]) => unknown ? K : never
}[keyof State]

const EDITABLE_PROPERTIES = [
  'audio_edit.transcript_block.included',
  'audio_edit.project.reference_script',
  'audio_edit.processor_chain.vst_enabled',
  'audio_edit.suggestion.status',
] as const

export const AUDIO_EDIT_STORE_LEDGER: ApplicationStoreActionLedger<ActionName> = {
  storeId: 'audioEditStore',
  title: '口播剪辑工程',
  entries: {
    setProject: {
      kind: 'excluded', category: 'internal',
      reason: '工程载入由口播剪辑领域服务完成；该动作只把已读取文档放入界面状态。',
    },
    acceptSavedRevision: {
      kind: 'excluded', category: 'derived',
      reason: '保存修订号由持久化结果回填，用户与助手都不能直接指定数据库修订。',
    },
    toggleBlock: { kind: 'property', propertyIds: ['audio_edit.transcript_block.included'] },
    setBlocksIncluded: { kind: 'property', propertyIds: ['audio_edit.transcript_block.included'] },
    setReferenceScript: { kind: 'property', propertyIds: ['audio_edit.project.reference_script'] },
    setVstEnabled: { kind: 'property', propertyIds: ['audio_edit.processor_chain.vst_enabled'] },
    applySuggestion: {
      kind: 'property',
      propertyIds: ['audio_edit.transcript_block.included', 'audio_edit.suggestion.status'],
    },
    dismissSuggestion: { kind: 'property', propertyIds: ['audio_edit.suggestion.status'] },
    setSelectedBlockIds: {
      kind: 'excluded', category: 'transient_selection',
      reason: '当前框选词块是鼠标交互的临时状态；助手使用稳定词块引用直接修改保留状态。',
    },
    undo: { kind: 'property', propertyIds: EDITABLE_PROPERTIES },
    redo: { kind: 'property', propertyIds: EDITABLE_PROPERTIES },
  },
}
