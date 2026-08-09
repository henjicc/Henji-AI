import type { ApplicationStoreActionLedger } from '@/core/application-control'

import type { useCameraStageSessionStore } from '../store/cameraStageSessionStore'

type State = ReturnType<typeof useCameraStageSessionStore.getState>
type ActionName = {
  [K in keyof State]-?: State[K] extends (...args: never[]) => unknown ? K : never
}[keyof State]

export const CAMERA_STAGE_SESSION_STORE_LEDGER: ApplicationStoreActionLedger<ActionName> = {
  storeId: 'cameraStageSessionStore',
  title: '三维会话（列表/编辑器视图）',
  entries: {
    /*
     * appView 是工具箱内"工程列表 ⇄ 场景编辑器"两级视图的显示态切换，本身不改变工程数据。
     * 助手侧通过 open/create_camera_stage_project 与 focus_application_entity 直接进入
     * 编辑器（它们内部会调用 setAppView('editor')，见 cameraStageCapabilityAdapter.ts /
     * surfaceRegistry.ts）；查询工程列表用 list_camera_stage_projects，不需要真的切到
     * 列表视图，也没有独立的"返回列表"能力需求。
     */
    setAppView: {
      kind: 'excluded',
      category: 'view_state',
      reason: '工程列表与场景编辑器两级视图的显示态切换，不改变工程数据；助手通过 '
        + 'open/create_camera_stage_project 与 focus_application_entity 直接进入编辑器'
        + '（内部已调用这个 setter），查询工程列表用 list_camera_stage_projects。',
    },
    setLastProjectId: {
      kind: 'excluded',
      category: 'internal',
      reason: '记住最后打开的工程 id，供应用重启后自动恢复上次会话使用，由 '
        + 'cameraStageProjectService.ts 在打开/关闭工程时自动维护，不是独立的用户动作。',
    },
    /*
     * stageViewMode 是 cameraStageStore.setViewMode（导演/机位视角）的持久化镜像，
     * 只用于应用重启后恢复上次看到的视角（见 cameraStageProjectService.ts /
     * CameraStageApp.tsx 的恢复逻辑）。与 setViewMode 本身同一类排除。
     */
    setStageViewMode: {
      kind: 'excluded',
      category: 'view_state',
      reason: '导演视角与机位视角的持久化镜像（重启后恢复用），与 cameraStageStore.setViewMode '
        + '同一类排除——只影响本机当前窗口看到的画面，不进工程文件；助手要看某个机位的画面用 '
        + 'observe_camera_stage_scene 读结构化状态。',
    },
  },
}
