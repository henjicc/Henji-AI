import { z } from 'zod'

import { documentNameFromFileName, normalizeEntryName, sameEntryName } from '../naming'
import type { DocumentKindId, DocumentListSummary, FolderLocale } from '../types'

/*
 * 文档类型登记（实施方案 2.6）：每种文档只登记一份说明，通用服务只读登记表，
 * 不写“某个工具”的分支。新增类型 = kinds/ 下新增一个文件 + 在 kinds/index.ts 登记一行。
 *
 * 这里是主进程与渲染层共用的纯部分（格式、位置、版本、内容规则）；
 * 显示名、图标、打开方式等界面部分由渲染层另行登记。
 */

export type DocumentStorageMode = 'json' | 'package'

export interface DocumentKindDescriptor<TContent = unknown> {
  readonly id: DocumentKindId
  /** 文件扩展名，含点、小写，如 `.henji-canvas`。 */
  readonly extension: string
  /** 独立存放（不属于任何项目）时所在的作品目录子文件夹名；null 表示只能放在项目里（剪辑）。 */
  readonly standaloneFolderNames: Readonly<Record<FolderLocale, string>> | null
  /** 新建草稿的自动名前缀，如“未命名画布”（后面接序号）。 */
  readonly untitledNames: Readonly<Record<FolderLocale, string>>
  /** json：外壳 + 内容的 JSON 文件；package：单文件包（图片文档），头信息由主进程包适配器读写。 */
  readonly storage: DocumentStorageMode
  /** 当前内容版本（外壳里的 kindVersion）。 */
  readonly version: number
  /** 内存形态（位置都是绝对路径）的内容 schema。 */
  readonly contentSchema: z.ZodType<TContent>
  /** 把 fromVersion 版本的内容升级到当前版本；fromVersion 小于 version 时调用。 */
  upgradeContent(content: unknown, fromVersion: number): unknown
  createEmptyContent(): TContent
  /** 草稿离开时内容为空就直接删除，不询问。 */
  isEmptyContent(content: TContent): boolean
  /** 列表摘要（如节点数），写进作品索引。 */
  summarize(content: TContent): DocumentListSummary
}

export interface DocumentKindRegistry {
  list(): readonly DocumentKindDescriptor[]
  get(id: string): DocumentKindDescriptor | undefined
  /** 未登记时抛错。 */
  require(id: string): DocumentKindDescriptor
  /** 按文件名的扩展名找类型（不分大小写）。 */
  forFileName(fileName: string): DocumentKindDescriptor | undefined
}

export class DocumentKindError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DocumentKindError'
  }
}

const EXTENSION_PATTERN = /^\.[a-z0-9][a-z0-9-]{0,31}$/

function validateDescriptor(kind: DocumentKindDescriptor): void {
  if (!EXTENSION_PATTERN.test(kind.extension)) throw new DocumentKindError(`文档类型 ${kind.id} 的扩展名无效：${kind.extension}`)
  if (!Number.isSafeInteger(kind.version) || kind.version < 1) throw new DocumentKindError(`文档类型 ${kind.id} 的版本无效`)
  const names = [
    ...Object.values(kind.untitledNames),
    ...(kind.standaloneFolderNames ? Object.values(kind.standaloneFolderNames) : []),
  ]
  for (const name of names) {
    const check = normalizeEntryName(name)
    if (!check.ok || check.name !== name) throw new DocumentKindError(`文档类型 ${kind.id} 的名称不能用作文件名：${name}`)
  }
}

export function createDocumentKindRegistry(kinds: readonly DocumentKindDescriptor[]): DocumentKindRegistry {
  const byId = new Map<string, DocumentKindDescriptor>()
  for (const kind of kinds) {
    validateDescriptor(kind)
    if (byId.has(kind.id)) throw new DocumentKindError(`文档类型重复登记：${kind.id}`)
    for (const other of byId.values()) {
      if (other.extension === kind.extension) throw new DocumentKindError(`文档扩展名重复：${kind.extension}`)
      for (const locale of ['zh', 'en'] as const) {
        const left = other.standaloneFolderNames?.[locale]
        const right = kind.standaloneFolderNames?.[locale]
        if (left && right && sameEntryName(left, right)) throw new DocumentKindError(`独立存放文件夹重名：${right}`)
      }
    }
    byId.set(kind.id, kind)
  }
  const list = Object.freeze([...byId.values()])
  return {
    list: () => list,
    get: (id) => byId.get(id),
    require(id) {
      const kind = byId.get(id)
      if (!kind) throw new DocumentKindError(`未登记的文档类型：${id}`)
      return kind
    },
    forFileName(fileName) {
      return list.find((kind) => documentNameFromFileName(fileName, kind.extension) !== null)
    },
  }
}

/** 内容 schema 尚未补全的类型（各工具接入任务补全）：任意 JSON 对象。 */
export const placeholderContentSchema = z.record(z.string(), z.unknown())
export type PlaceholderContent = z.infer<typeof placeholderContentSchema>

export interface SkeletonKindOptions {
  id: DocumentKindId
  extension: string
  standaloneFolderNames: Readonly<Record<FolderLocale, string>> | null
  untitledNames: Readonly<Record<FolderLocale, string>>
  storage: DocumentStorageMode
}

/**
 * 骨架类型：版本 1、内容为任意对象、空对象即空内容、列表摘要为空。
 * 各工具接入时用真实的内容 schema、空内容判断与列表摘要替换（实施方案第三节共同清单第 1 条）。
 */
export function defineSkeletonDocumentKind(options: SkeletonKindOptions): DocumentKindDescriptor<PlaceholderContent> {
  return {
    ...options,
    version: 1,
    contentSchema: placeholderContentSchema,
    upgradeContent: (content) => content,
    createEmptyContent: () => ({}),
    isEmptyContent: (content) => Object.keys(content).length === 0,
    summarize: () => ({}),
  }
}
