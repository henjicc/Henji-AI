import type { ApplicationStoreActionLedger } from '@/core/application-control'

import type { useUiStore } from '@/stores/uiStore'

type State = ReturnType<typeof useUiStore.getState>
type ActionName = {
  [K in keyof State]-?: State[K] extends (...args: never[]) => unknown ? K : never
}[keyof State]

/*
 * uiStore 只管一件事：设置面板开没开、定位到哪一节。openApplicationSurface/
 * closeApplicationSurface（surfaceNavigationService.ts）是唯一调用方，两者都由
 * open_application_surface / close_application_surface 承接，设置分区都注册了对应 Surface。
 */
export const UI_STORE_LEDGER: ApplicationStoreActionLedger<ActionName> = {
  storeId: 'uiStore',
  title: '设置面板开关',
  entries: {
    openSettings: { kind: 'capability', capabilityId: 'open_application_surface' },
    closeSettings: { kind: 'capability', capabilityId: 'close_application_surface' },
  },
}
