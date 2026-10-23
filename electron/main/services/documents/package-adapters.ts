import type { DocumentKindId, DocumentListSummary } from '../../../../src/core/documents/types'

/*
 * 单文件包类型（图片文档 `.hjimg`）与文件夹类型（网页录制 `.hjweb`）的头信息适配接口。
 *
 * 通用服务对这两种类型只做文件级操作（改名、移动、副本、回收站、在文件夹中显示）；
 * 换 ID、改名、草稿标记这些写在包里的头信息由适配器原子改写，包内其余内容不动。
 * 图片文档的适配器、工作副本与写回由 3.5 实现并在这里登记；没有适配器的包类型扫描时跳过。
 * 文件夹类型的位置是一个文件夹，大小与修改时间按其中的头信息文件计（headerFile）。
 */

export interface PackageDocumentHeader {
  id: string
  name: string
  draft: boolean
  revision: number
  kindVersion: number
  /** ISO 8601。 */
  createdAt: string
  updatedAt: string
  summary: DocumentListSummary
}

export interface PackageDocumentHeaderPatch {
  id?: string
  name?: string
  draft?: boolean
}

export interface PackageDocumentAdapter {
  readonly kind: DocumentKindId
  /** 只用于文件夹类型：文件夹里承载头信息的文件（相对位置），扫描按它判断文档是否改动过。 */
  readonly headerFile?: string
  readHeader(filePath: string): Promise<PackageDocumentHeader>
  /** 原子改写头信息；失败时文件保持原样。 */
  writeHeader(filePath: string, patch: PackageDocumentHeaderPatch): Promise<void>
  /** 草稿离开时是否为空（空草稿直接删除）。 */
  isEmpty(filePath: string): Promise<boolean>
}

export interface PackageAdapterRegistry {
  get(kind: DocumentKindId): PackageDocumentAdapter | undefined
}

export function createPackageAdapterRegistry(adapters: readonly PackageDocumentAdapter[] = []): PackageAdapterRegistry {
  const byKind = new Map<DocumentKindId, PackageDocumentAdapter>()
  for (const adapter of adapters) {
    if (byKind.has(adapter.kind)) throw new Error(`单文件包适配器重复登记：${adapter.kind}`)
    byKind.set(adapter.kind, adapter)
  }
  return { get: (kind) => byKind.get(kind) }
}
