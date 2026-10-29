import { expect, it, vi } from 'vitest'
import { collectVideoEditCodeMotion, type CodeMotionObserver } from './codeMotionReview'
import type { CodeAuthorProgram, CodeAuthorFrameObservation } from './codeAuthorProgram'
import { createVideoEditDocument, createVideoEditSequence, videoEditComposition, type VideoEditClip } from './document'
import { addLegacyVideoEditTracks } from './testFixtures'
import type { TextDrawObservation } from './textDrawObservation'
import { createTextDrawPlan } from '../imaging/vectorContent/textDrawPlan'
import { textStyleSchema } from '../imaging/vectorContent/text'

function fixture() {
  const document = createVideoEditDocument('代码运动'), sequence = createVideoEditSequence('主')
  sequence.id = 'root'; sequence.width = sequence.height = 1000; addLegacyVideoEditTracks(sequence); document.sequences = [sequence]
  const clip: VideoEditClip = { id: 'code', itemId: 'code-item', name: '代码', kind: 'code', track: 1, start: 0, duration: 120, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: .5, y: .5, scale: 1, rotation: 0, opacity: 1, volume: 1, text: '', code: { definitionId: 'definition', versionId: 'version', parameters: {} } }
  sequence.clips = [clip]
  const program: CodeAuthorProgram = { apiVersion: 4, languageVersion: 4, name: '复核', kind: 'generator', mode: 'dynamic', seed: 0, parameters: [], types: {}, frames: [], hexColors: [], bundle: { code: '', map: '', locations: { layers: {} } } }
  const composition = videoEditComposition(document, sequence.id)
  const observe: CodeMotionObserver = async (local, frame) => ({ sequenceId: local.id, revision: local.revision, frame, clips: [{ clipId: clip.id, versionId: 'version', width: 1000, height: 1000, elements: [{ id: 'node-3', name: '第三个节点', bounds: [0, 0, 100, 100], matrix: [1, 0, 0, 1, frame * 5, 0], corners: [[frame * 5, 0], [100 + frame * 5, 0], [100 + frame * 5, 100], [frame * 5, 100]], parameterKeys: [], textParameterKeys: [] }] }] })
  const run = (observer = observe) => collectVideoEditCodeMotion(composition, { from: 0, to: 120 }, { version: program }, {}, observer)
  return { composition, clip, program, observe, run }
}
it('measures actual observed layer motion without evaluating author code in the review worker', async () => {
  const { run, observe } = fixture(), read = vi.fn(observe)
  const result = await run(read)
  expect(read).toHaveBeenCalledTimes(120)
  expect(result.sampledFrames).toBe(120)
  expect(result.sampledElements).toBe(120)
  expect(result.records.some(record => record.kind === 'motion' && record.elementPath?.[0] === 'node-3')).toBe(true)
  expect(result.records.some(record => record.kind === 'code_unavailable')).toBe(true)
  expect(result.records.some(record => record.kind === 'motion_hold')).toBe(false)
})
it('rejects a stale observation rather than attributing it to the requested frame', async () => {
  const { run, observe } = fixture()
  await expect(run(async (local, frame) => ({ ...await observe(local, frame), revision: local.revision + 1 }))).rejects.toThrow('画面已改变')
})
it('keeps source-only content unknown when stationary bounds reveal no pixel changes', async () => {
  const { run, observe } = fixture()
  const result = await run(async (local, frame) => ({ ...await observe(local, 0), frame }))
  expect(result.records.some(record => record.kind === 'motion_hold')).toBe(false)
  expect(result.records.filter(record => record.kind === 'code_unavailable')).toHaveLength(1)
  expect(result.records.some(record => record.kind.startsWith('text_'))).toBe(false)
  expect(result.warnings).toEqual([])
})

