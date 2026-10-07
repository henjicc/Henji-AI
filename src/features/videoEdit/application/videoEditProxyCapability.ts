import { generateVideoEditProxyCapability } from '@/core/application-control/domains/videoEdit/videoEditProxyCapability'
import type { CapabilityExecutionContext } from '@/features/application-control/capabilities/handlerTypes'
import { getPlatform } from '@/platform/runtime'
import { splitVideoEditRef } from './videoEditReflection'
import { createVideoEditProxy, readVideoEditProxyState } from './videoEditProxy'
import { requireVideoEditInstance } from './videoEditService'

export async function handleVideoEditProxyCapability(id: string, raw: unknown, context: CapabilityExecutionContext): Promise<Record<string, unknown> | undefined> {
  if (id !== generateVideoEditProxyCapability.id) return undefined
  const input = generateVideoEditProxyCapability.inputSchema.parse(raw)
  const target = splitVideoEditRef(input.mediaRef)
  if (target.projectId !== input.documentRef.id || !target.childId) throw new Error('mediaRef 必须属于目标剪辑，请使用素材目录返回的完整引用。')
  const owner = requireVideoEditInstance(target.projectId)
  const media = owner.document.media.find(value => value.id === target.childId)
  if (!media) throw new Error('素材已不存在，请重新读取素材目录。')
  const result = await createVideoEditProxy(target.projectId, media.id, input.preset, context.signal)
  context.signal?.throwIfAborted()
  const cached = await getPlatform().videoProxy.lookup({ source: media.path, preset: input.preset })
  const verified = requireVideoEditInstance(target.projectId) === owner && owner.document.media.find(value => value.id === media.id)?.path === media.path && cached?.key === result.key && readVideoEditProxyState(target.projectId, media.id).status === 'ready'
  return { resultRef: input.mediaRef, preset: input.preset, verified, message: '代理已创建，可开启代理看片；导出默认用原片，可在导出设置中选择代理画面。' }
}
