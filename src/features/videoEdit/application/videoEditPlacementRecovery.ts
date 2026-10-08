import type { LocalHostRequest } from '@/core/application-control/localHostContracts'
import type { ApplicationExecutionContext } from '@/core/application-control/execution/types'
import { openVideoEditDocument, requireVideoEditInstance, verifyVideoEditSaved } from './videoEditService'

/** 只在旧渲染会话结束后调用；身份与落位共存于同一文档提交，不从名称/参数猜执行结果。 */
export async function recoverVideoEditPlacement(request: NonNullable<LocalHostRequest['recoveryOperation']>, context: ApplicationExecutionContext): Promise<Record<string, unknown> | undefined> {
  const proof = request.atomicPlacement
  if (!proof) return undefined
  if (!context.permissions.has('video_edit:read')) throw new Error('PERMISSION_DENIED:核对原剪辑需要读取授权。')
  context.signal?.throwIfAborted()
  const owner = await openVideoEditDocument({ id: proof.documentId }, { focus: false })
  const baseline = owner.document
  const placement = baseline.creativePlacements?.find(value => value.operationId === proof.operationId)
  context.signal?.throwIfAborted()
  if (!placement) return { ok: false, error: { code: 'PLACEMENT_NOT_RETAINED', message: '原宿主已结束，当前剪辑没有保留此次放入修改；原生成文件仍可复用。',
    details: { execution: { notExecuted: true } } } }
  const item = baseline.items.find(value => value.id === placement.itemId)
  const media = baseline.media.find(value => value.id === item?.mediaId)
  const clip = placement.clipId ? baseline.sequences.find(value => value.id === placement.sequenceId)?.clips.find(value => value.id === placement.clipId) : undefined
  // 用户之后移除/替换了结果时，不能把当前内容冒充原成功验证。
  const retained = Boolean(item && media?.assetId === placement.assetId && (!placement.clipId || clip?.itemId === item.id))
  const saved = await verifyVideoEditSaved(proof.documentId, baseline)
  context.signal?.throwIfAborted()
  if (!saved || requireVideoEditInstance(proof.documentId) !== owner || owner.document !== baseline) return undefined
  const resultRef = { kind: placement.clipId ? 'video_edit.clip' : 'video_edit.item', id: `${proof.documentId}:${placement.clipId || placement.itemId}` }
  return { ok: true, data: { resultRef, documentRef: { kind: 'video_edit.document', id: proof.documentId }, assetRef: { kind: 'asset', id: placement.assetId },
    message: retained ? '已从原剪辑核对并保存的放入结果，不会重复放入。' : '原操作已经执行，结果已被后续修改或移除。',
    verification: { verified: retained, target: resultRef, condition: retained ? '操作身份、实际素材或片段与已保存剪辑一致。' : '保存的操作身份证明已经执行，当前结果与原落位不同。' } } }
}
