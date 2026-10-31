import { fieldLedgerEntries, type ApplicationStoreActionLedger } from '@/core/application-control'
import type { useVideoEditEffectLibraryStore } from './videoEditEffectPresets'
import { effectLibraryFields } from './videoEditEffectLibraryFields'
import { effectPresetFields } from './videoEditEffectPresetFields'

type State = ReturnType<typeof useVideoEditEffectLibraryStore.getState>
type ActionName = { [K in keyof State]-?: State[K] extends (...args: never[]) => unknown ? K : never }[keyof State]

export const EFFECT_LIBRARY_STORE_LEDGER: ApplicationStoreActionLedger<ActionName> = {
  storeId: 'videoEditEffectPresets',
  title: '效果库收藏与风格件',
  entries: {
    ...fieldLedgerEntries(effectLibraryFields),
    ...fieldLedgerEntries(effectPresetFields),
    deletePreset: { kind: 'collection', entityType: 'video_edit.effect_preset', operation: 'remove' },
    importPresets: { kind: 'collection', entityType: 'video_edit.effect_preset', operation: 'create' },
    ready: { kind: 'excluded', category: 'internal', reason: '等待效果库源码读取；实体 provider 与正式写入服务自动等待，不是独立用户动作。' },
    saveLibrary: { kind: 'excluded', category: 'internal', reason: '实体创建、属性写入及导入共用的持久化提交步骤；用户操作由实体字段和集合入口维护。' },
    restoreLibrary: { kind: 'excluded', category: 'internal', reason: '通用事务撤销与失败补偿共用的快照恢复步骤，校验当前库后恢复，不是另一套业务写入入口。' },
    undoLibrary: { kind: 'excluded', category: 'internal', reason: '界面撤销/重做与 undo_application_changes 共用的领域历史执行步骤；正式属性与集合提交时自动记录。' },
    historyOrder: { kind: 'excluded', category: 'derived', reason: '供剪辑撤销命令按提交顺序选择文档或库历史，不是用户可修改状态。' },
    clearLibraryRedo: { kind: 'excluded', category: 'internal', reason: '剪辑文档有新提交时由撤销链清掉库的重做，不是用户动作。' },
    forgetLibraryChange: { kind: 'excluded', category: 'internal', reason: '失败事务补偿后释放无效的领域历史，测试重载也复用此清理步骤。' },
  },
}
