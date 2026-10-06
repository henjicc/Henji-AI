import type { DocumentMeta } from '@/core/documents/types'
import { parseImageEditSessionReferenceV3 } from '@/core/imageEdit/v3/sessionReference'
import { createLogger } from '@/core/logging'

import type { CanvasNode } from '../domain/canvasNodes'
import type { CanvasHistoryState } from '@/stores/canvasStore'
import { canvasDocumentCommands } from './canvasDocumentEnvironment'

/*
 * 画布节点的内嵌图片文档（多图层节点、在画布里编辑过的图片，3.4）。
 *
 * 编辑照旧发生在程序目录的工作副本；画布写回（空闲、关闭、保存）与换位置（移动、转正、创建副本）前，
 * 主进程把节点引用的每份文档写成画布所在容器 `.henji/canvas-layers/` 里的包，位置记进画布内容的
 * layerPackages，于是换容器时随画布复制、拷贝文件夹时跟着走。打开画布时主进程按包准备工作副本：
 * 换机器时解包，副本画布（创建副本、拷贝文件夹）分出自己的文档，节点改指向新文档。
 */

const logger = createLogger('features.canvas.layerPackages')
const V3_REF_PREFIX = 'image-edit-v3:'

function sessionDocumentId(node: CanvasNode): string | null {
  const imageUrl = typeof node.data.imageUrl === 'string' ? node.data.imageUrl : ''
  try {
    const session = parseImageEditSessionReferenceV3(node.data.imageEditSession, imageUrl)
    return session ? session.documentRef.slice(V3_REF_PREFIX.length) : null
  } catch {
    // 损坏的引用由节点自己的打开路径报告；这里不打包
    return null
  }
}

/** 节点引用的内嵌图片文档 ID（去重，按出现顺序）。 */
export function canvasLayerDocumentIds(nodes: readonly CanvasNode[]): string[] {
  const ids = new Set<string>()
  for (const node of nodes) {
    const id = sessionDocumentId(node)
    if (id) ids.add(id)
  }
  return [...ids]
}

/** 把节点里的内嵌文档引用按 旧 ID → 新 ID 改指向；没有变化时返回原数组。 */
export function rewriteCanvasLayerReferences(nodes: CanvasNode[], rewrites: Readonly<Record<string, string>>): CanvasNode[] {
  let changed = false
  const next = nodes.map((node) => {
    const id = sessionDocumentId(node)
    const target = id ? rewrites[id] : undefined
    if (!target) return node
    changed = true
    const session = node.data.imageEditSession as Record<string, unknown>
    return { ...node, data: { ...node.data, imageEditSession: { ...session, documentRef: `${V3_REF_PREFIX}${target}` } } } as CanvasNode
  })
  return changed ? next : nodes
}

/**
 * 打开画布时准备内嵌图片文档；副本画布分出了新文档时返回改指向后的节点与 旧 ID → 新 ID（调用方写回画布，
 * 撤销记录同样改指向），否则返回 null。
 * 准备失败只记日志：节点仍按原引用显示，编辑时由图片编辑器报告找不到文档。
 */
export async function prepareCanvasLayers(
  canvasId: string,
  nodes: CanvasNode[],
  packages: Readonly<Record<string, string>> | undefined,
): Promise<{ nodes: CanvasNode[]; rewrites: Record<string, string> } | null> {
  const ids = canvasLayerDocumentIds(nodes)
  if (!ids.length) return null
  try {
    const result = await canvasDocumentCommands().prepareLayers({
      requestId: `canvas-layers:prepare:${crypto.randomUUID()}`,
      canvasId,
      layers: ids.map((documentId) => (packages?.[documentId] ? { documentId, packagePath: packages[documentId] } : { documentId })),
    })
    if (result.missing.length) {
      logger.warn('画布里有内嵌图片文档找不到', { event: 'canvas.layers.prepare.missing', context: { docId: canvasId, count: result.missing.length } })
    }
    const rewritten = rewriteCanvasLayerReferences(nodes, result.rewrites)
    if (rewritten === nodes) return null
    logger.info('画布副本的内嵌图片文档已分出', { event: 'canvas.layers.prepare.forked', context: { docId: canvasId, count: Object.keys(result.rewrites).length } })
    return { nodes: rewritten, rewrites: result.rewrites }
  } catch (error) {
    logger.error('画布内嵌图片文档准备失败', error, { event: 'canvas.layers.prepare.failed', context: { docId: canvasId } })
    return null
  }
}

/** 画布仍在用的内嵌图片文档：当前节点 + 撤销 / 重做记录里的节点（撤销能把删掉的节点找回来）。 */
export function retainedCanvasLayerDocumentIds(nodes: readonly CanvasNode[], history: CanvasHistoryState): string[] {
  const snapshots = [...history.past, ...history.future]
  return canvasLayerDocumentIds([...nodes, ...snapshots.flatMap((snapshot) => snapshot.nodes)])
}

/**
 * 把当前节点引用的内嵌图片文档写成画布所在容器里的包，返回 文档 ID → 包位置。失败抛错（写回失败，修改保留）。
 * 同时带上仍在用的文档，主进程顺带清理这份画布不再用、别的画布也没提到的内嵌文档（3.6）。
 */
export async function commitCanvasLayers(
  canvasId: string,
  meta: Pick<DocumentMeta, 'container'>,
  nodes: readonly CanvasNode[],
  history: CanvasHistoryState,
): Promise<Record<string, string>> {
  const result = await canvasDocumentCommands().commitLayers({
    requestId: `canvas-layers:commit:${crypto.randomUUID()}`,
    canvasId,
    container: meta.container,
    documentIds: canvasLayerDocumentIds(nodes),
    retainedDocumentIds: retainedCanvasLayerDocumentIds(nodes, history),
  })
  if (result.released) {
    logger.info('画布不再用的内嵌图片文档已清理', { event: 'canvas.layers.released', context: { docId: canvasId, count: result.released } })
  }
  return result.packages
}
