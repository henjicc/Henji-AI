import { cancelLocalModelDownloadCapability } from '@/core/application-control/domains/localModels/localModelCapabilities'
import { cancelLocalModelDownload, getLocalModelsState } from '@/commands/localModels'
import { isLocalModelId } from '@/platform/contracts/localModels'
import type { CapabilityExecutionContext } from '@/features/application-control/capabilities/handlerTypes'

/** 下载取消是任务生命周期动作，不伪装为 downloaded=false（删除）或一个可写状态开关。 */
export async function cancelLocalModelDownloadFromCapability(raw: unknown, context: CapabilityExecutionContext) {
  const { modelRef } = cancelLocalModelDownloadCapability.inputSchema.parse(raw)
  const before = await getLocalModelsState()
  if (!isLocalModelId(modelRef.id) || !before.models.some(model => model.id === modelRef.id)) {
    throw new Error(`NOT_FOUND:没有这个本地模型，可用的有 ${before.models.map(model => model.id).join('、')}`)
  }
  context.signal?.throwIfAborted()
  const requested = await cancelLocalModelDownload(modelRef.id)
  const model = (await getLocalModelsState()).models.find(model => model.id === modelRef.id)!
  const cancelled = requested && model.lastFailure === 'cancelled' && model.status !== 'downloading'
  const verified = model.status !== 'downloading'
  return { resultRef: modelRef, cancelled, status: model.status,
    message: cancelled ? '下载已停止，已下载部分保留，下次可续传。' : model.status === 'ready' ? '模型已经下载完成，无需取消。' : verified ? '没有正在进行的下载，本地文件未删除。' : '这个模型又有下载正在进行，请读取当前状态后再取消。',
    verification: { verified, target: modelRef, condition: verified ? '已从设置页共用的下载服务回读，目标模型没有进行中的下载。' : '回读仍在下载，不能确认已经停止。' },
  }
}
