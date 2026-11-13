import { expect, it } from 'vitest'

import { placeVideoEditCreativeResultCapability } from './videoEditApplicationCapabilities'

const base = { documentRef: { kind: 'video_edit.document', id: 'edit-1' }, sequenceRef: { kind: 'video_edit.sequence', id: 'edit-1:seq-1' }, placement: { mode: 'library' } }

it('口播来源的文档引用两种写法都认，写错时点名期望的 kind', () => {
  for (const kind of ['documents.document', 'audio_edit.document']) {
    expect(placeVideoEditCreativeResultCapability.inputSchema.safeParse({ ...base, result: { type: 'document', documentRef: { kind, id: 'voice-1' } } }).success).toBe(true)
  }
  const wrong = placeVideoEditCreativeResultCapability.inputSchema.safeParse({ ...base, result: { type: 'document', documentRef: { kind: 'audio_edit.project', id: 'voice-1' } } })
  expect(wrong.success).toBe(false)
  expect(JSON.stringify(wrong.error?.issues)).toContain('audio_edit.document')
})
