import type { ApplicationStoreActionLedger } from '@/core/application-control'

import type { useImageEditorInteractionStoreV3 } from '../store/imageEditorInteractionStoreV3'

type State = ReturnType<typeof useImageEditorInteractionStoreV3.getState>
type ActionName = {
  [K in keyof State]-?: State[K] extends (...args: never[]) => unknown ? K : never
}[keyof State]

const DRAG_REASON = '图层拖拽的起点、悬停目标与结束态只是鼠标手势的中间投影；最终顺序由'
  + ' ImageEditCommandBusV3 命令写入文档，助手通过稳定引用直接寻址，不伪造鼠标拖拽。'
const VIEWPORT_REASON = '视口缩放与平移只决定当前窗口如何查看文档，不进入 ImageEditDocumentV3、'
  + '命令历史或导出结果；助手读写实体不依赖视口坐标。'
const SELECTION_REASON = '活动标注是控制点与选框的瞬态选中态，不是文档内容；助手使用'
  + ' image_mark.annotation 稳定引用直接读写标注，不需要先选中。'

export const IMAGE_EDITOR_INTERACTION_STORE_LEDGER_V3: ApplicationStoreActionLedger<ActionName> = {
  storeId: 'imageEditorInteractionStoreV3',
  title: '图片编辑 V3 瞬态交互',
  entries: {
    beginLayerDrag: { kind: 'excluded', category: 'transient_selection', reason: DRAG_REASON },
    setLayerDragTarget: { kind: 'excluded', category: 'transient_selection', reason: DRAG_REASON },
    endLayerDrag: { kind: 'excluded', category: 'transient_selection', reason: DRAG_REASON },
    setViewportZoom: { kind: 'excluded', category: 'view_state', reason: VIEWPORT_REASON },
    setViewportPan: { kind: 'excluded', category: 'view_state', reason: VIEWPORT_REASON },
    setViewportTransform: { kind: 'excluded', category: 'view_state', reason: VIEWPORT_REASON },
    selectAnnotation: { kind: 'excluded', category: 'transient_selection', reason: SELECTION_REASON },
    clearViewport: { kind: 'excluded', category: 'view_state', reason: VIEWPORT_REASON },
  },
}
