import { z } from 'zod'

import type { DocumentKindDescriptor } from './registry'

/*
 * 画布（`.henji-canvas`，3.4 画布接入）：可以独立存放（作品目录“画布”文件夹），也可以放进项目。
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
  data: z.record(z.string(), z.unknown()),
})

const canvasEdgeSchema = z.looseObject({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
})

export const canvasContentSchema = z.looseObject({
  nodes: z.array(canvasNodeSchema),
  edges: z.array(canvasEdgeSchema),
  imagePool: z.array(z.string()).optional(),
  layerPackages: z.record(z.string(), z.string()).optional(),
})

export type CanvasDocumentContent = z.infer<typeof canvasContentSchema>

export const canvasDocumentKind: DocumentKindDescriptor<CanvasDocumentContent> = {
  id: 'canvas',
  extension: '.henji-canvas',
  standaloneFolderNames: { zh: '画布', en: 'Canvases' },
  untitledNames: { zh: '未命名画布', en: 'Untitled Canvas' },
  storage: 'json',
  // 版本 1 = 旧工程表 storyboard_projects 的节点 / 连线（媒体按绝对路径存，不再编码成媒体池）。
  version: 1,
  contentSchema: canvasContentSchema,
  migrations: {},
  createEmptyContent: () => ({ nodes: [], edges: [] }),
  // 连线必须连着节点，没有节点就是空画布。
  isEmptyContent: (content) => content.nodes.length === 0,
  summarize: (content) => ({ nodes: content.nodes.length }),
}
