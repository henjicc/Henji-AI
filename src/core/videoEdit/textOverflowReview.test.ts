import { expect, it } from 'vitest'
import { createTextDrawPlan, type TextDrawConstraints } from '../imaging/vectorContent/textDrawPlan'
import { fixtureTextMetrics } from '../imaging/vectorContent/textDrawPlanCanvas.testSupport'
import { textStyleSchema } from '../imaging/vectorContent/text'
import { videoEditTextOverflowFacts, type VideoEditTextDrawSample } from './textOverflowReview'
import { textRectCorners, type TextDrawObservation } from './textDrawObservation'

function fact(text = '标题', constraints: TextDrawConstraints = {}): TextDrawObservation {
  const plan = createTextDrawPlan(text, textStyleSchema.parse({ fontSize: 20, align: 'left' }), constraints, (text, font, state) => fixtureTextMetrics(text, font, state.fontKerning, state.direction, state.textBaseline))
  return { ...plan, constraint: { x: plan.box.x, y: plan.contentTop, width: constraints.maxWidth, height: constraints.maxHeight, maxLines: constraints.maxLines }, actualLines: plan.lines.length, matrix: [1, 0, 0, 1, 0, 0], clips: [], opacity: 1, uncovered: [] }
}
const base = { sequenceId: 'root', path: [], subjectId: 'clip', elementPath: ['title'], label: '标题' }
function sample(draw: TextDrawObservation, frame: number): VideoEditTextDrawSample {
  return { frame, drawIndex: 0, draw, inkQuad: draw.inkBounds ? textRectCorners(draw.inkBounds) : [], effectiveClips: draw.clips, frameClips: [textRectCorners({ x: -100, y: -100, width: 1000, height: 1000 })], opacity: 1 }
}
const stable = (draw: TextDrawObservation) => Array.from({ length: 30 }, (_, frame) => sample(draw, frame))

