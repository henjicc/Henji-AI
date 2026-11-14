import { UNDO_HISTORY_STEPS } from '@/core/undoHistory'
import { expect, it, vi } from 'vitest'
import type { ApplicationRef } from '@/core/application-control'

const state = vi.hoisted(() => ({ erased: undefined as undefined | ((ref: ApplicationRef) => void) }))
vi.mock('@/core/creativeIntent/semanticIntentEdits', () => ({ onExplanationBodyErased: (callback: (ref: ApplicationRef) => void) => { state.erased = callback } }))
vi.mock('./creativeIntentExplanation', () => ({ explanationBodyRecord: () => ({ session: { consent: { textUpload: true }, sourceDigest: 'digest' }, host: { assertCurrent: () => {} } }) }))
import * as authorization from './creativeIntentAuthorization'

it('私密撤销按撤销步数有界保留，淘汰同时释放关联公开回执，擦除时释放剩余项', () => {
  const body = { kind: 'video_edit.explanation_body', id: 'document:session' }
  const release = Array.from({ length: UNDO_HISTORY_STEPS + 1 }, () => vi.fn())
  for (let i = 0; i <= UNDO_HISTORY_STEPS; i++) authorization.rememberExplanationUndoAccess(`undo-${i}`, [body], release[i])
  expect(release[0]).toHaveBeenCalledOnce()
  state.erased!(body)
  for (const callback of release) expect(callback).toHaveBeenCalledOnce()
})
