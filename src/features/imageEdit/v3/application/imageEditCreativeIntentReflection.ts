import type { ApplicationRef } from '@/core/application-control'
import type { MotionDraft } from '@/core/creativeIntent/contracts'
import { creativeIntentLiveResources, type CreativeIntents } from '@/core/creativeIntent/persistence'
import { listImageEditDocumentInstancesV3, requireImageEditDocumentInstanceV3, getImageEditDocumentCatalogRevisionV3 } from './imageEditDocumentInstances'
import { imageEditV3DocumentRef, splitImageEditV3DocumentRef } from './imageEditDocumentRefs'
import { imageEditLayoutDraft } from './imageEditLayoutDraft'
import { requireImageEditPersistenceOwnerV3 } from './imageEditPersistenceOperations'
import { readImageLayoutResource, imageLayoutDigest } from './imageEditLayoutResources'
const empty = (): CreativeIntents => ({ drafts: [], sessions: [], resources: [] })
function open(documentRef: ApplicationRef) {
  const id = splitImageEditV3DocumentRef(documentRef).documentId; const owner = requireImageEditDocumentInstanceV3(id); const bus = owner.bus
  const assertCurrent = () => { if (requireImageEditDocumentInstanceV3(id) !== owner || bus.getLifecycleSignal().aborted) throw new Error('原图片已关闭，请重新读取原稿。') }
  const adapter = imageEditLayoutDraft(bus)
  return {
    documentRef, owner, assertCurrent,
    size: (): [number, number] => { const geometry = bus.getSnapshot().document.geometry; return [geometry.width, geometry.height] },
    selected: (draft: MotionDraft) => { const state = adapter.snapshot(); return state.draft?.id === draft.id ? draft.candidateRefs[state.candidates.findIndex(c => c.id === state.selected)]?.resourceId : draft.selectedCandidateRef },
    checkpoint: () => { const position = bus.getHistoryView().position; return () => {
      const end = bus.getHistoryView().position, keys: string[] = []
      for (let offset = position + 1; offset <= end; offset += 64) keys.push(...bus.readHistoryPage(offset, Math.min(64, end - offset + 1)).map(row => row.key))
      return async () => { assertCurrent(); if (keys.length && !await bus.undoCommands([...keys].reverse())) throw new Error('历史已变化，请从图片历史恢复。'); requireImageEditPersistenceOwnerV3(id).acceptCurrent() }
    } },
    read: () => { assertCurrent(); return bus.getSnapshot().document.creativeIntents ?? empty() },
    commit: (head: CreativeIntents) => {
      assertCurrent(); requireImageEditPersistenceOwnerV3(id).assertCurrent()
      const document = bus.getSnapshot().document
      bus.dispatch({ type: 'document.set-creative-intents', commandId: crypto.randomUUID(), expectedRevision: document.revision, intents: head,
        resources: creativeIntentLiveResources([document.creativeIntents, head]).map(r => ({ resourceId: r.resourceId, byteSize: r.bytes })) })
      requireImageEditPersistenceOwnerV3(id).acceptCurrent()
    },
    save: async () => { assertCurrent(); await requireImageEditPersistenceOwnerV3(id).confirm(true); assertCurrent() },
    async prepare(draft: MotionDraft) { assertCurrent(); if (adapter.snapshot().status === 'optimizing') throw new Error('请等待当前整理结束。'); await adapter.reopen(draft.id); assertCurrent() },
    async configure(values: { fidelity?: number; pinSampleId?: string; unpinId?: string; selectedTakeIds?: string[] }) {
      if (requireImageEditPersistenceOwnerV3(id).isBusy()) throw new Error('图片原稿参数尚未接入批量保存事务，请在随手摆面板调整。')
      if (values.selectedTakeIds) throw new Error('图片原稿使用全部静态图层，不支持排除采样段。')
      const entry = values.pinSampleId ? adapter.snapshot().entries.find(e => e.sample.sampleId === values.pinSampleId) : undefined
      if (values.pinSampleId && !entry) throw new Error('原稿中没有这个钉住姿态。')
      await adapter.configure({ fidelity: values.fidelity, unpin: values.unpinId, pinIds: entry ? [entry.layerId] : undefined })
    },
    async optimize(signal?: AbortSignal) {
      signal?.throwIfAborted(); assertCurrent()
      const cancel = () => adapter.cancel()
      signal?.addEventListener('abort', cancel, { once: true })
      try { await adapter.organize([]); signal?.throwIfAborted() }
      finally { signal?.removeEventListener('abort', cancel) }
    },
    async select(resourceId: string) { const state = adapter.snapshot(); const index = state.draft?.candidateRefs.findIndex(r => r.resourceId === resourceId) ?? -1; const candidate = state.candidates[index]; if (!candidate) throw new Error('候选已过期，请重新整理。'); adapter.preview(candidate.id) },
    apply: () => { if (requireImageEditPersistenceOwnerV3(id).isBusy()) throw new Error('图片候选应用尚未接入批量保存事务，请在随手摆面板确认应用。'); return adapter.apply() },
  }
}
export const imageCreativeIntentProvider = {
  domain: 'image_edit' as const,
  documents: () => listImageEditDocumentInstancesV3().map(v => imageEditV3DocumentRef(v.documentId)),
  revisions: () => ({ image_edit: getImageEditDocumentCatalogRevisionV3() }),
  readResource: readImageLayoutResource,
  digest: imageLayoutDigest,
  open,
}
