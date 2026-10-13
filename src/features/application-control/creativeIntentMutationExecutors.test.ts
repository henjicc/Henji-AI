import { expect, it, vi } from 'vitest'

vi.mock('./creativeIntentFields', () => ({ creativeIntentFields: () => [] }))
vi.mock('./creativeIntentHost', () => ({
  intentRevisions: () => ({ image_edit: 1 }),
  splitIntentRef: () => ({ documentRef: { kind: 'image_edit.document', id: 'document' } }),
  intentHost: () => ({ read: () => ({ sessions: [{ id: 'session' }] }) }),
}))

import { retainIntentUndo, undoIntent } from './creativeIntentMutationExecutors'

it('原稿快照撤销闭包限量，淘汰旧 token 且最新快照仍可恢复', async () => {
  const restore = vi.fn(async () => undefined)
  const tokens = Array.from({ length: 257 }, () => retainIntentUndo(restore, [{ kind: 'image_edit.intent_draft', id: 'document:draft' }], 'image_edit'))
  await expect(undoIntent(tokens[0])).rejects.toThrow('失效')
  expect(restore).not.toHaveBeenCalled()
  await expect(undoIntent(tokens.at(-1)!)).resolves.toMatchObject({ status: 'completed' })
  expect(restore).toHaveBeenCalledTimes(1)
})
