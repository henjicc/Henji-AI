import { expect, it } from 'vitest'
import { createRecordingDocument } from './document'
import { recordingProductSteps, recordingStepsHtml, recordingStepsMarkdown } from './products'

it('代表帧选真实片段，保留源时间与显式选择顺序；未知、重复、超量步骤拒绝', () => {
  const recording = createRecordingDocument()
  recording.media = [{ id: 'a', kind: 'screen', path: '/a.mp4', monoUs: 1e6, durationUs: 2e6 }, { id: 'b', kind: 'screen', path: '/b.mp4', monoUs: 5e6, durationUs: 6e6 }]
  const step = { id: 'one', title: '<script>alert(1)</script>', description: '[链接](bad)\n第二行', startUs: 1e6, endUs: 11e6, signal: 'start' as const, eventIds: [] }
  recording.understanding.steps = [step]
  expect(recordingProductSteps(recording, recording.understanding)[0].representativeUs).toBe(8e6)
  expect(() => recordingProductSteps(recording, recording.understanding, ['missing'])).toThrow('不存在')
  expect(() => recordingProductSteps(recording, recording.understanding, ['one', 'one'])).toThrow('重复')
  expect(() => recordingProductSteps(recording, { ...recording.understanding, steps: Array.from({ length: 101 }, (_, i) => ({ ...step, id: String(i) })) })).toThrow('100')
  expect(() => recordingProductSteps({ ...recording, media: [] }, recording.understanding)).toThrow('没有')
  const steps = recordingProductSteps(recording, recording.understanding)
  expect(recordingStepsHtml('教程', steps)).toContain('&lt;script&gt;')
  expect(recordingStepsHtml('教程', steps)).not.toContain('<script>')
  expect(recordingStepsMarkdown('教程', steps)).toContain('\\[链接\\]')
  expect(recordingStepsMarkdown('教程', steps)).toContain('./step-001.png')
})