it('完整内容超框和 fit 失败保留约束、可见超框与可执行改法', () => {
  const draw = fact('中文标题', { maxWidth: 10, wrap: 'none', fit: { minFontSize: 20 } })
  const records = videoEditTextOverflowFacts(stable(draw), 30, base)
  expect(records.map(record => record.kind)).toEqual(['text_overflow'])
  expect(records[0]).toMatchObject({ timeline: { from: 0, to: 30 }, textOverflow: { fitFailed: true, visibleOverflow: true, stability: { basis: 'stable_layout', minimumFrames: 9 } } })
  expect(records[0].detail).toContain('fit')
})
it.each(['frame', 'clip'] as const)('正文墨迹被 %s 裁掉时报告证据，不以外观留白作正文', by => {
  const samples = stable(fact())
  const crop = textRectCorners({ x: 0, y: -100, width: 10, height: 1000 })
  for (const value of samples) if (by === 'frame') value.frameClips = [crop]; else value.effectiveClips = [crop]
  const records = videoEditTextOverflowFacts(samples, 30, base)
  expect(records.map(record => record.kind)).toEqual(['text_clipped'])
  expect(records[0].textOverflow?.clippedBy).toEqual([by])
})
it.each([{ maxLines: 1 }, { maxHeight: 25 }, { maxHeight: 0 }])('按限制 %j 截断时返回遗漏原文与实际行数，全部未绘出也能检查', constraints => {
  const draw = fact('第一行\n第二行\n第三行', constraints)
  const records = videoEditTextOverflowFacts(stable(draw), 30, base)
  expect(records.map(record => record.kind)).toEqual(['text_truncated'])
  const result = records[0]
  expect(result.textOverflow).toMatchObject({ actualLines: draw.actualLines, totalLines: 3, truncated: true })
  expect(result.textOverflow?.omittedRanges[0]).toMatchObject({ start: constraints.maxHeight === 0 ? 0 : 4, reason: constraints.maxLines ? 'maxLines' : 'maxHeight' })
  expect(result.detail).toContain('增高文字框')
})
it('逐字内容或样式揭示期间不报；只合并完成后排版稳定的连续时段', () => {
  const draw = fact('中文标题', { maxWidth: 10, wrap: 'none' })
  for (const kind of ['text', 'reveal', 'paint']) {
    const samples = Array.from({ length: 30 }, (_, frame) => {
      const value = sample({ ...draw, sourceText: kind === 'text' ? `第${frame}字` : draw.sourceText }, frame)
      if (kind === 'reveal') value.draw.revealComplete = false
      if (kind === 'paint') value.draw.paintKey = String(frame)
      return value
    })
    expect(videoEditTextOverflowFacts(samples, 30, base)).toEqual([])
    samples.push(...Array.from({ length: 15 }, (_, i) => sample(draw, 30 + i)))
    expect(videoEditTextOverflowFacts(samples, 30, base).map(record => record.timeline)).toEqual([{ from: 30, to: 45 }])
  }
})
it('缓动推近、父序列运动、透明度和未知混合不屏蔽持续超框及截断', () => {
  for (const draw of [fact('中文标题', { maxWidth: 10, wrap: 'none' }), fact('第一行\n第二行', { maxLines: 1 })]) {
    const samples = stable(draw).map((value, i) => ({ ...value, opacity: .2 + i / 60, inkQuad: value.inkQuad.map(([x,y]): [number, number] => [x + i, y + i]), draw: { ...draw, matrix: [1 + i / 100, 0, 0, 1 + i / 100, i, i] as TextDrawObservation['matrix'], retained: false, uncovered: ['混合遮挡'] } }))
    expect(videoEditTextOverflowFacts(samples, 30, base).map(record => record.kind)).toEqual([draw.truncated ? 'text_truncated' : 'text_overflow'])
  }
})
it('矩形擦入后完全揭开不报；运动中的持续裁切仍按每帧结果合并', () => {
  const draw = fact(), samples = stable(draw)
  for (const [i, value] of samples.entries()) value.effectiveClips = [textRectCorners({ x: -10, y: -10, width: i * 3, height: 100 })]
  expect(videoEditTextOverflowFacts(samples, 30, base)).toEqual([])
  for (const [i, value] of samples.entries()) value.effectiveClips = [textRectCorners({ x: i * .1, y: -10, width: 1, height: 100 })]
  expect(videoEditTextOverflowFacts(samples, 30, base).map(record => [record.kind, record.timeline])).toEqual([['text_clipped', { from: 0, to: 30 }]])
})
it('斜体负留白和下伸墨迹越出行框不算内容超框', () => {
  const draw = fact()
  draw.constraint = { x: 0, y: 0, ...draw.contentSize }
  draw.inkBounds = { x: -20, y: -20, width: draw.contentSize.width + 40, height: draw.contentSize.height + 40 }
  expect(videoEditTextOverflowFacts(stable(draw), 30, base)).toEqual([])
})
it('只有阴影越界、未知裁切或估计墨迹时不报告正文裁切；采样空洞不合并', () => {
  const draw = fact()
  draw.appearanceBounds = { x: -1000, y: -1000, width: 3000, height: 3000 }
  expect(videoEditTextOverflowFacts(stable(draw), 30, base)).toEqual([])
  const clipped = stable(draw).map(value => ({ ...value, effectiveClips: [textRectCorners({ x: 0, y: 0, width: 1, height: 1 })] }))
  for (const next of [{ ...draw, uncovered: ['任意 Canvas clip'] }, { ...draw, boundsKind: 'estimated' as const }]) expect(videoEditTextOverflowFacts(clipped.map(value => ({ ...value, draw: next })), 30, base)).toEqual([])
  const estimated = { ...draw, constraint: { x: 0, y: 0, ...draw.contentSize }, boundsKind: 'estimated' as const, inkBounds: { x: -100, y: -100, width: 500, height: 500 } }
  expect(videoEditTextOverflowFacts(stable(estimated), 30, base)).toEqual([])
  const overflow = fact('标题', { maxWidth: 1 })
  for (const draw of [{ ...overflow, bodyCoverage: 'partial' as const }, { ...overflow, bodyCoverage: 'none' as const }]) expect(videoEditTextOverflowFacts(stable(draw), 30, base)).toEqual([])
  expect(videoEditTextOverflowFacts([...stable(overflow).slice(0, 5), ...stable(overflow).slice(10, 15)], 30, base)).toEqual([])
})

it('持续裁切在画幅与 clip 之间切换仍合成同一区间', () => {
  const samples = stable(fact()), crop = textRectCorners({ x: 0, y: 0, width: 1, height: 100 })
  samples.forEach((sample, i) => { if (i % 2) sample.frameClips = [crop]; else sample.effectiveClips = [crop] })
  const records = videoEditTextOverflowFacts(samples, 30, base)
  expect(records).toHaveLength(1)
  expect(records[0]).toMatchObject({ kind: 'text_clipped', timeline: { from: 0, to: 30 } })
  expect(new Set(records[0].textOverflow?.clippedBy)).toEqual(new Set(['clip', 'frame']))
})
