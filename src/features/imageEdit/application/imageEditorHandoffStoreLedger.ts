import type { ApplicationStoreActionLedger } from '@/core/application-control'

import type { useImageEditorHandoffStore } from '../store/imageEditorHandoffStore'

type State = ReturnType<typeof useImageEditorHandoffStore.getState>
type ActionName = {
  [K in keyof State]-?: State[K] extends (...args: never[]) => unknown ? K : never
}[keyof State]

const REASON = '图片从画布节点/生成历史交接进图片编辑器的一次性中转态（offer 写入待消费的图片+'
  + '空文档，consume 在编辑器挂载时取走并清空），纯粹是两个界面之间传递一条消息的内部管道，'
  + '不代表任何持久化内容；打开图片编辑器已由 open_image_editor_with_source 能力覆盖，'
  + '这个 store 只是它在渲染层的实现细节。'

export const IMAGE_EDITOR_HANDOFF_STORE_LEDGER: ApplicationStoreActionLedger<ActionName> = {
  storeId: 'imageEditorHandoffStore',
  title: '图片编辑交接中转态',
  entries: {
    offer: { kind: 'excluded', category: 'internal', reason: REASON },
    consume: { kind: 'excluded', category: 'internal', reason: REASON },
  },
}
