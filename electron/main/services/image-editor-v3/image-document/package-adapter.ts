import type {
  PackageDocumentAdapter,
  PackageDocumentHeader,
  PackageDocumentHeaderPatch,
} from '../../documents/package-adapters'
import { createMainLogger } from '../../logging'
import { isImageDocumentHeaderEmpty } from './header'
import { readImageDocumentPackageHeader, rewriteImageDocumentPackageHeader } from './package-file'

/*
 * 图片文档（`.henjiimg`）的单文件包适配器（3.5）：登记在文档底座的适配器登记处，
 * 之后扫描、改名、移动、副本、回收站、删空草稿都由通用文档仓库完成。
 *
 * - 名称不写进包，改名只改文件名（patch 里只有 name 时不重写包）。
 * - 换 ID（副本、扫描发现拷贝）与草稿标记变化时整包重写，包内清单的 V3 文档 ID 跟着改。
 * - 空内容判断只看包头：新建空白图片后没有任何编辑。
 */

const logger = createMainLogger('main.image_editor_v3.image_document.adapter')

export function createImageDocumentPackageAdapter(): PackageDocumentAdapter {
  return {
    kind: 'image_document',
    async readHeader(filePath: string): Promise<PackageDocumentHeader> {
      const { header } = await readImageDocumentPackageHeader(filePath)
      return {
        id: header.id,
        // 文档名以文件名为准；通用仓库对外一律用文件名，这里给什么都不会被显示。
        name: '',
        draft: header.draft,
        revision: header.revision,
        kindVersion: header.kindVersion,
        createdAt: header.createdAt,
        updatedAt: header.updatedAt,
        summary: { ...header.summary },
      }
    },
    async writeHeader(filePath: string, patch: PackageDocumentHeaderPatch): Promise<void> {
      if (patch.id === undefined && patch.draft === undefined) return
      const header = await rewriteImageDocumentPackageHeader(filePath, { id: patch.id, draft: patch.draft })
      logger.info('图片文档包头已更新', {
        event: 'image_document.header.rewritten',
        context: { documentId: header.id, idChanged: patch.id !== undefined, draft: header.draft },
      })
    },
    async isEmpty(filePath: string): Promise<boolean> {
      const { header } = await readImageDocumentPackageHeader(filePath)
      return isImageDocumentHeaderEmpty(header)
    },
  }
}
