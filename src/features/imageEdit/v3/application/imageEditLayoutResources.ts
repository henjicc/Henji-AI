import { getPlatform } from '@/platform/runtime'
import { createImageEditorV3RequestId } from '@/commands/imageEditorV3'
import type { StoredCreativeIntentResource } from '@/core/creativeIntent/persistence'

export async function imageLayoutDigest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  const digest = await crypto.subtle.digest('SHA-256',bytes)
  return `sha256:${[...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('')}`
}
export async function storeImageLayoutResource(value: unknown, kind: StoredCreativeIntentResource['kind'], leaseId: string): Promise<StoredCreativeIntentResource> {
  const store = getPlatform().imageEditorV3.writeLayoutResource
  if (!store) throw new Error('随手摆资源保存不可用，请更新应用')
  const resource = await store({ requestId:createImageEditorV3RequestId('layout-write'), leaseId, value })
  return { resourceId:resource.resourceRef, digest:resource.resourceRef, bytes:resource.byteLength, path:`resources/${resource.resourceRef.slice(7)}`, kind,
    ...('sourceDigest' in (value as object) ? { sourceDigest:(value as {sourceDigest:string}).sourceDigest } : {}) }
}
export async function releaseImageLayoutResources(leaseId: string): Promise<void> {
  const release = getPlatform().imageEditorV3.releaseLayoutResources
  if (!release) throw new Error('随手摆资源释放不可用')
  await release({ requestId:createImageEditorV3RequestId('layout-release'), leaseId })
}
export async function readImageLayoutResource(resource: StoredCreativeIntentResource): Promise<unknown> {
  const read = getPlatform().imageEditorV3.readLayoutResource
  if (!read) throw new Error('随手摆资源读取不可用，请更新应用')
  if (resource.resourceId !== resource.digest) throw new Error('随手摆原稿引用与内容摘要不符，请恢复原文件')
  const value = await read({ requestId:createImageEditorV3RequestId('layout-read'), resourceRef:resource.resourceId as `sha256:${string}` })
  // 主进程 readVerifiedBuffer 已验证原始字节；迁移后的内存值不能再与旧字节摘要比较。
  return value
}
