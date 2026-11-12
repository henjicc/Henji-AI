/*
 * 画布规模基准（只读排查用）。
 * 运行：npx vitest run --config tickets/46-正式使用链路/证据/规模/vitest.scale.config.ts
 * 规模用 HENJI_CANVAS_SCALE=500,2000,5000 改。
 *
 * 数据路径用的都是正式实现：
 * - canvasToDocumentContent / canvasFromDocumentContent / canvasHistoryForSessionState（src/features/canvas/application/canvasDocumentContent.ts）
 * - canvasDocumentKind.contentSchema（主进程每次保存都做的 zod 校验，repository.ts validateContent）
 * - 位置写法编解码 createLocationCodec（主进程保存时 encode，比较旧文件时 decode）与 jsonEqual
 * - applyNodeChanges（@xyflow/react）、adoptUserNodes / getNodesInside（@xyflow/system）、hasCanvasContentChanged
 * 两处“选择器 / 素材组投影”用等价循环模拟（标在输出里），复杂度与源码一致，系数是估计。
 */
import v8 from 'node:v8'
import path from 'node:path'
import { it } from 'vitest'
import { applyNodeChanges, type NodeChange } from '@xyflow/react'
import { adoptUserNodes, getNodesInside } from '@xyflow/system'

import { canvasDocumentKind } from '@/core/documents/kinds/canvas'
import { createLocationCodec } from '@/core/storage/locationCodec'
import { jsonEqual } from '@/core/jsonEqual'
import { canvasFromDocumentContent, canvasHistoryForSessionState, canvasHistoryFromSessionState, canvasToDocumentContent } from '@/features/canvas/application/canvasDocumentContent'
import type { CanvasEdge, CanvasHistorySnapshot, CanvasNode } from '@/stores/canvasStore'
import { createSnapshot, hasCanvasContentChanged } from '@/stores/canvasStoreHelpers'

const SCALES = (process.env.HENJI_CANVAS_SCALE ?? '500,2000,5000').split(',').map(Number)
const ROOT = path.join(process.platform === 'win32' ? 'E:\\' : '/', 'bench-user')
const PROMPT = '素材用途：图片1提供人物、穿搭、妆容与整体光色氛围；视频1只提供运镜的节奏与方向。主体：年轻女性，长黑发，仰头看向头顶透过花枝的光。镜头：极低机位仰拍，24mm 广角，随后机位一边后拉一边缓慢升高，最后停在平视中近景。质感：写实电影摄影，柔和逆光与光晕，浅景深，轻微胶片颗粒。'

function media(i: number, ext: string): string { return path.join(ROOT, '生成', `${i}.${ext}`) }

function makeNode(i: number): CanvasNode {
  const kind = i % 20
  const position = { x: (i % 70) * 420, y: Math.floor(i / 70) * 460 }
  const base = { id: `n${i}`, position, measured: { width: 384, height: 420 }, width: 384, height: 420 }
  if (kind < 7) return { ...base, type: 'uploadNode', data: { imageUrl: media(i, 'png'), previewImageUrl: media(i, 'preview.webp'), aspectRatio: '16:9', sourceFileName: `${i}.png`, isSizeManuallyAdjusted: false } } as unknown as CanvasNode
  if (kind < 10) return { ...base, type: 'imageNode', data: { imageUrl: media(i, 'png'), previewImageUrl: media(i, 'preview.webp'), aspectRatio: '1:1' } } as unknown as CanvasNode
  if (kind < 16) {
    const text = `${PROMPT}#${i}`
    return { ...base, type: kind < 13 ? 'videoGenNode' : 'elementEditGenNode', data: {
      displayName: `镜头 ${i}`, prompt: text, modelId: kind < 13 ? 'kling-2.1' : 'seedream-4', providerId: 'ppio',
      promptDocument: { version: 1, type: 'doc', content: [{ type: 'paragraph', content: [
        { type: 'mediaReference', attrs: { resourceId: `canvas-output:n${i - 1}:source:0`, mediaType: 'image', fallbackLabel: '图片1', sourceNodeId: `n${i - 1}` } },
        { type: 'text', text },
      ] }] },
      params: { aspect_ratio: '16:9', duration: 5, resolution: '1080p', seed: i, cfg_scale: 0.5, negative_prompt: '文字、水印、边框', camera_control: { type: 'simple', horizontal: 0, vertical: 2 } },
      serverTaskId: null, lastExecutionStatus: 'success', imageUrl: media(i, 'out.png'), previewImageUrl: media(i, 'out.preview.webp'),
    } } as unknown as CanvasNode
  }
  if (kind < 18) return { ...base, type: 'exportImageNode', data: { imageUrl: media(i, 'export.png'), previewImageUrl: media(i, 'export.webp'), aspectRatio: '16:9' } } as unknown as CanvasNode
  return { ...base, type: 'textAnnotationNode', data: { content: `备注 ${i}：${PROMPT.slice(0, 60)}` } } as unknown as CanvasNode
}

