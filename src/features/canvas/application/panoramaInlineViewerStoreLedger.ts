import type { ApplicationStoreActionLedger } from '@/core/application-control'

import type { usePanoramaInlineViewerStore } from '@/stores/panoramaInlineViewerStore'

type State = ReturnType<typeof usePanoramaInlineViewerStore.getState>
type ActionName = {
  [K in keyof State]-?: State[K] extends (...args: never[]) => unknown ? K : never
}[keyof State]

const REASON = '全景节点内嵌 WebGL 租约只限制同一时刻的 GPU 上下文数量；'
  + '它不表达用户业务意图，不参与工程持久化，相机视角由画布节点数据单独保存。'

export const PANORAMA_INLINE_VIEWER_STORE_LEDGER: ApplicationStoreActionLedger<ActionName> = {
  storeId: 'panoramaInlineViewerStore',
  title: '全景节点内嵌 WebGL 租约',
  entries: {
    claim: { kind: 'excluded', category: 'derived', reason: REASON },
    release: { kind: 'excluded', category: 'derived', reason: REASON },
  },
}
