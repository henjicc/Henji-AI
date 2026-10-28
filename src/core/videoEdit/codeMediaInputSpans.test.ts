import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createVideoEditDocument, createVideoEditSequence, videoEditComposition, type VideoEditClip } from './document'
import { addLegacyVideoEditTracks } from './testFixtures'
import { codeMediaFrameParameters, codeMediaInputActive, codeMediaInputClipSeconds, codeMediaInputComposition, codeMediaInputKey, codeMediaInputNextFrame, codeMediaInputSeconds, CodeMediaInputReferenceError } from './codeMediaInput'
import { codeImageReference, isCodeImageReference, type CodeImageReference, type CodeVideoSpan } from './codeMaterial/contract'
import { codeMaterialImageReferenceSchema } from './codeMaterial/parameterValueSchema'
import { CODE_VIDEO_SPAN_LIMIT } from './codeMaterial/videoSpans'
import { codeMaterialContextForFrame } from './codeMaterialTiming'
import { RECORDING_CURSOR_EFFECT } from './recordingCursor'

const rate = { numerator: 30, denominator: 1 }
/** 入点 1 秒、从第 30 帧开始的代码片段：片段时间 t = 1 + (帧 − 30) / 30。 */
const clip = { start: 30, duration: 150, sourceInUs: 1_000_000, sourceRemainder: { numerator: 0, denominator: 1 } }
const video = (spans: CodeVideoSpan[]): CodeImageReference => ({ kind: 'video', mediaId: 'screen', spans })
const timetable = video([{ from: 1, to: 2, src: 5 }, { from: 2, to: 3, src: 8, rate: 0 }, { from: 4, to: 5, src: .5, rate: 4 }])
const frameAt = (t: number): number => clip.start + (t - 1) * 30

function fixture(spans: CodeVideoSpan[] = timetable.spans!, cursor?: { cursorBakedIn: boolean }) {
  const document = createVideoEditDocument('取帧时间表'), sequence = createVideoEditSequence('主'); sequence.id = 'root'; addLegacyVideoEditTracks(sequence); document.sequences = [sequence]
  document.media = [{ id: 'screen', name: '录屏', kind: 'video', path: path.resolve(path.sep, 'screen.mp4'), width: 320, height: 180, durationSeconds: 20, ...(cursor ? { recordingCursor: cursor as never } : {}) }]
  document.items = [{ id: 'screen-item', name: '录屏', kind: 'video', mediaId: 'screen' }]
  const code: VideoEditClip = { ...clip, id: 'code', itemId: 'code-item', name: '代码', kind: 'code', track: 3, x: .5, y: .5, scale: 1, rotation: 0, opacity: 1, volume: 1, text: '', code: { definitionId: 'd', versionId: 'v', parameters: { screen: video(spans) } } }
  sequence.clips = [code]
  return { composition: videoEditComposition(document, sequence.id), clip: code }
}

