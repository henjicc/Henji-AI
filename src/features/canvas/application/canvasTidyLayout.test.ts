import { describe, expect, it } from 'vitest'
import { CANVAS_NODE_TYPES, type CanvasNode } from '../domain/canvasNodes'
import type { CandidateIdentity } from '@/core/creativeIntent/contracts'
import { CANVAS_TIDY_MODES, canvasTidyGeometryKey, solveCanvasTidy } from './canvasTidyLayout'

const digest = `sha256:${'a'.repeat(64)}`
const identity: CandidateIdentity = { sourceDraftDigest: digest, algorithmVersion: 'test', requestKey: 'test', ownerRef: { kind: 'canvas.document', id: 'p' }, targetBases: [] }
const node = (id: string, x: number, y: number, width = 100, height = 80): CanvasNode => ({
  id, type: CANVAS_NODE_TYPES.textAnnotation, position: { x, y }, width, height, selected: true, data: { content: id },
})
const fixture = () => [node('a', 20, 40, 90), node('b', 240, 100, 160, 120), node('c', 480, 60, 110, 50), node('d', 700, 180, 80)]

describe('canvas static layout adapter', () => {
  it('aligns mixed-size edges, distributes actual gaps, and never mutates input', () => {
    const nodes = fixture(); const original = structuredClone(nodes)
    for (const mode of CANVAS_TIDY_MODES) {
      const result = solveCanvasTidy(nodes, nodes.map(n => n.id), null, mode, identity)
      expect(result.unavailable).toBeUndefined()
      expect(result.placements).toHaveLength(4)
      const positions = new Map(result.placements.map(p => [p.nodeId, p.position]))
      if (mode !== 'grid') expect(new Set(result.placements.map(p => p.position.y)).size).toBe(1)
      if (mode === 'distribute') {
        const gaps = nodes.slice(1).map((n, i) => positions.get(n.id)!.x - positions.get(nodes[i].id)!.x - nodes[i].width!)
        gaps.forEach(gap => { expect(gap).toBeGreaterThanOrEqual(0); expect(gap).toBeCloseTo(gaps[0], 8) })
      }
    }
    expect(nodes).toEqual(original)
  })
  it('honors pins and locked nodes; conflicting locks produce no partial proposal', () => {
    const nodes = fixture(); nodes[0].draggable = false
    const result = solveCanvasTidy(nodes, nodes.map(n => n.id), null, 'distribute', identity)
    expect(result.unavailable).toBeUndefined()
    expect(result.placements[0].position).toEqual(nodes[0].position)
    const pinned = solveCanvasTidy(fixture(), nodes.map(n => n.id), 'b', 'grid', identity)
    expect(pinned.unavailable).toBeUndefined()
    expect(pinned.placements.find(p => p.nodeId === 'b')?.position).toEqual(nodes[1].position)
    nodes[1].draggable = false
    const conflict = solveCanvasTidy(nodes, nodes.map(n => n.id), null, 'align', identity)
    expect(conflict.unavailable).toBeTruthy(); expect(conflict.placements).toEqual([])
  })
  it('partitions containers, freezes ancestors of locked children, and rejects overflow', () => {
    const parent = node('parent', 800, 400, 1000, 600)
    const children = fixture().map(n => ({ ...n, parentId: parent.id, extent: 'parent' as const }))
    const outsider = node('outside', 1800, 50)
    children[0].draggable = false
    const nodes = [parent, ...children, outsider]
    const result = solveCanvasTidy(nodes, nodes.map(n => n.id), null, 'grid', identity)
    expect(result.unavailable).toBeUndefined()
    expect(result.placements.find(p => p.nodeId === parent.id)?.position).toEqual(parent.position)
    expect(result.placements.find(p => p.nodeId === 'a')?.position).toEqual(children[0].position)
    expect(nodes.map(n => n.parentId)).toEqual([undefined, 'parent', 'parent', 'parent', 'parent', undefined])
    parent.width = 50
    expect(solveCanvasTidy(nodes, children.map(n => n.id), null, 'grid', identity).unavailable).toContain('容器')
  })
  it('covers all 240 nodes without truncation and handles two-node spacing', () => {
    const nodes = Array.from({ length: 240 }, (_, i) => node(String(i), i % 20 * 180 + i % 3, Math.floor(i / 20) * 130 + i % 7, 80 + i % 5 * 5, 60 + i % 3 * 10))
    for (const mode of CANVAS_TIDY_MODES) {
      const result = solveCanvasTidy(nodes, nodes.map(n => n.id), null, mode, identity)
      expect(result.unavailable).toBeUndefined(); expect(result.placements).toHaveLength(nodes.length)
      expect(new Set(result.placements.map(p => p.nodeId)).size).toBe(nodes.length)
      if (mode === 'distribute') {
        expect(new Set(result.placements.map(p => p.position.y)).size).toBe(12)
        for (let row = 0; row < 12; row++) {
          const gaps = Array.from({ length: 19 }, (_, col) => { const i = row * 20 + col; return result.placements[i + 1].position.x - result.placements[i].position.x - nodes[i].width! })
          gaps.forEach(gap => { expect(gap).toBeGreaterThan(0); expect(gap).toBeCloseTo(gaps[0], 8) })
        }
      }
    }
    expect(solveCanvasTidy(nodes.slice(0, 2), ['0', '1'], '1', 'distribute', identity).unavailable).toBeUndefined()
  })
  it('rejects missing, hidden and unmeasured targets and detects geometry changes', () => {
    const nodes = fixture(); const key = canvasTidyGeometryKey(nodes)
    nodes[1].position.x++
    expect(canvasTidyGeometryKey(nodes)).not.toBe(key)
    expect(solveCanvasTidy(nodes, ['a', 'absent'], null, 'align', identity).unavailable).toBeTruthy()
    nodes[1].hidden = true
    expect(solveCanvasTidy(nodes, ['a', 'b'], null, 'align', identity).unavailable).toBeTruthy()
    nodes[1].hidden = false; nodes[1].width = undefined
    expect(solveCanvasTidy(nodes, ['a', 'b'], null, 'align', identity).unavailable).toContain('测量')
  })
})
