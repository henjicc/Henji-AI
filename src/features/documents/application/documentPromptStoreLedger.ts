import type { ApplicationStoreActionLedger } from '@/core/application-control'

import type { useDocumentPromptStore } from '../documentPromptStore'

type State = ReturnType<typeof useDocumentPromptStore.getState>
type ActionName = {
  [K in keyof State]-?: State[K] extends (...args: never[]) => unknown ? K : never
}[keyof State]

/**
 * 文档会话提示队列（离开提示、起名、冲突）的账本。
 *
 * 这个 store 只有一个 `queue` 状态字段、没有任何动作函数：入队由会话的 prompter 经 setState 完成，
 * 出队由用户在对话框里作答。它表达的是“正在等用户回答哪一个问题”，不是业务数据；
 * 助手不替用户回答这些提示（保存 / 不保存、覆盖磁盘版本都必须由用户决定），文档本身的读改走
 * documents.document 实体与通用文档能力。因此账上没有条目，也不登记进 storeActionCoverage 的
 * 非空账本门禁（那条门禁要求账本至少一条）。
 */
export const DOCUMENT_PROMPT_STORE_LEDGER: ApplicationStoreActionLedger<ActionName> = {
  storeId: 'documentPromptStore',
  title: '文档会话提示队列',
  entries: {},
}
