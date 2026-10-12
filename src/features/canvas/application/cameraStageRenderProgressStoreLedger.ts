import type { ApplicationStoreActionLedger } from '@/core/application-control/storeActionLedger';

/**
 * 私有 Store 只有 tasks 数据，没有用户动作或函数键，故动作账本为空。
 * 进度由 cameraStageRenderApplicationService / 编辑器导出回调派生，不接受实体写入。
 * 助手查询和取消后台任务仍走既有 camera_stage.render_task 能力；这不是第二份任务事实。
 */
export const CAMERA_STAGE_RENDER_PROGRESS_STORE_LEDGER: ApplicationStoreActionLedger<never> = {
  storeId: 'cameraStageRenderProgress',
  title: '镜头参考渲染进度投影（内部瞬态）',
  entries: {},
};
