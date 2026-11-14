import { persistedCanvasNodeDataSchema } from '../../persistence/businessSchemas'
import { z } from 'zod'

import { henjiExtension, henjiLegacyExtensions } from '../../fileExtensions'
import type { DocumentKindDescriptor } from './registry'

/*
 * 画布（`.hjcvs`，3.4 画布接入）：可以独立存放（作品目录“画布”文件夹），也可以放进项目。
 *
 * 内容 = 画布图的持久部分（内存形态，位置都是绝对路径）：
 * - nodes：节点（id / type / position / data，其余字段如尺寸、父节点、zIndex 原样保留）；
 * - edges：连线（id / source / target，句柄与样式字段原样保留）；
 * - imagePool：可选。缺失模型的参数无法按 schema 识别媒体字段，里面的 `__img_ref__:N` 引用指向这里，
 *   原池索引不能重新编号（canvas.md“缺失节点的工程恢复”）；
 * - layerPackages：可选。多图层节点内嵌图片文档的单文件包位置（文档 ID → 所在容器 `.henji/` 里的文件），
 *   随画布移动、拷贝时由通用素材复制带走（见 canvasLayers）。
 *
 * 撤销记录与视口不写进文档：按文档 ID 存在程序目录（文档会话状态），随时可丢。
 * 这里只校验外层结构，节点图的完整校验（ID 唯一、连线两端存在、媒体池引用合法）在画布打开时进行。
 * 嵌套对象一律保留未知字段：主进程保存时持久化的是 schema 解析结果，剥掉字段就等于丢数据。
 * 本文件主进程与渲染层共用，只用相对导入。
 */

const canvasNodeSchema = z.looseObject({
  id: z.string().min(1),
  type: z.string().min(1),
  position: z.looseObject({ x: z.number(), y: z.number() }),
  data: persistedCanvasNodeDataSchema,
})

const canvasEdgeSchema = z.looseObject({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
})

const canvasContentSchema = z.looseObject({
  nodes: z.array(canvasNodeSchema),
  edges: z.array(canvasEdgeSchema),
  imagePool: z.array(z.string()).optional(),
  layerPackages: z.record(z.string(), z.string()).optional(),
})

export type CanvasDocumentContent = z.infer<typeof canvasContentSchema>

type LooseRecord = Record<string, unknown>

const IMAGE_POOL_REFERENCE = /^__img_ref__:(\d+)$/
/** 程序缩略图目录里的派生图：`Thumbnails/<文件>` 或再隔一层尺寸目录（如 `Thumbnails/540/<文件>`）。 */
const PROGRAM_THUMBNAIL = /(?:^|\/)Thumbnails\/(?:[^/]+\/)?[^/]+\.(?:webp|jpe?g|png)$/i

/**
 * 是否指向程序缩略图目录（裸路径、file:// 或 henji-media://local/ 写法）。这类地址不该进节点：
 * 迁移把它从旧文件里去掉，显示端遇到撤销记录等带回来的旧值也按没有预览处理。
 */
export function isProgramThumbnailLocation(value: unknown): boolean {
  if (typeof value !== 'string') return false
  let location = value.trim()
  try {
    if (/^henji-media:\/\/local\//i.test(location)) location = decodeURIComponent(location.slice('henji-media://local/'.length))
    else if (/^file:\/\//i.test(location)) location = decodeURIComponent(location.slice('file://'.length))
  } catch {
    return false
  }
  return PROGRAM_THUMBNAIL.test(location.replace(/\\/g, '/'))
}

function isProgramThumbnail(value: unknown, imagePool: unknown): boolean {
  const pooled = typeof value === 'string' ? IMAGE_POOL_REFERENCE.exec(value) : null
  if (pooled) return Array.isArray(imagePool) && isProgramThumbnailLocation(imagePool[Number(pooled[1])])
  return isProgramThumbnailLocation(value)
}

function withoutProgramThumbnail(record: LooseRecord, imagePool: unknown): LooseRecord {
  if (!isProgramThumbnail(record.previewImageUrl, imagePool)) return record
  const rest = { ...record }
  delete rest.previewImageUrl
  return rest
}

/**
 * 1 → 2：节点预览不再指向程序缩略图目录。旧文件里素材库拖入、助手放入与本地导入的节点
 * 把 `Thumbnails/…` 里的缩略图绝对路径写进了 previewImageUrl，换机、搬数据目录或清缓存后就坏；
 * 这类值去掉，显示时按原媒体重取缓存缩略图。分镜格子的预览同理。媒体池原样保留，不重新编号。
 */
function migrateProgramThumbnailPreviewsV1(content: unknown): unknown {
  const next = structuredClone(content as LooseRecord)
  const imagePool = next.imagePool
  if (!Array.isArray(next.nodes)) return next
  next.nodes = next.nodes.map((node) => {
    if (!node || typeof node !== 'object') return node
    const record = node as LooseRecord
    if (!record.data || typeof record.data !== 'object') return record
    let data = withoutProgramThumbnail(record.data as LooseRecord, imagePool)
    if (Array.isArray(data.frames)) {
      data = { ...data, frames: data.frames.map((frame) => frame && typeof frame === 'object' ? withoutProgramThumbnail(frame as LooseRecord, imagePool) : frame) }
    }
    return { ...record, data }
  })
  return next
}

export const canvasDocumentKind: DocumentKindDescriptor<CanvasDocumentContent> = {
  id: 'canvas',
  extension: henjiExtension('canvas'),
  legacyExtensions: henjiLegacyExtensions('canvas'),
  standaloneFolderNames: { zh: '画布', en: 'Canvases' },
  untitledNames: { zh: '未命名画布', en: 'Untitled Canvas' },
  storage: 'json',
  // 版本 1 = 旧工程表 storyboard_projects 的节点 / 连线（媒体按绝对路径存，不再编码成媒体池）。
  // 版本 2 = 节点预览不再指向程序缩略图目录（导入与拖入的节点只存原媒体）。只去掉了旧程序可回退原图的可选值，
  //   旧程序照常能读，最低可读版本仍为 1。
  version: 2,
  minReaderVersion: 1,
  contentSchema: canvasContentSchema,
  independentArrays: ['nodes', 'edges'],
  migrations: {
    1: migrateProgramThumbnailPreviewsV1,
  },
  createEmptyContent: () => ({ nodes: [], edges: [] }),
  // 连线必须连着节点，没有节点就是空画布。
  isEmptyContent: (content) => content.nodes.length === 0,
  summarize: (content) => ({ nodes: content.nodes.length }),
}
