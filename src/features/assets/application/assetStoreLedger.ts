import type { ApplicationStoreActionLedger } from '@/core/application-control'

import type { useAssetLibraryStore } from '../store/assetLibraryStore'

/*
 * 素材库的界面动作账本。
 *
 * 素材本身的增删改（改名、打标签、进出集合、删除）走的是 asset / asset.library 两个实体，
 * 已经全覆盖。这个 store 里剩下的全是面板形态与筛选条件——面板形态属于视图态，
 * 筛选条件则是查询参数：助手用 query_assets 直接带条件查，不需要先去改界面上的筛选器。
 */

type State = ReturnType<typeof useAssetLibraryStore.getState>
type ActionName = {
  [K in keyof State]-?: State[K] extends (...args: never[]) => unknown ? K : never
}[keyof State]

const FILTER_REASON = '界面筛选条件只决定用户此刻看到哪些卡片；助手用 query_assets 直接带条件查询，'
  + '改用户正在用的筛选器反而会打断他。'

const PANEL_REASON = '素材库以浮层还是整页打开、从哪个工作区打开，属于面板形态；'
  + '助手要打开素材库用 open_application_surface，要读素材用 query_assets。'

export const ASSET_STORE_LEDGER: ApplicationStoreActionLedger<ActionName> = {
  storeId: 'assetLibraryStore',
  title: '素材库',
  entries: {
    setSelectedAsset: { kind: 'capability', capabilityId: 'select_asset' },

    setView: { kind: 'excluded', category: 'view_state', reason: PANEL_REASON },
    openFloating: { kind: 'excluded', category: 'view_state', reason: PANEL_REASON },
    close: { kind: 'excluded', category: 'view_state', reason: PANEL_REASON },
    setSourceWorkspace: { kind: 'excluded', category: 'view_state', reason: PANEL_REASON },

    setKeyword: { kind: 'excluded', category: 'view_state', reason: FILTER_REASON },
    setMediaType: { kind: 'excluded', category: 'view_state', reason: FILTER_REASON },
    setSort: { kind: 'excluded', category: 'view_state', reason: FILTER_REASON },
    setLibraryId: { kind: 'excluded', category: 'view_state', reason: FILTER_REASON },
  },
}
