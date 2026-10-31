import { expect, it } from 'vitest'
import { videoEditCanvasIssues, videoEditCanvasIssueFacts, videoEditVisibilityDips } from './codeCanvasReview'
import type { AuthorElementObservation, AuthorCanvasReviewObservation } from './codeAuthorProgram'

const quad = (x: number, y: number, w: number, h: number): [number, number][] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]
const fact = (kind: AuthorCanvasReviewObservation['kind'], x: number, y: number, w: number, h: number): AuthorCanvasReviewObservation => ({ kind, text: kind === 'text' ? '整段正文' : undefined, opacity: 1, quad: quad(x, y, w, h) })
const element = (facts: AuthorCanvasReviewObservation[]): AuthorElementObservation => ({ id: 'text', name: '', bounds: [0, 0, 300, 200], matrix: [1, 0, 0, 1, 0, 0], corners: quad(0, 0, 300, 200), parameterKeys: [], textParameterKeys: [], canvasReview: facts })
const base = { sequenceId: 'sequence', path: [], subjectId: 'clip', elementPath: ['text'] }

it('高度不足或中心外的框不关联正文，居中窄框不因宽度排除', () => {
  const text = fact('text', 20, 20, 160, 30)
  const decorations = [fact('box', 20, 47, 160, 3), fact('box', 40, 20, 25, 30), fact('box', 75, 20, 2, 30), fact('box', 98, 32, 4, 4), fact('box', 20, 34, 160, 3)]
  expect(videoEditCanvasIssues(element([...decorations, text]))).toEqual([])
  // 仅凭几何无法区分居中的窄卡片与光标、单词底色，均保留为取帧核对候选。
  for (const candidate of [fact('box', 75, 20, 25, 30), fact('box', 99, 20, 2, 30)]) {
    expect(videoEditCanvasIssues(element([candidate, text]))).toEqual([expect.objectContaining({ kind: 'text_box_overflow', canvas: { text: '整段正文', inkQuad: text.quad, boxQuad: candidate.quad } })])
  }
  expect(videoEditCanvasIssues(element([fact('box', 40, 10, 120, 60), text]))).toEqual([expect.objectContaining({ kind: 'text_box_overflow', canvas: { text: '整段正文', inkQuad: text.quad, boxQuad: quad(40, 10, 120, 60) } })])
})

it('文字超过卡片两倍宽时仍报严重撑框，旋转后按卡片高度关联', () => {
  const card = fact('box', 80, 10, 40, 60), text = fact('text', 10, 20, 180, 30)
  for (const matrix of [[1, 0, 0, 1, 0, 0], [0, 1, -1, 0, 200, 0]] as AuthorElementObservation['matrix'][]) {
    const issues = videoEditCanvasIssues({ ...element([card, text]), matrix })
    expect(issues).toEqual([expect.objectContaining({ kind: 'text_box_overflow' })])
    expect(issues[0].canvas.boxQuad).not.toEqual(element([]).corners)
  }
})

it('条件绘制改变事实下标、小幅几何抖动不切碎持续撑框，相同正文分处绘制不合并', () => {
  const samples = Array.from({ length: 12 }, (_, frame) => ({ frame, issues: videoEditCanvasIssues(element([
    ...(frame % 2 ? [fact('box', 0, 0, 2, 2)] : []), fact('box', 40, 10, 120, 60), fact('text', 20 + (frame % 2 ? 2.1 : 1.9), 20, 160, 30),
  ])) }))
  expect(videoEditCanvasIssueFacts(samples, 30, base).map(record => record.timeline)).toEqual([{ from: 0, to: 12 }])
  const separate = element([fact('text', -20, 20, 60, 30), fact('text', -20, 100, 60, 30)])
  expect(videoEditCanvasIssueFacts(Array.from({ length: 12 }, (_, frame) => ({ frame, issues: videoEditCanvasIssues(separate) })), 30, base)).toHaveLength(2)
  const moving = Array.from({ length: 12 }, (_, frame) => ({ frame, issues: videoEditCanvasIssues(element([fact('text', 280 + frame * 5, 20, 80, 30)])) }))
  expect(videoEditCanvasIssueFacts(moving, 30, base).map(record => record.timeline)).toEqual([{ from: 0, to: 12 }])
})

it('短暂掉层或透明度回落报出，超过一秒的分场景复用和正常入出场不报', () => {
  const run = (fps: number, hidden: number, lead = 1, tail = 1) => videoEditVisibilityDips(Array.from({ length: lead + hidden + tail }, (_, frame) => ({ frame, visibility: frame >= lead && frame < lead + hidden ? 0 : 1 })), fps, base)
  expect(run(30, 30).map(record => record.timeline)).toEqual([{ from: 1, to: 31 }])
  expect(run(30, 31)).toEqual([])
  expect(run(60, 60)).toHaveLength(1)
  expect(run(30, 5, 0)).toEqual([])
  expect(run(30, 5, 1, 0)).toEqual([])
})