it('文字墨迹与录制 clip 各用所属矩阵投影到查询序列，不把图层 bounds 当成文字', async () => {
  const { run, clip, observe } = fixture(); clip.x = 0; clip.y = 0
  const draw: TextDrawObservation = {
    sourceText: '标题', box: { x: 0, y: 0, width: 50, height: 20 }, constraint: { x: 0, y: 0, width: 50, height: 20 },
    contentSize: { width: 50, height: 20 }, visibleContentSize: { width: 50, height: 20 }, inkBounds: { x: 0, y: 0, width: 50, height: 20 }, appearanceBounds: { x: -100, y: -100, width: 300, height: 300 }, boundsKind: 'measured',
    overflow: { full: { width: false, height: false, lines: false }, visible: { width: false, height: false, lines: false } }, truncated: false, omittedRanges: [], totalLines: 1, actualLines: 1,
    fit: { applied: false, failed: false, fontSize: 20, scale: 1 }, matrix: [1, 0, 0, 1, 20, 0], clips: [[[0, 0], [40, 0], [40, 100], [0, 100]]], opacity: 1, uncovered: [],
  }
  const result = await run(async (local, frame) => {
    const value = await observe(local, 0); value.frame = frame
    Object.assign(value.clips[0].elements[0], { matrix: [1, 0, 0, 1, 80, 100], textDraws: [draw] })
    return value
  })
  const records = result.records.filter(record => record.kind.startsWith('text_'))
  expect(records).toHaveLength(1)
  expect(records[0]).toMatchObject({ kind: 'text_clipped', timeline: { from: 0, to: 120 }, textOverflow: { matrix: [1, 0, 0, 1, 100, 100], clippedBy: ['clip'] } })
  expect(records[0].textOverflow?.inkQuad).toEqual([[100, 100], [150, 100], [150, 120], [100, 120]].map(point => point.map(value => expect.closeTo(value, 8))))
  expect(records[0].textOverflow?.effectiveClips[0]).toEqual([[80, 100], [120, 100], [120, 200], [80, 200]].map(point => point.map(value => expect.closeTo(value, 8))))
})
it('propagates real render failures and does not fabricate invisible layers', async () => {
  await expect(fixture().run(async (): Promise<CodeAuthorFrameObservation> => { throw new Error('作者执行失败') })).rejects.toThrow('作者执行失败')
})
it('maps observed author layers into output pixels for picture checks: settled text creep and an edge-hugging key element', async () => {
  const { run, clip } = fixture()
  clip.x = 0; clip.y = 0
  const layer = (id: string, name: string, x: number, y: number, width: number, height: number, textParameterKeys: string[] = []) => ({ id, name, bounds: [0, 0, width, height] as [number, number, number, number], matrix: [1, 0, 0, 1, x, y] as [number, number, number, number, number, number], corners: [[x, y], [x + width, y], [x + width, y + height], [x, y + height]] as [number, number][], parameterKeys: textParameterKeys, textParameterKeys })
  const result = await run(async (local, frame) => ({ sequenceId: local.id, revision: local.revision, frame, clips: [{ clipId: clip.id, versionId: 'version', width: 1000, height: 1000, elements: [
    layer('headline', '标题', 500 - 400 * .85 ** frame, 450, 300, 70, ['title']),
    layer('logo', '角标', 10, 880, 80, 80),
    layer('backdrop', '背景', 0, 0, 1000, 1000),
  ] }] }))
  const checks = result.records.filter(record => ['settled_jitter', 'safe_area'].includes(record.kind))
  expect(checks).toEqual([
    expect.objectContaining({ kind: 'settled_jitter', elementPath: ['headline'], basis: 'code_structure', label: '代码 · 标题' }),
    expect.objectContaining({ kind: 'safe_area', elementPath: ['logo'], timeline: { from: 0, to: 120 }, safeArea: { zone: 'action', edges: ['left'], overflowPercent: 2.5 } }),
  ])
})

it('只对实际绘制旧文字的图层提示未覆盖，短查询说明稳定帧数不足', async () => {
  const { composition, program, observe } = fixture()
  const observer: CodeMotionObserver = async (local, frame) => {
    const value = await observe(local, frame)
    value.clips[0].elements[0].textUncovered = ['图层含未使用新版排版库的 Canvas 文字，文字超框未覆盖']
    return value
  }
  const result = await collectVideoEditCodeMotion(composition, { from: 0, to: 2 }, { version: program }, {}, observer)
  expect(result.records.some(record => record.kind.startsWith('text_'))).toBe(false)
  expect(result.warnings.join(' ')).toContain('这些图层未使用排版库')
  expect(result.warnings.join(' ')).toContain('短于文字检查')
})

it('整个查询区间一次都没画过才按图层告警，延迟与间歇绘制不误报', async () => {
  const { run, observe } = fixture()
  const plan = createTextDrawPlan('标题', textStyleSchema.parse({ fontSize: 20 }), {}, () => 20)
  const draw: TextDrawObservation = { ...plan, layoutId: 'delayed', constraint: { x: 0, y: 0 }, actualLines: 1, matrix: [1, 0, 0, 1, 0, 0], opacity: 1, clips: [], uncovered: [] }
  const result = await run(async (local, frame) => {
    const value = await observe(local, frame), element = value.clips[0].elements[0]
    element.textLayouts = ['never', 'another-never', 'delayed']
    element.textDraws = frame === 45 ? [draw] : []
    return value
  })
  const warnings = result.warnings.join(' ')
  expect(warnings.match(/没有 drawText 该布局/g)).toHaveLength(1)
  const delayed = await run(async (local, frame) => {
    const value = await observe(local, frame), element = value.clips[0].elements[0]
    element.textLayouts = ['delayed']; element.textDraws = frame === 45 ? [draw] : []
    return value
  })
  expect(delayed.warnings.join(' ')).not.toContain('没有 drawText 该布局')
})
