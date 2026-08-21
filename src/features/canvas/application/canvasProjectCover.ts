import { createLogger } from '@/core/logging'
import { saveProjectCover } from '@/commands/projectCovers'
import type { ProjectCoverSource } from '@/platform/contracts/projectCovers'
import { getPlatform } from '@/platform'
import { SURFACE_OBSERVATION_SCHEMA_VERSION, type SurfaceCaptureRect } from '@/core/assistant/surfaceObservation'
import { useCanvasStore, type CanvasNode } from '@/stores/canvasStore'
import { useProjectStore } from '@/stores/projectStore'
import { getCanvasNodeDefinition } from '../domain/nodeRegistry'

const logger = createLogger('features.canvas.application.canvasProjectCover')

/**
 * 画布项目封面：优先取项目里最早的生成图片，没有生成结果时退回节点区域截图。
 *
 * 自动更新层会在封面来源变化后低频调用；退出项目时再补一次立即刷新。
 * 转码、拼图与落盘统一交给主进程 project-covers 服务。
 */

/** 节点区域截图四周留出的呼吸空间（CSS px） */
const CAPTURE_PADDING = 24
/** 主进程截图 rect 上限，见 surfaceCaptureRectSchema */
const MAX_CAPTURE_EDGE = 4_096

/** 生成结果节点：注册表里 role=result 的节点承载生成产物，generator 节点自身也可能留有结果 */
function isGeneratedResultNode(node: CanvasNode): boolean {
  const media = getCanvasNodeDefinition(node.type ?? '')?.media
  return media?.role === 'result' && media.kind === 'image'
}

function readNodeImages(node: CanvasNode): ProjectCoverSource[] {
  const definition = getCanvasNodeDefinition(node.type ?? '')
  const outputs = definition?.getOutputs?.(node.data) ?? []
  return outputs
    .filter((output) => output.kind === 'image' && typeof output.url === 'string' && output.url.length > 0)
    .map((output) => ({ source: output.url, sourceKind: 'image' }))
}

/** 画布里最早的四张生成图片；节点数组按创建顺序持久化，因此顺序跨重启保持稳定。 */
export function findGeneratedCoverSources(nodes: CanvasNode[]): ProjectCoverSource[] {
  const sources: ProjectCoverSource[] = []
  for (const node of nodes) {
    if (!isGeneratedResultNode(node)) continue
    sources.push(...readNodeImages(node))
    if (sources.length >= 4) return sources.slice(0, 4)
  }
  return sources
}

function toIntRect(rect: { x: number; y: number; width: number; height: number }): SurfaceCaptureRect {
  return {
    x: Math.max(0, Math.floor(rect.x)),
    y: Math.max(0, Math.floor(rect.y)),
    width: Math.min(MAX_CAPTURE_EDGE, Math.max(1, Math.floor(rect.width))),
    height: Math.min(MAX_CAPTURE_EDGE, Math.max(1, Math.floor(rect.height))),
  }
}

/**
 * 可见节点的并集区域，收敛到画布可视区内。
 *
 * 截的是窗口像素，所以只有落在视口内的部分能被截到；节点全在视口外时返回 null，
 * 交给占位图，不去改视口——退出时改视口会把刚保存的视口状态写脏。
 */
function resolveNodeAreaRect(): SurfaceCaptureRect | null {
  const pane = document.querySelector('.react-flow')
  if (!pane) return null
  const paneRect = pane.getBoundingClientRect()
  const nodeElements = [...document.querySelectorAll('.react-flow__node')]
  if (nodeElements.length === 0) return null

  let left = Number.POSITIVE_INFINITY
  let top = Number.POSITIVE_INFINITY
  let right = Number.NEGATIVE_INFINITY
  let bottom = Number.NEGATIVE_INFINITY
  for (const element of nodeElements) {
    const bounds = element.getBoundingClientRect()
    if (bounds.width <= 0 || bounds.height <= 0) continue
    left = Math.min(left, bounds.left)
    top = Math.min(top, bounds.top)
    right = Math.max(right, bounds.right)
    bottom = Math.max(bottom, bounds.bottom)
  }
  if (!Number.isFinite(left) || !Number.isFinite(top)) return null

  const clampedLeft = Math.max(paneRect.left, left - CAPTURE_PADDING)
  const clampedTop = Math.max(paneRect.top, top - CAPTURE_PADDING)
  const clampedRight = Math.min(paneRect.right, right + CAPTURE_PADDING)
  const clampedBottom = Math.min(paneRect.bottom, bottom + CAPTURE_PADDING)
  const width = clampedRight - clampedLeft
  const height = clampedBottom - clampedTop
  if (width < 32 || height < 32) return null

  return toIntRect({ x: clampedLeft, y: clampedTop, width, height })
}

async function captureNodeAreaDataUrl(): Promise<string | null> {
  const rect = resolveNodeAreaRect()
  if (!rect) return null
  const captured = await getPlatform().media.captureApplicationSurface({
    schemaVersion: SURFACE_OBSERVATION_SCHEMA_VERSION,
    target: 'workspace.canvas',
    rect,
    masks: [],
    maskPolicyId: 'surface.mask_declared_fields',
  })
  return captured.dataUrl
}

/**
 * 更新画布项目封面。必须在画布仍然挂载时调用（截图读的是真实 DOM）。
 * 失败只记日志：封面是装饰，不能因为它拦住用户退出项目。
 */
export async function updateCanvasProjectCover(projectId: string): Promise<void> {
  try {
    const generated = findGeneratedCoverSources(useCanvasStore.getState().nodes)
    const sources = generated.length > 0 ? generated : await (async (): Promise<ProjectCoverSource[]> => {
      const dataUrl = await captureNodeAreaDataUrl()
      return dataUrl ? [{ source: dataUrl, sourceKind: 'image' }] : []
    })()
    if (sources.length === 0) return

    const result = await saveProjectCover({
      scope: 'canvas',
      projectId,
      sources,
    })
    useProjectStore.getState().setProjectCover(projectId, result.coverPath)
  } catch (error) {
    logger.warn('画布项目封面更新失败', { projectId, error: String(error) })
  }
}
