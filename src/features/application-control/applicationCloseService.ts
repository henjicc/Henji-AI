import { runApplicationCloseGuards } from '@/core/applicationLifecycle/applicationCloseGuards'
import { freezeApplicationWrites } from '@/core/applicationLifecycle/applicationWriteBarrier'
import { hasActiveCanvasProjectWork, listCanvasProjectInstances } from '@/features/canvas/application/canvasProjectInstances'
import { hasActiveCameraStageProjectWork, listCameraStageProjectInstances, saveCameraStageProjectRuntime } from '@/features/cameraStage/application/cameraStageProjectRuntime'
import { hasActiveImageEditDocumentWorkV3, listImageEditDocumentInstancesV3, saveImageEditDocumentInstanceV3 } from '@/features/imageEdit/v3/application/imageEditDocumentInstances'
import { hasLoadingImageEditDocumentsV3 } from '@/features/imageEdit/v3/application/imageEditDocumentLoading'
import { flushCanvasProjectSnapshot } from '@/stores/projectStore'
import { hasActiveApplicationInvocations } from './applicationCapabilityService'

export class ApplicationCloseBusyError extends Error {
  constructor() { super('还有操作正在进行。请等待完成，或取消相应任务后再关闭应用。') }
}

function assertIdle(): void {
  if (hasActiveApplicationInvocations() || hasActiveCanvasProjectWork() || hasActiveCameraStageProjectWork()
    || hasActiveImageEditDocumentWorkV3() || hasLoadingImageEditDocumentsV3()) throw new ApplicationCloseBusyError()
}

let pending: Promise<void> | undefined

/** 全部实例保存成功才确认窗口关闭；失败保留业务状态与正常调用入口。 */
export function closeApplication(confirmClose: () => Promise<void>): Promise<void> {
  if (pending) return pending
  const operation = (async () => {
    assertIdle()
    await runApplicationCloseGuards()
    const projectedVersions = new Map<string, number>()
    // 图片投影可能更新画布，先完成投影，再冻结最终提交快照。
    for (const instance of listImageEditDocumentInstancesV3()) {
      if (instance.persistenceOwner) {
        await saveImageEditDocumentInstanceV3(instance.documentId, true)
        if (instance.dirty) throw new ApplicationCloseBusyError()
        projectedVersions.set(instance.documentId, instance.revision)
      }
      else if (instance.dirty) throw new Error('图片文档尚未保存，请先为文档选择保存位置。')
    }
    for (const instance of listCameraStageProjectInstances()) {
      if (instance.store.getState().playback.playing) instance.store.getState().pause()
      instance.store.endHistorySession()
    }
    const unfreeze = freezeApplicationWrites()
    try {
      assertIdle()
      for (const instance of listImageEditDocumentInstancesV3()) {
        if (instance.persistenceOwner && projectedVersions.get(instance.documentId) !== instance.revision) throw new ApplicationCloseBusyError()
        if (instance.persistenceOwner) await saveImageEditDocumentInstanceV3(instance.documentId)
        else if (instance.dirty) throw new Error('图片文档尚未保存，请先为文档选择保存位置。')
      }
      for (const instance of listCanvasProjectInstances()) await flushCanvasProjectSnapshot(instance.id)
      for (const instance of listCameraStageProjectInstances()) await saveCameraStageProjectRuntime(instance.id)
      await confirmClose()
    } finally { unfreeze() }
  })()
  pending = operation
  void operation.finally(() => { if (pending === operation) pending = undefined }).catch(() => undefined)
  return operation
}
