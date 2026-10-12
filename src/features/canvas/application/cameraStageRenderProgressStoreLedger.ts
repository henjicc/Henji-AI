import type { ApplicationStoreActionLedger } from '@/core/application-control/storeActionLedger';

import type { useCameraStageRenderProgressStore } from './cameraStageRenderProgress';

type State = ReturnType<typeof useCameraStageRenderProgressStore.getState>
type ActionName = {
  [K in keyof State]-?: State[K] extends (...args: never[]) => unknown ? K : never
}[keyof State]

const REASON = '镜头参考渲染进度是渲染任务回调写入的瞬态投影，不属于作品、撤销或持久化内容；'
  + '助手查询与取消渲染走既有 camera_stage.render_task 能力，不需要读写这份进度。'

export const CAMERA_STAGE_RENDER_PROGRESS_STORE_LEDGER: ApplicationStoreActionLedger<ActionName> = {
  storeId: 'cameraStageRenderProgress',
  title: '镜头参考渲染进度投影',
  entries: {
    setProgress: { kind: 'excluded', category: 'derived', reason: REASON },
    clearAll: { kind: 'excluded', category: 'derived', reason: REASON },
  },
};
