import type { ApplicationStoreActionBinding, ApplicationStoreActionLedger } from '@/core/application-control'

import type { useProjectStore } from '@/stores/projectStore'

/*
 * projectStore 的界面动作账本。
 *
 * 放在 canvas/application/ 而不是新开 features/project/application/：projectStore 是
 * canvas.project 实体的唯一数据源，canvasProjectService.ts / canvasProjectMutationExecutor.ts
 * 早就放在这里操作它，src/features/project/ 目录本身只有两个 UI 组件，没有应用层。
 */

type State = ReturnType<typeof useProjectStore.getState>
type ActionName = {
  [K in keyof State]-?: State[K] extends (...args: never[]) => unknown ? K : never
}[keyof State]

const HYDRATE_REASON = '项目列表补水是每次工程操作前的自动前置步骤（ensureProjectsHydrated /'
  + ' openCanvasProject 内部调用），不是用户能独立触发的动作。'

const VIEWPORT_REASON = '画布视口的平移缩放位置是导航态：只为跨会话恢复用户上次看到的位置，'
  + '不进入节点/连线内容，也不影响生成或导出产物；助手不需要控制用户正在看哪里。'

const CAPABILITY = (capabilityId: string): ApplicationStoreActionBinding => ({ kind: 'capability', capabilityId })

export const PROJECT_STORE_LEDGER: ApplicationStoreActionLedger<ActionName> = {
  storeId: 'projectStore',
  title: '工程管理',
  entries: {
    hydrate: { kind: 'excluded', category: 'internal', reason: HYDRATE_REASON },
    createProject: CAPABILITY('create_canvas_project'),
    deleteProject: CAPABILITY('delete_canvas_project'),
    renameProject: CAPABILITY('rename_canvas_project'),
    openProject: CAPABILITY('open_canvas_project'),
    closeProject: CAPABILITY('close_canvas_project'),
    getCurrentProject: {
      kind: 'excluded',
      category: 'internal',
      reason: '纯读取访问器，被 Canvas.tsx 在写入视口/保存快照前内部调用；助手读工程内容用 get_canvas_project。',
    },
    saveCurrentProject: {
      kind: 'excluded',
      category: 'internal',
      reason: 'persistCanvasState() 在每次画布写入后自动调用来落盘；画布内容本身的写入走 '
        + 'canvas.node / canvas.edge 的通用动词，这里只是落盘环节，不是独立入口。',
    },
    setProjectCover: {
      kind: 'excluded',
      category: 'internal',
      reason: '项目卡封面缩略图的本地路径回写，由退出项目时的封面生成流程（canvasProjectCover.ts）'
        + '自动调用；封面只是列表里的展示图，不属于工程内容，助手没有单独设置它的需求。',
    },
    saveCurrentProjectViewport: { kind: 'excluded', category: 'view_state', reason: VIEWPORT_REASON },
    cancelPendingViewportPersist: {
      kind: 'excluded',
      category: 'internal',
      reason: 'saveCurrentProjectViewport 防抖持久化的清理步骤（手势开始时取消挂起的写盘），'
        + '不是独立动作，随视口本身一并排除。',
    },
  },
}
