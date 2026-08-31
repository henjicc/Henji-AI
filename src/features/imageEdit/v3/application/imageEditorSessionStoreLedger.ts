import type { ApplicationStoreActionLedger } from '@/core/application-control'

import type { useImageEditorSessionStoreV3 } from '../store/imageEditorSessionStoreV3'

type State = ReturnType<typeof useImageEditorSessionStoreV3.getState>
type ActionName = {
  [K in keyof State]-?: State[K] extends (...args: never[]) => unknown ? K : never
}[keyof State]

const LIFECYCLE_REASON = '会话创建与释放只跟随编辑器挂载周期，不是用户的文档编辑命令；实时反射'
  + '由 live session registry 注册真实 ImageEditCommandBusV3，不把会话 UI store 当作文档真相。'
const TOOL_REASON = '当前工具只决定用户下一次指针手势的解释方式，不进入 ImageEditDocumentV3 或导出结果；'
  + '助手使用实体属性与集合动词直接提交文档命令，不模拟指针工具。'
const SELECTION_REASON = '选中图层只是当前窗口的操作焦点，不改变图层树；助手通过包含文档与图层 identity '
  + '的稳定引用直接寻址，不需要先复制用户选中态。'
const EXPANSION_REASON = '图层组展开与折叠只影响树面板的显示密度，不改变组子项、隔离或合成语义；'
  + '助手通过 image_edit.group 实体读写真实组状态。'
const TOOL_SETTING_REASON = '画笔大小、不透明度和标注字号是用户下一次指针手势的本地预设；它们本身不产生像素'
  + '或标注命令，也不进入文档历史。助手只在发起真实编辑命令时传明确参数。'

export const IMAGE_EDITOR_SESSION_STORE_LEDGER_V3: ApplicationStoreActionLedger<ActionName> = {
  storeId: 'imageEditorSessionStoreV3',
  title: '图片编辑 V3 窗口会话',
  entries: {
    ensureSession: { kind: 'excluded', category: 'internal', reason: LIFECYCLE_REASON },
    disposeSession: { kind: 'excluded', category: 'internal', reason: LIFECYCLE_REASON },
    setActiveTool: { kind: 'excluded', category: 'view_state', reason: TOOL_REASON },
    setSelectedLayerIds: { kind: 'excluded', category: 'transient_selection', reason: SELECTION_REASON },
    toggleGroupExpanded: { kind: 'excluded', category: 'view_state', reason: EXPANSION_REASON },
    setToolSetting: { kind: 'excluded', category: 'view_state', reason: TOOL_SETTING_REASON },
  },
}
