import type { ApplicationStoreActionLedger } from '@/core/application-control'

import type { useImageEditorUiStore } from '../store/imageEditorUiStore'

type State = ReturnType<typeof useImageEditorUiStore.getState>
type ActionName = {
  [K in keyof State]-?: State[K] extends (...args: never[]) => unknown ? K : never
}[keyof State]

const REASON = '哪个检查器工具标签页在前台、检查器面板宽度与折叠态，只是编辑器窗口本地的布局'
  + '偏好，不写入 ImageEditDocument（编辑文档），也不影响编辑结果或导出产物；这层与'
  + '编辑文档本身是否已对助手开放（见期六 imageMark 领域任务）无关，纯属窗口布局。'

export const IMAGE_EDITOR_UI_STORE_LEDGER: ApplicationStoreActionLedger<ActionName> = {
  storeId: 'imageEditorUiStore',
  title: '图片编辑器面板布局',
  entries: {
    setActiveInspectorToolId: { kind: 'excluded', category: 'view_state', reason: REASON },
    setInspectorWidth: { kind: 'excluded', category: 'view_state', reason: REASON },
    setInspectorCollapsed: { kind: 'excluded', category: 'view_state', reason: REASON },
    resetInspector: { kind: 'excluded', category: 'view_state', reason: REASON },
  },
}
