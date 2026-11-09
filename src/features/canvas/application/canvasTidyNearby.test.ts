import { describe, expect, it } from 'vitest'
import { nearbyTidyDeltas, type NearbyRect } from './canvasTidyNearby'

const rect = (x: number, y: number, width = 220, height = 240, locked = false): NearbyRect => ({ x, y, width, height, locked })
const moved = (rects: NearbyRect[], deltas: [number, number][]) => rects.map((r, i) => ({ x: r.x + deltas[i][0], y: r.y + deltas[i][1], width: r.width, height: r.height }))
const overlaps = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

describe('就近整理', () => {
  it('差不多齐的一行对齐顶边、挨着的统一间距，挪动很小', () => {
    const rects = [rect(0, 0), rect(270, 14), rect(545, -9)]
    const after = moved(rects, nearbyTidyDeltas(rects))
    expect(new Set(after.map(r => r.y)).size).toBe(1)
    expect(after[1].x - (after[0].x + after[0].width)).toBe(48)
    expect(after[2].x - (after[1].x + after[1].width)).toBe(48)
    after.forEach((r, i) => expect(Math.hypot(r.x - rects[i].x, r.y - rects[i].y)).toBeLessThan(60))
  })

  it('重叠的节点按穿插更浅的方向推开，保持原来的左右先后', () => {
    const rects = [rect(0, 0), rect(150, 300), rect(180, 330)]
    const after = moved(rects, nearbyTidyDeltas(rects))
    for (let a = 0; a < after.length; a++) for (let b = a + 1; b < after.length; b++) expect(overlaps(after[a], after[b])).toBe(false)
    expect(after[1].x).toBeLessThanOrEqual(after[2].x)
  })

  it('本来就隔得远的不往一起拉，锁定的节点不动，选区外的节点只参与避让', () => {
    const rects = [rect(0, 0, 220, 240, true), rect(1200, 6)]
    const obstacle = rect(600, 0)
    const deltas = nearbyTidyDeltas(rects, [obstacle])
    expect(deltas[0]).toEqual([0, 0])
    const after = moved(rects, deltas)
    expect(after[1].x).toBeGreaterThan(1100)
    expect(after[1].y).toBe(6)
    expect(overlaps(after[1], obstacle)).toBe(false)
  })

  it('横向被两侧钉住的节点夹住放不下时，改为纵向推开，不留重叠', () => {
    const rects = [rect(0, 0, 220, 240, true), rect(200, 10), rect(480, 0, 220, 240, true)]
    const after = moved(rects, nearbyTidyDeltas(rects))
    expect(overlaps(after[1], after[0])).toBe(false)
    expect(overlaps(after[1], after[2])).toBe(false)
  })

  it('几乎重合的两个节点只按行排开，不沿对角线推远', () => {
    const rects = [rect(0, 0, 500, 400), rect(10, 10, 500, 400)]
    const deltas = nearbyTidyDeltas(rects)
    expect(overlaps(moved(rects, deltas)[0], moved(rects, deltas)[1])).toBe(false)
    deltas.forEach(([, dy]) => expect(Math.abs(dy)).toBeLessThan(20))
  })

  it('隔得很远的节点不会为了对齐被拉过去，整体挪动有上限', () => {
    const rects = [rect(0, 0), rect(3, 2000), rect(1000, 47)]
    const deltas = nearbyTidyDeltas(rects)
    deltas.forEach(([dx, dy]) => expect(Math.hypot(dx, dy)).toBeLessThan(400))
    expect(moved(rects, deltas)[1].y).toBeGreaterThan(1900)
  })
})
