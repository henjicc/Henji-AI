import { expect, it } from 'vitest'
import { createImageLayoutCandidates } from './layoutCandidates'
import type { LayoutItem } from '../../creativeIntent/layout'
import type { CandidateIdentity, LayoutConstraint } from '../../creativeIntent/contracts'

it('透明边缘大小不同的百层等距和保留主图候选都保留十行，无重叠、无姿态损失', () => {
  const items: LayoutItem[] = Array.from({ length: 100 }, (_, i) => {
    const x = 30 + i % 10 * 72 + i % 3 + 1.6 + i % 4 * .4
    const y = 20 + Math.floor(i / 10) * 38 + i * 7 % 13 + 1.8
    const w = 12.4 - i % 4 * 1.5, h = 14 - i % 4 * 1.2
    return { targetRef: { kind: 'image_edit.layer', id: String(i) }, affine: [.1, 0, 0, .1, x, y], worldCorners: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], translationLocked: false }
  })
  const targets = items.map(i => i.targetRef)
  const constraints: LayoutConstraint[] = [{ kind: 'align', id: 'edge', strength: 'soft', sourceRefs: [], axis: 'y', edge: 'start', targets, reference: targets[0] }, { kind: 'distribute', id: 'spacing', strength: 'soft', sourceRefs: [], axis: 'x', targets }]
  const digest = `sha256:${'a'.repeat(64)}`
  const identity: CandidateIdentity = { sourceDraftDigest: digest, algorithmVersion: 'test', requestKey: 'test', ownerRef: { kind: 'image_edit.document', id: 'd' }, targetBases: [] }
  const result = createImageLayoutCandidates(items, constraints, identity, 0)
  expect(result.map(c => c.id)).toContain('distribute')
  expect(result.map(c => c.id)).toContain('hero')
  for (const candidate of result.filter(c => c.id !== 'align')) {
    const tops = new Set<number>()
    for (let row = 0; row < 10; row++) {
      const members = items.slice(row * 10, row * 10 + 10)
      const changes = candidate.changes.slice(row * 10, row * 10 + 10)
      const top = members[0].worldCorners[0][1] + changes[0].delta[1]
      tops.add(Math.round(top * 1e6))
      members.forEach((item, i) => { expect(item.worldCorners[0][1] + changes[i].delta[1]).toBeCloseTo(top, 8); expect(changes[i].affine.slice(0, 4)).toEqual(item.affine.slice(0, 4)) })
      const gaps = members.slice(1).map((item, i) => item.worldCorners[0][0] + changes[i + 1].delta[0] - members[i].worldCorners[2][0] - changes[i].delta[0])
      gaps.forEach(gap => { expect(gap).toBeGreaterThan(0); expect(gap).toBeCloseTo(gaps[0], 8) })
    }
    expect(tops.size).toBe(10)
  }
})
