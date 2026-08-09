import type { ApplicationStoreActionLedger } from '@/core/application-control'

import type { useCameraStageViewportStore } from '../store/cameraStageViewportStore'

type State = ReturnType<typeof useCameraStageViewportStore.getState>
type ActionName = {
  [K in keyof State]-?: State[K] extends (...args: never[]) => unknown ? K : never
}[keyof State]

const REASON = '单窗/四窗布局、每个窗格显示哪个视角、哪个窗格被放大，只影响本机当前窗口怎么摆'
  + '放画面，不写入工程文件也不影响出片；助手要看某个机位的画面用 observe_camera_stage_scene '
  + '读结构化状态，不需要真的切换本地窗格布局。'

export const CAMERA_STAGE_VIEWPORT_STORE_LEDGER: ApplicationStoreActionLedger<ActionName> = {
  storeId: 'cameraStageViewportStore',
  title: '三维多视口布局',
  entries: {
    setLayout: { kind: 'excluded', category: 'view_state', reason: REASON },
    setActiveViewport: { kind: 'excluded', category: 'view_state', reason: REASON },
    setViewportSource: { kind: 'excluded', category: 'view_state', reason: REASON },
    toggleMaximized: { kind: 'excluded', category: 'view_state', reason: REASON },
    resetViewports: { kind: 'excluded', category: 'view_state', reason: REASON },
  },
}
