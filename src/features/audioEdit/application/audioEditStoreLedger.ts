import { fieldLedgerEntries, type ApplicationStoreActionLedger } from '@/core/application-control'

import { AUDIO_EDIT_FIELDS } from './audioEditFields'
import type { useAudioEditStore } from '../store/audioEditStore'

type State = ReturnType<typeof useAudioEditStore.getState>
type ActionName = {
  [K in keyof State]-?: State[K] extends (...args: never[]) => unknown ? K : never
}[keyof State]

const fields = Object.values(AUDIO_EDIT_FIELDS).flat()
const properties = fields.filter((field) => field.writer).map((field) => field.propertyId) as [string, ...string[]]
const bindings = fieldLedgerEntries(fields)

export const AUDIO_EDIT_STORE_LEDGER: ApplicationStoreActionLedger<ActionName> = {
  storeId: 'audioEditStore',
  title: '口播',
  entries: {
    setProject: {
      kind: 'excluded', category: 'internal',
      reason: '口播载入由口播剪辑领域服务完成；该动作只把已读取文档放入界面状态。',
    },
    toggleBlock: bindings.toggleBlock,
    setBlocksIncluded: bindings.setBlocksIncluded,
    setReferenceScript: bindings.setReferenceScript,
    setVstEnabled: bindings.setVstEnabled,
    applySuggestion: bindings.applySuggestion,
    dismissSuggestion: bindings.dismissSuggestion,
    setSelectedBlockIds: {
      kind: 'excluded', category: 'transient_selection',
      reason: '当前框选词块是鼠标交互的临时状态；助手使用稳定词块引用直接修改保留状态。',
    },
    undo: { kind: 'property', propertyIds: properties },
    redo: { kind: 'property', propertyIds: properties },
  },
}
