import type { ApplicationStoreActionLedger } from '@/core/application-control'

import type { useCameraStageToolStore } from '../store/cameraStageToolStore'

type State = ReturnType<typeof useCameraStageToolStore.getState>
type ActionName = {
  [K in keyof State]-?: State[K] extends (...args: never[]) => unknown ? K : never
}[keyof State]

const CONTROL_SELECTION_REASON = '路径手柄上具体拖哪个控制点/端点是鼠标操作的中间选中态，'
  + '助手改路径直接写 camera_stage.trajectory.knots 等属性（见 2.5），不需要先选中控制点。'

export const CAMERA_STAGE_TOOL_STORE_LEDGER: ApplicationStoreActionLedger<ActionName> = {
  storeId: 'cameraStageToolStore',
  title: '三维编辑手柄工具',
  entries: {
    setTool: {
      kind: 'excluded',
      category: 'view_state',
      reason: '手柄工具（移动/旋转/缩放/路径）只决定下一次鼠标拖拽被解释成什么操作，不写入工程'
        + '文件也不影响出片；助手改变换值直接写 camera_stage.object.transform.*，不经过手柄，'
        + '与 cameraStageStore.setGizmoMode 是同一类排除（见 cameraStageStoreLedger.ts）。',
    },
    selectPath: { kind: 'excluded', category: 'transient_selection', reason: CONTROL_SELECTION_REASON },
    selectControl: { kind: 'excluded', category: 'transient_selection', reason: CONTROL_SELECTION_REASON },
    clearPathSelection: { kind: 'excluded', category: 'transient_selection', reason: CONTROL_SELECTION_REASON },
  },
}
