import { expect, it } from 'vitest'
import type { AuthorElementObservation } from './codeAuthorProgram'
import { authorOverrideMatrix } from './codeAuthorGeometry'
import { codePoint } from './codeMaterial/geometry'
import { prepareAuthorElementIndex, hitCodeElementIndex, codeElementLabel } from './codeElementSelection'
import { codeElementMoveDelta, resizeCodeElement, rotateCodeElement } from './codeElementManipulation'

function observation(): AuthorElementObservation {
  const matrix: AuthorElementObservation['matrix'] = [0, 2, -3, 0, 100, 200]
  return { id: 'node-3', name: '第三个节点', bounds: [0, 0, 100, 20], matrix, baseMatrix: matrix,
    corners: [[100, 200], [100, 400], [40, 400], [40, 200]], parameterKeys: ['label', 'style'], textParameterKeys: ['label'] }
}
it('uses author bounds and layer identity for hit testing, including rotation and singular poses', () => {
  const index = prepareAuthorElementIndex([observation()])
  expect(hitCodeElementIndex(index, 70, 300).map(value => value.elementId)).toEqual(['node-3'])
  expect(hitCodeElementIndex(index, 120, 300)).toEqual([])
  expect(codeElementLabel(index.bounds[0])).toBe('第三个节点')
  expect(index.parameters.get('node-3')).toEqual(['label', 'style'])
  expect(hitCodeElementIndex(prepareAuthorElementIndex([{ ...observation(), matrix: [0, 0, 0, 0, 0, 0] }]), 0, 0)).toEqual([])
})
it('keeps translation in composition coordinates and fixes the opposite corner when resizing', () => {
  const author = observation(), element = prepareAuthorElementIndex([author]).bounds[0]
  expect(codeElementMoveDelta(element, { x: 0, y: 0 }, { x: 5, y: 7 })).toEqual({ x: 5, y: 7 })
  const next = resizeCodeElement(element, {}, 2, { x: -20, y: 600 }, false)
  const matrix = authorOverrideMatrix(author.baseMatrix!, author.bounds, next)
  expect(codePoint(matrix, 0, 0)).toEqual(codePoint(author.matrix, 0, 0))
  expect(codePoint(matrix, 100, 20)).toEqual([-20, 600])
})
it('rotates in author axes even when its pose has unequal scale', () => {
  const element = prepareAuthorElementIndex([observation()]).bounds[0]
  expect(rotateCodeElement(element, {}, { x: 70, y: 320 }, { x: 40, y: 300 }, false)).toBeCloseTo(90)
})