function makeGraph(n: number): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const nodes = Array.from({ length: n }, (_, i) => makeNode(i))
  const edges: CanvasEdge[] = []
  for (let i = 0; i < n; i++) {
    const kind = i % 20
    if (kind >= 10 && kind < 16) {
      // 每个生成节点三条输入：两张图、一条上一个生成节点的结果
      for (const src of [i - 10, i - 7, i - 1]) if (src >= 0) edges.push({ id: `e${edges.length}`, source: `n${src}`, target: `n${i}`, sourceHandle: 'source', targetHandle: src === i - 1 ? 'target' : 'media-image' } as CanvasEdge)
    } else if (kind >= 16 && kind < 18 && i >= 3) {
      edges.push({ id: `e${edges.length}`, source: `n${i - 3}`, target: `n${i}`, sourceHandle: 'source', targetHandle: 'target' } as CanvasEdge)
    }
  }
  return { nodes, edges }
}

function time<T>(fn: () => T, repeat = 1): [number, T] {
  let result!: T
  const started = performance.now()
  for (let k = 0; k < repeat; k++) result = fn()
  return [Math.round(((performance.now() - started) / repeat) * 100) / 100, result]
}

it('画布规模基准', () => {
  const context = { style: (process.platform === 'win32' ? 'win32' : 'posix') as 'win32' | 'posix', userRoot: ROOT, projects: [], programRoots: [path.join(ROOT, '.system')] }
  const codec = createLocationCodec(context)
  const rows: Record<string, unknown>[] = []
  for (const n of SCALES) {
    const { nodes, edges } = makeGraph(n)
    const out: Record<string, unknown> = { n, edges: edges.length }

    // ---------- 保存一次（渲染层 getContent → IPC → 主进程 repository.save） ----------
    const [toDocMs, content] = time(() => canvasToDocumentContent({ nodes, edges }))
    const [ipcMs, ipcCopy] = time(() => structuredClone(content))
    const [zodMs] = time(() => canvasDocumentKind.contentSchema.safeParse(ipcCopy))
    const [encodeMs, encoded] = time(() => codec.encodeContent(ipcCopy))
    const envelope = { format: 'henji', kind: 'canvas', revision: 1, content: encoded.content }
    const [stringifyMs, text] = time(() => JSON.stringify(envelope))
    const [readParseMs, reread] = time(() => JSON.parse(text) as typeof envelope)
    const [decodeOldMs] = time(() => codec.decodeContent(reread.content))
    const [equalMs] = time(() => jsonEqual(encoded.content, reread.content))
    out.save = { docKB: Math.round(text.length / 1024), rendererMs: toDocMs, ipcCloneMs: ipcMs,
      mainCpuMs: Math.round((zodMs + encodeMs + stringifyMs + readParseMs + decodeOldMs + equalMs) * 10) / 10,
      detail: { zodMs, encodeMs, stringifyMs, readParseMs, decodeOldMs, equalMs } }

    // ---------- 打开 ----------
    const [openMs] = time(() => canvasFromDocumentContent(reread.content))
    out.openParseMs = Math.round((readParseMs + decodeOldMs + openMs) * 10) / 10

    // ---------- 撤销记录写进会话状态（每次保存后 1.5s，24 份快照） ----------
    const past: CanvasHistorySnapshot[] = []
    let current = nodes
    for (let k = 0; k < 24; k++) {
      past.push(createSnapshot(current, edges))
      current = current.map((node, index) => index === k ? { ...node, position: { x: node.position.x + 10, y: node.position.y } } : node)
    }
    const [historyCleanMs, persisted] = time(() => canvasHistoryForSessionState({ past: past.slice(0, 12), future: past.slice(12) }))
    const [historyIpcMs, historyIpc] = time(() => v8.serialize(persisted))
    const [historyJsonMs, historyJson] = time(() => JSON.stringify({ revision: 1, history: persisted }))
    // 重开画布时读回：主进程 JSON.parse 整份文件后经 IPC 发回，共享引用已经展开成 24 份独立副本。
    globalThis.gc?.()
    const heapBefore = process.memoryUsage().heapUsed
    const [historyReadParseMs, historyRead] = time(() => JSON.parse(historyJson) as { history: unknown })
    const [historyValidateMs, restored] = time(() => canvasHistoryFromSessionState(historyRead.history))
    const heapAfter = process.memoryUsage().heapUsed
    out.sessionHistory = { cleanMs: historyCleanMs, ipcKB: Math.round(historyIpc.length / 1024), ipcMs: historyIpcMs,
      fileKB: Math.round(historyJson.length / 1024), jsonMs: historyJsonMs,
      reopenParseMs: historyReadParseMs, reopenValidateMs: historyValidateMs, reopenHeapMB: Math.round((heapAfter - heapBefore) / 1e6),
      restoredSteps: restored ? restored.past.length + restored.future.length : 0 }

    // ---------- 拖动 20 个选中节点的一帧 ----------
    const lookup = new Map()
    const parentLookup = new Map()
    adoptUserNodes(nodes, lookup, parentLookup, { checkEquality: true })
    let frameNodes = nodes
    const selected = nodes.slice(0, 20).map(node => node.id)
    const [dragFrameMs] = time(() => {
      const changes: NodeChange<CanvasNode>[] = selected.map(id => ({ id, type: 'position', position: { x: Math.random() * 1000, y: 0 }, dragging: true }))
      const next = applyNodeChanges(changes, frameNodes)
      hasCanvasContentChanged({ nodes: frameNodes, edges }, { nodes: next, edges })
      adoptUserNodes(next, lookup, parentLookup, { checkEquality: true })
      frameNodes = next
    }, 60)
    out.dragFrame = { storeAndFlowMs: dragFrameMs }

    // 每次 store 更新时各节点选择器的全量扫描（等价循环）：MediaInputRow 每行每种媒体 edges.some，
    // ToolWorkbenchNodeFrame / Storyboard 同类；生成节点约占 30%，每个按两种媒体算。
    const genIds = nodes.filter(node => /GenNode$/.test(node.type)).map(node => node.id)
    const [selectorMs] = time(() => {
      let hits = 0
      for (const id of genIds) for (const handle of ['media-image', 'media-video']) if (edges.some(edge => edge.target === id && edge.targetHandle === handle)) hits++
      return hits
    }, 5)
    out.dragFrame = { ...(out.dragFrame as object), nodeSelectorsSimMs: selectorMs }

    // 素材组投影（assetGroupRenderGraph.ts → summarizeAssetGroupBinding）每帧都跑：
    // 每个绑定 × 每个成员一次 nodes.find + edges.some。按每 100 个节点一组、每组 20 成员 2 个绑定。
    const groups = Math.max(1, Math.floor(n / 100))
    const [assetGroupMs] = time(() => {
      let connected = 0
      for (let g = 0; g < groups; g++) for (let b = 0; b < 2; b++) for (let m = 0; m < 20; m++) {
        const memberId = `n${(g * 20 + m) % n}`
        const member = nodes.find(node => node.id === memberId)
        if (member && edges.some(edge => edge.source === memberId && edge.target === `missing-${b}`)) connected++
      }
      return connected
    }, 3)
    out.dragFrame = { ...(out.dragFrame as object), assetGroupProjectionSimMs: assetGroupMs, groups }

    // ---------- 框选：每次指针移动做一次 getNodesInside ----------
    const [boxMs] = time(() => getNodesInside(lookup, { x: 0, y: 0, width: 4000, height: 2000 }, [0, 0, 0.5], true), 30)
    out.boxSelectPerMoveMs = boxMs

    // ---------- 撤销：一步快照与还原 ----------
    const [snapshotMs] = time(() => createSnapshot(frameNodes, edges), 30)
    const [undoAdoptMs] = time(() => adoptUserNodes(nodes, lookup, parentLookup, { checkEquality: true }))
    out.undo = { snapshotMs, restoreAdoptMs: undoAdoptMs }
    rows.push(out)
  }
  console.log(JSON.stringify(rows, null, 1))
})
