import { describe, expect, it } from 'vitest'
import { CANVAS_NODE_TYPES, type CanvasNode } from '../domain/canvasNodes'
import { resolveCanvasNodeLayoutSize } from '../domain/nodeRegistry'
import { estimateNewCanvasNodeSize, findCanvasPositionNearViewportCenter, findCanvasPositionRightOf, findFreeCanvasPosition, type CanvasPlacementScene } from './canvasNodePlacement'

const scene = (nodes: CanvasNode[]): CanvasPlacementScene => ({
  nodes, viewport: { x: 0, y: 0, zoom: 1 }, viewportSize: { width: 3000, height: 2000 },
})
const overlaps = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
const rect = (node: CanvasNode) => ({ ...node.position, ...resolveCanvasNodeLayoutSize(node) })

describe('canvas node placement', () => {
  it('counts unmeasured nodes created in the same turn at their declared type size', () => {
    // 同一回合连续建的生成节点与结果节点都还没有 DOM 测量。
    const generator: CanvasNode = { id: 'gen', type: CANVAS_NODE_TYPES.imageEdit, position: { x: 0, y: 0 }, data: {} as never }
    const result: CanvasNode = { id: 'res', type: CANVAS_NODE_TYPES.exportImage, position: { x: 400, y: 0 }, data: { aspectRatio: '16:9' } as never }
    expect(resolveCanvasNodeLayoutSize(generator).height).toBeGreaterThan(200)
    expect(resolveCanvasNodeLayoutSize(result)).toEqual({ width: 384, height: 216 })
    const size = estimateNewCanvasNodeSize(CANVAS_NODE_TYPES.exportImage, { aspectRatio: '1:1' })
    const position = findCanvasPositionRightOf(scene([generator, result]), 'gen', size)
    const placed = { ...position, ...size }
    expect(overlaps(placed, rect(generator))).toBe(false)
    expect(overlaps(placed, rect(result))).toBe(false)
  })
  it('measured size wins over the declared estimate', () => {
    const node: CanvasNode = { id: 'n', type: CANVAS_NODE_TYPES.imageEdit, position: { x: 0, y: 0 }, measured: { width: 500, height: 90 }, data: {} as never }
    expect(resolveCanvasNodeLayoutSize(node)).toEqual({ width: 500, height: 90 })
  })
  it('viewport-center placement avoids nodes already sitting at the center', () => {
    const nodes: CanvasNode[] = []
    for (let i = 0; i < 4; i++) {
      const size = estimateNewCanvasNodeSize(CANVAS_NODE_TYPES.imageEdit)
      const position = findCanvasPositionNearViewportCenter(scene(nodes), size)
      const placed = { ...position, ...size }
      nodes.forEach(node => expect(overlaps(placed, rect(node))).toBe(false))
      nodes.push({ id: String(i), type: CANVAS_NODE_TYPES.imageEdit, position, data: {} as never })
    }
  })
  it('a fixed origin point reused within one turn still yields non-overlapping nodes', () => {
    const nodes: CanvasNode[] = []
    const size = estimateNewCanvasNodeSize(CANVAS_NODE_TYPES.imageEdit)
    for (let i = 0; i < 3; i++) {
      const position = findFreeCanvasPosition(scene(nodes), size, { x: 90, y: 40 })
      nodes.forEach(node => expect(overlaps({ ...position, ...size }, rect(node))).toBe(false))
      nodes.push({ id: String(i), type: CANVAS_NODE_TYPES.imageEdit, position, data: {} as never })
    }
    expect(nodes[0].position).toEqual({ x: 90, y: 40 })
  })
})
