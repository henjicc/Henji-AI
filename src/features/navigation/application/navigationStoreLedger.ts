import type { ApplicationStoreActionLedger } from '@/core/application-control'

import type { useNavigationStore } from '@/stores/navigationStore'

type State = ReturnType<typeof useNavigationStore.getState>
type ActionName = {
  [K in keyof State]-?: State[K] extends (...args: never[]) => unknown ? K : never
}[keyof State]

export const NAVIGATION_STORE_LEDGER: ApplicationStoreActionLedger<ActionName> = {
  storeId: 'navigationStore',
  title: '工作区导航',
  entries: {
    /*
     * setActiveWorkspace/setActiveToolId 是内部 setter，真正的用户/助手入口是
     * switchWorkspace()/selectToolboxTool() 这两个包装函数（它们还联动素材库视图）。
     * surfaceNavigationService.ts 的 open_application_surface 走的也是这两个包装函数，
     * 不直接碰 store，所以两条动作各绑一个语义最贴近的能力即可。
     */
    setActiveWorkspace: { kind: 'capability', capabilityId: 'switch_workspace' },
    setActiveToolId: { kind: 'capability', capabilityId: 'select_toolbox_tool' },
  },
}
