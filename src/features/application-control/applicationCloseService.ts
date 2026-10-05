import { hasActiveAudioEditProjectWork } from '@/features/audioEdit/application/audioEditProjectInstances'
import { runApplicationCloseGuards } from '@/core/applicationLifecycle/applicationCloseGuards'
import { freezeApplicationWrites } from '@/core/applicationLifecycle/applicationWriteBarrier'
import { hasActiveCanvasProjectWork } from '@/features/canvas/application/canvasProjectInstances'
import { hasActiveCameraStageProjectWork, listCameraStageProjectInstances } from '@/features/cameraStage/application/cameraStageProjectRuntime'
import { getDocumentSessionRegistry } from '@/features/documents/documentSessionRegistry'
import { hasActiveImageEditDocumentWorkV3, listImageEditDocumentInstancesV3, saveImageEditDocumentInstanceV3 } from '@/features/imageEdit/v3/application/imageEditDocumentInstances'
import { hasLoadingImageEditDocumentsV3 } from '@/features/imageEdit/v3/application/imageEditDocumentLoading'
import { hasActiveApplicationInvocations } from './applicationCapabilityService'

export class ApplicationCloseBusyError extends Error {
  constructor() { super('还有操作正在进行。请等待完成，或取消相应任务后再关闭应用。') }
}

function assertIdle(): void {
  if (hasActiveApplicationInvocations() || hasActiveCanvasProjectWork() || hasActiveCameraStageProjectWork()
    || hasActiveImageEditDocumentWorkV3() || hasLoadingImageEditDocumentsV3() || hasActiveAudioEditProjectWork()) throw new ApplicationCloseBusyError()
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
      // 通用文档会话的第二轮保存（3.2；口播 3.3、画布 3.4 起也在其中）：关闭屏障守卫跑完到冻结之间的修改也写完；各工具不再逐个保存
      await getDocumentSessionRegistry().flushAll()
      await confirmClose()
    } finally { unfreeze() }
  })()
  pending = operation
  void operation.finally(() => { if (pending === operation) pending = undefined }).catch(() => undefined)
  return operation
}
