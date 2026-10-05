import { z } from 'zod'

import type { DocumentKindDescriptor } from './registry'

/*
 * 图片文档（`.henjiimg`，3.5 图片文档）：沿用单文件包，一个文件就是全部（像 PSD）。
 * 可以独立存放（作品目录“图片文档”文件夹），也可以放进项目。
 *
 * 存储方式是单文件包：通用仓库只做文件级操作（改名、移动、副本、回收站、删空草稿），
 * 头信息由主进程包适配器读写；内容的读写走图片编辑器的工作副本：
 * 打开时把包解到程序目录的 V3 文档仓库（资源按哈希去重），编辑时高频自动保存到工作副本，
 * 保存、空闲与关闭时整包原子写回 `.henjiimg`。
 *
 * 所以会话里的“内容”不是图片本身，而是工作副本的描述：版本、成品尺寸、图层数，
 * 以及“新建空白图片后还没编辑过”的判断依据。图片、图层与历史都在工作副本里，由编辑器实例持有。
 */

export const imageDocumentContentSchema = z.object({
  /** 工作副本（V3 文档）的当前版本。 */
  workingRevision: z.number().int().nonnegative(),
  /** 新建空白图片时的版本；之后没有任何编辑（workingRevision 不超过它）就算空内容。从图片创建的为 null。 */
  emptyUntilRevision: z.number().int().nonnegative().nullable(),
  /** 成品尺寸（裁剪、旋转后）。 */
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
  /** 图层数（含组内图层）。 */
  layers: z.number().int().nonnegative(),
})

export type ImageDocumentContent = z.infer<typeof imageDocumentContentSchema>

export function isEmptyImageDocumentContent(content: Pick<ImageDocumentContent, 'workingRevision' | 'emptyUntilRevision'>): boolean {
  return content.emptyUntilRevision !== null && content.workingRevision <= content.emptyUntilRevision
}

export const imageDocumentKind: DocumentKindDescriptor<ImageDocumentContent> = {
  id: 'image_document',
  extension: '.henjiimg',
  standaloneFolderNames: { zh: '图片文档', en: 'Image Documents' },
  untitledNames: { zh: '未命名图片', en: 'Untitled Image' },
  storage: 'package',
  // 版本 1 = 包头格式第 1 版 + V3 图片编辑文档（V3 文档自己的格式版本写在包内清单里）。
  version: 1,
  contentSchema: imageDocumentContentSchema,
  upgradeContent: (content) => content,
  createEmptyContent: () => ({ workingRevision: 0, emptyUntilRevision: 0, width: 0, height: 0, layers: 0 }),
  isEmptyContent: isEmptyImageDocumentContent,
  summarize: (content) => ({ width: content.width, height: content.height, layers: content.layers }),
}
