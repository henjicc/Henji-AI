import { describe, expect, it } from 'vitest'
import { codeElementAtSource, codeElementAuthorPoint, codeElementFramePolygon, codeElementLabel, cycleCodeElement, hitCodeElementIndex, prepareAuthorElementIndex } from './codeElementSelection'
import { videoEditClipToFrame } from './clipGeometry'
import { videoEditAnnotationTargetSchema } from './annotations'
import type { AuthorElementObservation } from './codeAuthorProgram'

function layer(id: string, x = 0, y = 0, size = 100): AuthorElementObservation {
  return { id, name: id, bounds: [0, 0, size, size], matrix: [1, 0, 0, 1, x, y], corners: [[x,y],[x+size,y],[x+size,y+size],[x,y+size]], parameterKeys: [], textParameterKeys: [] }
}
describe('代码图层点选共享几何', () => {
  it('同名图层按稳定ID区分并循环选择，标注保留完整身份', () => {
    const name = '作者图层'.repeat(40)
    const index = prepareAuthorElementIndex([{ ...layer('node-0'), name }, { ...layer('node-1'), name }])
    const hits = hitCodeElementIndex(index, 50, 50)
    expect(hits.map(hit => hit.elementId)).toEqual(['node-1', 'node-0'])
    expect(cycleCodeElement(hits, hits[0].elementId, true)).toBe(hits[1])
    expect(cycleCodeElement(hits, hits[1].elementId, true)).toBe(hits[0])
    expect(index.byId.get(hits[1].elementId)).toBe(hits[1]); expect(codeElementLabel(hits[0])).toBe(name)
    expect(videoEditAnnotationTargetSchema.parse({ kind: 'element', elementId: hits[0].elementId })).toMatchObject({ elementId: hits[0].elementId })
  })
  it('缩放旋转及非中心锚点逆映射到作者画布，选框四角随片段变换', () => {
    const placement = { x: .1, y: -.1, scale: .6, rotation: 37, anchorX: .2, anchorY: .7 }
    const picture = { width: 1920, height: 1080 }; const frame = { width: 3840, height: 2160 }
    const point = videoEditClipToFrame(placement, picture, frame, .3, .4)
    const author = codeElementAuthorPoint(placement, picture, frame, point)
    expect(author.x).toBeCloseTo(576); expect(author.y).toBeCloseTo(432)
    const polygon = codeElementFramePolygon({ x: 576, y: 432, width: 50, height: 30 }, placement, picture, frame)
    expect(polygon[0].x).toBeCloseTo(point.x); expect(polygon[0].y).toBeCloseTo(point.y)
    expect(codeElementAuthorPoint(placement, picture, frame, polygon[2]).x).toBeCloseTo(626)
  })
  it('以作者声明的图层bounds命中，透明层不参与，不识别内部绘制语句', () => {
    const index = prepareAuthorElementIndex([layer('background'), { ...layer('hidden'), opacity: 0 }, layer('foreground', 10, 10, 20)])
    expect(hitCodeElementIndex(index, 15, 15).map(hit => hit.elementId)).toEqual(['foreground', 'background'])
    expect(hitCodeElementIndex(index, 50, 50).map(hit => hit.elementId)).toEqual(['background'])
    expect(hitCodeElementIndex(index, 150, 150)).toEqual([])
  })
  it('源码光标按文件及最小源码范围定位，参数绑定来自作者元数据', () => {
    const span = { file: 'parts/title.js', start: 10, end: 90, startLine: 1, startColumn: 11, endLine: 1, endColumn: 91 }
    const index = prepareAuthorElementIndex([{ ...layer('outer'), sourceSpan: span }, { ...layer('title'), sourceSpan: { ...span, start: 20, end: 50 }, parameterKeys: ['title', 'style'], textParameterKeys: ['title'] }])
    const element = codeElementAtSource(index, 30, 'parts/title.js')!
    expect(element.elementId).toBe('title'); expect(index.parameters.get('title')).toEqual(['title', 'style'])
    expect(codeElementAtSource(index, 30, 'main.js')).toBeUndefined()
    expect(codeElementAtSource(index, 90, 'parts/title.js')).toBeUndefined()
  })
  it('4K的1000动态图层热命中P95低于4ms', () => {
    const index = prepareAuthorElementIndex(Array.from({ length: 1000 }, (_, i) => layer(`node-${i}`, i % 50 * 70, Math.floor(i / 50) * 90, 12)))
    for (let i = 0; i < 30; i++) hitCodeElementIndex(index, 6, 6)
    const durations: number[] = []
    for (let i = 0; i < 200; i++) { const at = performance.now(); const hits = hitCodeElementIndex(index, i % 50 * 70 + 6, Math.floor(i / 50) * 90 + 6); durations.push(performance.now() - at); expect(hits[0]?.elementId).toBe(`node-${i}`) }
    durations.sort((a,b) => a-b); expect(durations[Math.floor(durations.length * .95)]).toBeLessThan(4)
  })
})
