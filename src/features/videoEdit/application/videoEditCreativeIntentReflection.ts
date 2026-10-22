import { reopenVideoExplanation, videoExplanationState } from './videoEditExplanation'
import { explanationBodyEditor, explanationBodyRef, type ExplanationBodyEditor } from '@/core/creativeIntent/semanticIntentEdits'
import type { ApplicationRef } from '@/core/application-control'
import type { MotionDraft } from '@/core/creativeIntent/contracts'
import type { CreativeIntents } from '@/core/creativeIntent/persistence'
import { listVideoEditInstances, requireVideoEditInstance, updateVideoEditCreativeIntents, videoEditDomainRevision, saveVideoEdit, restoreVideoEditSnapshot, getActiveVideoEditSequence } from './videoEditService'
import { reopenVideoMotion, videoMotionState, configureVideoMotion, optimizeVideoMotion, cancelVideoMotionOptimization, previewVideoMotion, applyVideoMotion, syncVideoMotionMetadata } from './videoEditMotionDraft'
import { readMotionResource, readMotionResourceBytes, motionDigest } from './videoEditMotionResources'
const empty = (): CreativeIntents => ({ drafts: [], sessions: [], resources: [] })
function open(documentRef: ApplicationRef) {
    const id = documentRef.id; const owner = requireVideoEditInstance(id)
    const assertCurrent = () => { if (requireVideoEditInstance(id) !== owner) throw new Error('原剪辑已关闭，请重新读取原稿。') }
    return {
      documentRef, owner, assertCurrent,
    explanationEditor: (sessionId: string): ExplanationBodyEditor => {
        const resolve = async (): Promise<ExplanationBodyEditor> => { assertCurrent(); if (videoExplanationState(owner)?.collector.session.id !== sessionId) await reopenVideoExplanation(id, sessionId); return explanationBodyEditor(explanationBodyRef(documentRef, sessionId)) }
        return { apply: async (changes, context) => (await resolve()).apply(changes, context), restore: async (session, context) => (await resolve()).restore(session, context) }
      },
      size: (): [number, number] => { const sequence = getActiveVideoEditSequence(owner); return [sequence.width, sequence.height] },
      selected: (draft: MotionDraft) => draft.selectedCandidateRef,
      checkpoint: () => {
        const before = owner.document
        return () => {
          const after = owner.document
          return async () => {
            assertCurrent()
            if (JSON.stringify(owner.document.creativeIntents) !== JSON.stringify(after.creativeIntents)) throw new Error('原稿已有后续修改，请先读取当前状态。')
            // Artwork history deliberately preserves intent metadata; this transaction also owns its head.
            restoreVideoEditSnapshot(id, after, before)
            updateVideoEditCreativeIntents(id, before.creativeIntents ?? empty())
            const current = videoMotionState(owner)
            if (current?.status === 'reviewing' && before.creativeIntents?.drafts.some(d => d.id === current.draft.id)) await reopenVideoMotion(id, current.draft.id)
          }
        }
      },
      read: () => { assertCurrent(); return owner.document.creativeIntents ?? empty() },
      commit: (head: CreativeIntents) => { assertCurrent(); const state = videoMotionState(owner); if (state && state.status !== 'reviewing') throw new Error('请先结束当前示范或整理。'); updateVideoEditCreativeIntents(id, head); syncVideoMotionMetadata(owner) },
      save: async () => { assertCurrent(); await saveVideoEdit(id); assertCurrent() },
      async prepare(draft: MotionDraft) {
        assertCurrent()
        // Reopening the UI service navigates. Public background work must not silently do so.
        if (!draft.targets.some(t => t.ref.id === `${id}:${owner.selection}`)) throw new Error('请在原剪辑选中此原稿的片段后整理；不会切换当前编辑目标。')
        const state = videoMotionState(owner)
        if (state && state.status !== 'reviewing') throw new Error('请先结束当前录制或整理。')
        await reopenVideoMotion(id, draft.id); assertCurrent()
      },
      configure: (values: { fidelity?: number; pinSampleId?: string; unpinId?: string; selectedTakeIds?: string[] }) => configureVideoMotion(id, values),
      async optimize(signal?: AbortSignal) {
        signal?.throwIfAborted(); assertCurrent()
        const cancel = () => { if (listVideoEditInstances().includes(owner)) cancelVideoMotionOptimization(id) }
        signal?.addEventListener('abort', cancel, { once: true })
        try { await optimizeVideoMotion(id); signal?.throwIfAborted() }
        finally { signal?.removeEventListener('abort', cancel) }
      },
      async select(resourceId: string) { const state = videoMotionState(owner)!; const index = state.draft.candidateRefs.findIndex(r => r.resourceId === resourceId); const candidate = state.candidates[index]; if (!candidate) throw new Error('候选已过期，请重新整理。'); await previewVideoMotion(id, candidate.id) },
      apply: () => applyVideoMotion(id),
      recoverApplication: () => applyVideoMotion(id),
    }
}
export const videoCreativeIntentProvider = {
  domain: 'video_edit' as const,
  documents: () => listVideoEditInstances().map(v => ({ kind: 'video_edit.document', id: v.document.id })),
  revisions: () => ({ video_edit: videoEditDomainRevision() }),
  readResource: readMotionResource,
  readVisual: readMotionResourceBytes,
  digest: motionDigest,
  configureMotion: configureVideoMotion,
  open,
}
