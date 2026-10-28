// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createVideoEditSequence } from '@/core/videoEdit/document'
import type { ReloadResumeView } from '@/features/documents/rendererReloadResume'
import { harnessDocumentStore, installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { closeAllVideoEdits, createVideoEditTestProject, reopenVideoEdit, replaceSavedVideoEdit, savedVideoEdit } from './videoEditDocumentTestKit'
import { switchVideoEditSequence } from './videoEditService'

const reload = vi.hoisted(() => ({ view: null as ReloadResumeView | null }))
vi.mock('@/features/documents/rendererReloadResume', () => ({ registerReloadResumeView: (_kind: string, view: ReloadResumeView) => { reload.view = view; return () => {} } }))

beforeEach(() => installHarnessNativeStorage())
afterEach(async () => { await closeAllVideoEdits(); uninstallHarnessNativeStorage() })

async function twoSequenceProject(): Promise<{ id: string; first: string; second: string }> {
  const created = await createVideoEditTestProject()
  const document = structuredClone(created.document)
  const second = { ...createVideoEditSequence('正片'), markers: [{ id: 'end', frame: 299, name: '结尾' }] }
  document.sequences.push(second)
  replaceSavedVideoEdit(document.id, document)
  await reopenVideoEdit(document.id)
  return { id: document.id, first: document.sequences[0].id, second: second.id }
}

it('重新打开回到上次所在的序列；那条被删掉时回到第一条', async () => {
  const { id, first, second } = await twoSequenceProject()
  switchVideoEditSequence(id, second)
  await vi.waitFor(async () => expect(await harnessDocumentStore().readSessionState({ docId: id, key: 'video_edit.sequence' })).toEqual({ sequenceId: second }))
  expect((await reopenVideoEdit(id)).activeSequenceId).toBe(second)
  const document = savedVideoEdit(id)
  replaceSavedVideoEdit(id, { ...document, sequences: document.sequences.filter(sequence => sequence.id !== second) })
  const reopened = await reopenVideoEdit(id)
  expect(reopened.activeSequenceId).toBe(first)
  expect(reopened.openSequenceIds).toEqual([first])
})

it('页面重新加载后切回原来的序列标签与播放头，序列已不存在时不动', async () => {
  const { id, first, second } = await twoSequenceProject()
  const instance = await reopenVideoEdit(id)
  reload.view!.restore(id, { sequenceId: second, openSequenceIds: [first, second], frame: 120 })
  expect(instance.activeSequenceId).toBe(second)
  expect(instance.openSequenceIds).toEqual([first, second])
  expect(instance.frame).toBe(120)
  expect(reload.view!.capture()[id]).toEqual({ sequenceId: second, openSequenceIds: [first, second], frame: 120 })
  reload.view!.restore(id, { sequenceId: 'deleted', openSequenceIds: ['deleted'], frame: 5 })
  expect(instance.activeSequenceId).toBe(second)
  expect(instance.frame).toBe(120)
})