describe('视频参数取帧时间表 spans', () => {
  it('段内按 src + (t − from) × rate 取帧：正常、停住、倍速；段间空档与 to 边界之后不参与', () => {
    const cases: Array<[number, number | undefined]> = [[1, 5], [1.5, 5.5], [2, 8], [2.5, 8], [2.999, 8], [3, undefined], [3.5, undefined], [4, .5], [4.5, 2.5], [5, undefined], [.5, undefined]]
    for (const [t, expected] of cases) {
      const seconds = codeMediaInputSeconds(clip, timetable, frameAt(t), rate)
      if (expected === undefined) expect(seconds, `t=${t}`).toBeUndefined()
      else expect(seconds, `t=${t}`).toBeCloseTo(expected, 9)
      expect(codeMediaInputActive(clip, timetable, frameAt(t), rate)).toBe(expected !== undefined)
    }
    // 不带时间表的引用照旧：跟随片段时间或固定时刻，每帧都参与。
    expect(codeMediaInputSeconds(clip, { kind: 'video', mediaId: 'screen' }, frameAt(3.5), rate)).toBeCloseTo(3.5, 9)
    expect(codeMediaInputSeconds(clip, { kind: 'video', mediaId: 'screen', time: 2 }, frameAt(3.5), rate)).toBe(2)
  })

  it('时间轴与代码拿到的 info.clip.time 一致：片段入点加 info.clip.time；入点为 0、从 0 帧开始时就是序列时间', () => {
    const program = { mode: 'dynamic' as const, width: 64, height: 36 }
    for (const frame of [30, 47, 100]) {
      const clipTime = codeMaterialContextForFrame(clip, frame, rate, program).localTime
      expect(codeMediaInputClipSeconds(clip, frame, rate)).toBeCloseTo(1 + clipTime, 12)
    }
    const fresh = { ...clip, start: 0, sourceInUs: 0 }
    for (const frame of [0, 1, 59]) {
      expect(codeMediaInputClipSeconds(fresh, frame, rate)).toBe(codeMaterialContextForFrame(fresh, frame, rate, program).localTime)
      expect(codeMediaInputClipSeconds(fresh, frame, rate)).toBeCloseTo(frame / 30, 12)
    }
  })

  it('校验：time 与 spans 互斥，乱序、重叠、from ≥ to、负 src 或 rate、未知字段与超过上限都拒绝', () => {
    const valid = { kind: 'video', mediaId: 'screen', spans: [{ from: 0, to: 1, src: 0 }, { from: 1, to: 2, src: 3, rate: 0, cursor: false }] }
    expect(codeImageReference(valid, 'screen')).toEqual(valid)
    expect(codeMaterialImageReferenceSchema.safeParse(valid).success).toBe(true)
    const invalid: unknown[] = [
      { ...valid, time: 1 },
      { ...valid, spans: [{ from: 0, to: 2, src: 0 }, { from: 1, to: 3, src: 0 }] },
      { ...valid, spans: [{ from: 2, to: 3, src: 0 }, { from: 0, to: 1, src: 0 }] },
      { ...valid, spans: [{ from: 1, to: 1, src: 0 }] },
      { ...valid, spans: [{ from: 0, to: 1, src: -1 }] },
      { ...valid, spans: [{ from: 0, to: 1, src: 0, rate: -1 }] },
      { ...valid, spans: [{ from: 0, to: 1, src: 0, rate: Infinity }] },
      { ...valid, spans: [{ from: 0, to: 1, src: 0, cursor: 'no' }] },
      { ...valid, spans: [{ from: 0, to: 1, src: 0, speed: 2 }] },
      { ...valid, spans: [] },
      { ...valid, spans: Array.from({ length: CODE_VIDEO_SPAN_LIMIT + 1 }, (_, index) => ({ from: index, to: index + 1, src: 0 })) },
      { kind: 'image', mediaId: 'logo', spans: valid.spans },
      { kind: 'image', mediaId: 'x'.repeat(101) },
      { kind: 'video', mediaId: 'x'.repeat(101) },
    ]
    for (const value of invalid) {
      expect(() => codeImageReference(value, 'screen'), JSON.stringify(value).slice(0, 80)).toThrow()
      expect(isCodeImageReference(value)).toBe(false)
      expect(codeMaterialImageReferenceSchema.safeParse(value).success, JSON.stringify(value).slice(0, 80)).toBe(false)
    }
    // 恰好上限的段数、首尾相接的段（前一段的 to 等于后一段的 from）合法。
    const limit = { kind: 'video', mediaId: 'screen', spans: Array.from({ length: CODE_VIDEO_SPAN_LIMIT }, (_, index) => ({ from: index, to: index + 1, src: 0 })) }
    expect(isCodeImageReference(limit)).toBe(true); expect(codeMaterialImageReferenceSchema.safeParse(limit).success).toBe(true)
  })

  it('输入合成：段间不参与（不出画面，不开会话）；停住的帧取样相同，整段一个会话，换时间表换会话', () => {
    const { composition, clip: code } = fixture()
    expect(codeMediaInputComposition(composition, code, timetable, frameAt(3.5))).toBeUndefined()
    const held = [2, 2.5, 2.9].map(t => codeMediaInputComposition(composition, code, timetable, frameAt(t))!)
    expect(new Set(held.map(input => input.sampleKey)).size).toBe(1)
    expect(held[0].document.clips[0].sourceInUs).toBe(8_000_000)
    const moving = [1, 1.5, 4, 4.5].map(t => codeMediaInputComposition(composition, code, timetable, frameAt(t))!)
    expect(new Set(moving.map(input => input.sampleKey)).size).toBe(4)
    expect(new Set([...held, ...moving].map(input => input.sessionKey)).size).toBe(1)
    expect([...held, ...moving].every(input => input.kind === 'video' && !input.still && input.timetabled)).toBe(true)
    const other = codeMediaInputComposition(composition, code, video([{ from: 1, to: 2, src: 6 }]), frameAt(1.5))!
    const follow = codeMediaInputComposition(composition, code, { kind: 'video', mediaId: 'screen' }, frameAt(1.5))!
    expect(new Set([held[0].sessionKey, other.sessionKey, follow.sessionKey]).size).toBe(3)
    expect(follow.timetabled).toBe(false)
  })

  it('cursor:false 的一段不画录制鼠标与点击；同一取帧时刻有无鼠标取样不同，画面已带鼠标时不受影响', () => {
    const spans = [{ from: 1, to: 2, src: 3, rate: 0 }, { from: 2, to: 3, src: 3, rate: 0, cursor: false }]
    const { composition, clip: code } = fixture(spans, { cursorBakedIn: false })
    const reference = video(spans)
    const drawn = codeMediaInputComposition(composition, code, reference, frameAt(1.5))!, hidden = codeMediaInputComposition(composition, code, reference, frameAt(2.5))!
    expect(drawn.document.clips[0].effects?.map(effect => effect.builtin?.id)).toEqual([RECORDING_CURSOR_EFFECT])
    expect(hidden.document.clips[0].effects).toBeUndefined()
    expect(hidden.document.clips[0].sourceInUs).toBe(drawn.document.clips[0].sourceInUs)
    expect(hidden.sampleKey).not.toBe(drawn.sampleKey); expect(hidden.sessionKey).toBe(drawn.sessionKey)
    const baked = fixture(spans, { cursorBakedIn: true })
    const plain = [1.5, 2.5].map(t => codeMediaInputComposition(baked.composition, baked.clip, reference, frameAt(t))!)
    expect(plain.every(input => input.document.clips[0].effects === undefined)).toBe(true)
    expect(plain[0].sampleKey).toBe(plain[1].sampleKey)
  })

  it('作者代码这一帧的参数：段内是输入画面，段间为 null（和未绑定一样没有画面）', () => {
    const { clip: code } = fixture()
    expect(codeMediaFrameParameters(code, { screen: timetable, label: '标题' }, frameAt(1.5), rate, new Set(['screen']))).toEqual({ parameters: { screen: { kind: 'image', mediaId: codeMediaInputKey(code.id, 'screen') }, label: '标题' }, images: new Map([['screen', codeMediaInputKey(code.id, 'screen')]]) })
    expect(codeMediaFrameParameters(code, { screen: timetable, label: '标题' }, frameAt(3.5), rate, new Set(['screen']))).toEqual({ parameters: { screen: null, label: '标题' }, images: new Map() })
  })

  it('帧期画面绑定独立于持久引用：长派生键、静态图片和下方画面都明确绑定，损坏引用直接失败', () => {
    const { clip: code } = fixture()
    code.id = '12345678-1234-4abc-8def-123456789abc'
    const mediaId = '089966db-89ab-4cde-8123-0123456789ab'
    const parameter = `scene-input:${JSON.stringify(['yuanbao-film', 'win-demo', 'shot', mediaId, 0])}`
    const key = codeMediaInputKey(code.id, parameter)
    const result = codeMediaFrameParameters(code, { [parameter]: { kind: 'video', spans: timetable.spans, mediaId }, still: { kind: 'image', mediaId }, below: { kind: 'sequence', mediaId: 'below' } }, frameAt(1.5), rate, new Set([parameter, 'still', 'below']))
    expect(key.length).toBeGreaterThan(100)
    expect(result.images).toEqual(new Map([[parameter, key], ['still', mediaId], ['below', codeMediaInputKey(code.id, 'below')]]))
    expect(result.parameters[parameter]).toEqual({ kind: 'image', mediaId: key })
    expect(isCodeImageReference(result.parameters[parameter])).toBe(false)
    expect(codeMaterialImageReferenceSchema.safeParse(result.parameters[parameter]).success).toBe(false)
    for (const value of [{ kind: 'image' as const, mediaId: 'x'.repeat(101) }, { kind: 'video' as const, mediaId, time: -1 }]) {
      expect(() => codeMediaFrameParameters(code, { [parameter]: value }, frameAt(1.5), rate, new Set([parameter]))).toThrow(CodeMediaInputReferenceError)
    }
  })

  it('下一次参与的帧：跳到下一段的第一帧，跳过没有帧落进去的短段，超出上限为空', () => {
    expect(codeMediaInputNextFrame(clip, timetable, frameAt(1.5), 1000, rate)).toBe(frameAt(1.5))
    expect(codeMediaInputNextFrame(clip, timetable, frameAt(3.2), 1000, rate)).toBe(frameAt(4))
    expect(codeMediaInputNextFrame(clip, timetable, frameAt(3.2), frameAt(4), rate)).toBeUndefined()
    expect(codeMediaInputNextFrame(clip, timetable, frameAt(5), 1000, rate)).toBeUndefined()
    // [3.01, 3.02) 比一帧（1/30 秒）还短，没有帧落进去。
    const short = video([{ from: 1, to: 2, src: 0 }, { from: 3.01, to: 3.02, src: 0 }, { from: 4, to: 5, src: 0 }])
    expect(codeMediaInputNextFrame(clip, short, frameAt(2.5), 1000, rate)).toBe(frameAt(4))
    // 段从两帧之间开始：第一帧是 t 首次 ≥ from 的那一帧。
    const between = video([{ from: 2.01, to: 3, src: 0 }])
    const next = codeMediaInputNextFrame(clip, between, frameAt(1), 1000, rate)!
    expect(codeMediaInputActive(clip, between, next, rate)).toBe(true); expect(codeMediaInputActive(clip, between, next - 1, rate)).toBe(false)
    expect(codeMediaInputNextFrame(clip, { kind: 'video', mediaId: 'screen' }, 40, 1000, rate)).toBe(40)
  })
})
