import { describe, expect, it } from 'vitest'
import type { CodeMaterialKeyframe } from './codeMaterialAnimation'
import { createVideoEditGraphic, evaluateVideoEditGraphic, prepareVideoEditGraphic, videoEditGraphicObjectMetadata, videoEditGraphicSchema } from './graphics'
import type { VideoEditGraphic, VideoEditGraphicObject } from './graphics'
import { VIDEO_EDIT_MAX_SEQUENCE_SECONDS, offsetVideoEditSource } from './time'

const time = (sourceInUs: number) => ({ sourceInUs, sourceRemainder: { numerator: 0, denominator: 1 } })
const point = (id: string, sourceInUs: number, value: CodeMaterialKeyframe['value'], interpolation: CodeMaterialKeyframe['interpolation'] = 'linear'): CodeMaterialKeyframe => ({ id, ...time(sourceInUs), value, interpolation })
const rect = (parameters: VideoEditGraphicObject['parameters'] = {}): VideoEditGraphic => ({ width: 3840, height: 2160, objects: [{ id: 'shape', name: '标题背景', kind: 'rect', parameters }] })
const draw = (graphic: VideoEditGraphic, sourceInUs = 0) => evaluateVideoEditGraphic(prepareVideoEditGraphic(graphic), time(sourceInUs))[0]

describe('正式结构化图形模型与共用曲线求值', () => {
  it('创建可读回的纯色、矩形、椭圆和文字，保留独立稳定标识', () => {
    const created = (['solid', 'rect', 'ellipse', 'text'] as const).map(kind => createVideoEditGraphic(kind, 3840, 2160))
    expect(new Set(created.map(graphic => graphic.objects[0].id)).size).toBe(4)
    for (const graphic of created) {
      expect(videoEditGraphicSchema.parse(JSON.parse(JSON.stringify(graphic)))).toEqual(graphic)
      expect(graphic.objects[0].name).not.toBe('')
      expect(graphic.objects[0]).not.toHaveProperty('versionId')
      expect(graphic.objects[0]).not.toHaveProperty('source')
    }
    expect(draw(created[0]).command).toEqual({ kind: 'rect', x: 0, y: 0, width: 3840, height: 2160, fill: [0, 0, 0, 1], radius: 0 })
    expect(draw(created[1]).command).toMatchObject({ kind: 'rect', x: 960, y: 540, width: 1920, height: 1080 })
    expect(draw(created[2]).command).toMatchObject({ kind: 'ellipse', x: 960, y: 540, width: 1920, height: 1080 })
    expect(draw(created[3]).command).toMatchObject({ kind: 'text', text: '文字', x: 1920, y: 1080, align: 'center' })
  })
  it('尺寸和逐类型参数的合法范围仍校验，对象数量不设上限', () => {
    const graphic = rect()
    expect(videoEditGraphicSchema.safeParse({ ...graphic, width: 15 }).success).toBe(false)
    expect(videoEditGraphicSchema.safeParse({ ...graphic, height: 8193 }).success).toBe(false)
    expect(videoEditGraphicSchema.safeParse({ ...graphic, width: 100.5 }).success).toBe(false)
    expect(videoEditGraphicSchema.safeParse({ ...graphic, width: NaN }).success).toBe(false)
    expect(videoEditGraphicSchema.safeParse({ ...graphic, extra: 1 }).success).toBe(false)
    expect(videoEditGraphicSchema.safeParse({ ...graphic, objects: [{ ...graphic.objects[0], extra: 1 }] }).success).toBe(false)
    expect(videoEditGraphicSchema.safeParse({ ...graphic, objects: [graphic.objects[0], graphic.objects[0]] }).success).toBe(false)
    expect(videoEditGraphicSchema.safeParse({ ...graphic, objects: Array.from({ length: 1200 }, (_, index) => ({ ...graphic.objects[0], id: String(index) })) }).success).toBe(true)
    const invalidParameters: VideoEditGraphicObject['parameters'][] = [{ x: NaN }, { y: Infinity }, { x: -16385 }, { width: -1 }, { height: 16385 }, { rotation: 361 }, { opacity: 1.01 }, { radius: 8193 }, { fill: [0, 0, 0, 2] }, { fill: [0, 0, NaN, 1] }, { fontSize: 12 }, { unknown: 1 }]
    for (const parameters of invalidParameters) expect(videoEditGraphicSchema.safeParse(rect(parameters)).success).toBe(false)
    const ellipse = createVideoEditGraphic('ellipse', 16, 8192)
    ellipse.objects[0].parameters.radius = 0
    expect(videoEditGraphicSchema.safeParse(ellipse).success).toBe(false)
    expect(() => createVideoEditGraphic('rect', 0, 2160)).toThrow()
  })
  it('数值/颜色声明与对象名、画幅共源，离散值只允许保持插值', () => {
    const graphic = createVideoEditGraphic('text', 1920, 1080)
    const metadata = videoEditGraphicObjectMetadata(graphic, graphic.objects[0])
    expect(metadata).toMatchObject({ name: '文字', kind: 'generator', mode: 'static', width: 1920, height: 1080, durationSeconds: VIDEO_EDIT_MAX_SEQUENCE_SECONDS, seed: 0 })
    expect(metadata.parameters.every(parameter => parameter.animatable)).toBe(true)
    expect(metadata.parameters.find(parameter => parameter.key === 'text')).toMatchObject({ type: 'text', maxLength: 2000 })
    for (const parameters of [{ text: '字'.repeat(2001) }, { fontSize: 0 }, { fontSize: 513 }, { fontFamily: 'custom' }, { align: 'justify' }, { width: 100 }]) {
      expect(videoEditGraphicSchema.safeParse({ ...graphic, objects: [{ ...graphic.objects[0], parameters }] }).success).toBe(false)
    }
    graphic.objects[0].curves = { text: [point('text', 0, '新', 'linear')] }
    expect(videoEditGraphicSchema.safeParse(graphic).success).toBe(false)
    graphic.objects[0].curves = { align: [point('align', 0, 'invalid', 'hold')] }
    expect(videoEditGraphicSchema.safeParse(graphic).success).toBe(false)
  })
  it('旋转中心采用对象几何或文字锚点，opacity只合并颜色alpha且不改持久值', () => {
    const graphic = rect({ x: -100, y: 300, width: 600, height: 200, rotation: 90, opacity: .5, fill: [.2, .4, .6, .8] })
    const original = structuredClone(graphic)
    expect(draw(graphic)).toEqual({ rotation: 90, pivotX: 200, pivotY: 400, command: { kind: 'rect', x: -100, y: 300, width: 600, height: 200, fill: [.2, .4, .6, .4], radius: 0 } })
    expect(graphic).toEqual(original)
    const text = createVideoEditGraphic('text', 3840, 2160)
    Object.assign(text.objects[0].parameters, { x: 600, y: 700, rotation: -30, opacity: .25, color: [1, .5, 0, .8], align: 'right' })
    expect(draw(text)).toMatchObject({ rotation: -30, pivotX: 600, pivotY: 700, command: { kind: 'text', x: 600, y: 700, color: [1, .5, 0, .2], align: 'right' } })
    const ellipse = createVideoEditGraphic('ellipse', 3840, 2160)
    Object.assign(ellipse.objects[0].parameters, { x: 0, y: 0, width: 0, height: 20, rotation: 360, opacity: 0 })
    expect(draw(ellipse)).toMatchObject({ rotation: 360, pivotX: 0, pivotY: 10, command: { kind: 'ellipse', width: 0, fill: [1, 1, 1, 0] } })
  })
  it('沿真实有理NTSC源时刻求值数值和RGBA，首末区间保持且裁剪拆分不重定动画', () => {
    const rate = { numerator: 30000, denominator: 1001 }; const initial = time(0)
    const left = offsetVideoEditSource(initial, 1, rate); const right = offsetVideoEditSource(initial, 4, rate)
    const graphic = rect()
    graphic.objects[0].curves = {
      x: [{ ...point('x1', 0, 0), ...left }, { ...point('x4', 0, 600), ...right }],
      fill: [{ ...point('c1', 0, [0, .2, .4, .5]), ...left }, { ...point('c4', 0, [1, .8, 1, 1]), ...right }],
    }
    const prepared = prepareVideoEditGraphic(graphic)
    const middle = offsetVideoEditSource(initial, 2, rate)
    const trimmed = offsetVideoEditSource(left, 1, rate)
    expect(middle).toEqual(trimmed)
    expect(evaluateVideoEditGraphic(prepared, middle)).toEqual(evaluateVideoEditGraphic(prepared, trimmed))
    const command = evaluateVideoEditGraphic(prepared, middle)[0].command
    expect(command.kind).toBe('rect')
    if (command.kind !== 'rect') throw new Error('需真实矩形绘制命令')
    expect(command.x).toBeCloseTo(200, 12)
    expect(command.fill[0]).toBeCloseTo(1 / 3, 12); expect(command.fill[1]).toBeCloseTo(.4, 12)
    expect(command.fill[2]).toBeCloseTo(.6, 12); expect(command.fill[3]).toBeCloseTo(2 / 3, 12)
    expect(evaluateVideoEditGraphic(prepared, time(0))[0].command).toMatchObject({ x: 0, fill: [0, .2, .4, .5] })
    expect(evaluateVideoEditGraphic(prepared, time(2000e6))[0].command).toMatchObject({ x: 600, fill: [1, .8, 1, 1] })
    expect(evaluateVideoEditGraphic(prepared, right)[0].command).toMatchObject({ x: 600 })
  })
  it('复用基本缓动和文字/字体保持切换，不修改曲线原始数据', () => {
    const graphic = createVideoEditGraphic('text', 3840, 2160)
    graphic.objects[0].curves = {
      x: [point('x0', 0, 0, 'ease'), point('x1', 1e6, 100)],
      text: [point('t0', 0, '旧', 'hold'), point('t1', 1e6, '新', 'hold')],
      fontFamily: [point('f0', 0, 'serif', 'hold'), point('f1', 1e6, 'monospace', 'hold')],
    }
    const original = structuredClone(graphic)
    expect(draw(graphic, 250000).command).toMatchObject({ x: 15.625, text: '旧', fontFamily: 'serif' })
    expect(draw(graphic, 999999).command).toMatchObject({ text: '旧' })
    expect(draw(graphic, 1e6).command).toMatchObject({ x: 100, text: '新', fontFamily: 'monospace' })
    expect(graphic).toEqual(original)
  })
  it('拒绝未知曲线、重复有理时刻和非法关键帧值', () => {
    const graphic = rect()
    for (const curves of [
      { unknown: [point('u', 0, 0)] },
      { x: [point('a', 1, 0), { ...point('b', 1, 10), sourceRemainder: { numerator: 0, denominator: 2 } }] },
      { x: [point('same', 0, 0)], y: [point('same', 1, 0)] },
      { x: [point('out', 0, 16385)] },
      { x: [{ ...point('extra', 0, 0), extra: 1 }] },
      { x: [{ ...point('r', 0, 0), sourceRemainder: { numerator: 1, denominator: 1 } }] },
    ]) expect(videoEditGraphicSchema.safeParse({ ...graphic, objects: [{ ...graphic.objects[0], curves }] }).success).toBe(false)
  })
  it('多对象动画不限制持久化曲线或关键帧总数量', () => {
    const object = rect().objects[0]
    const makeObject = (index: number, curves: VideoEditGraphicObject['curves']): VideoEditGraphicObject => ({ ...object, id: String(index), curves })
    const curves = { x: [point('x', 0, 0)], y: [point('y', 0, 0)] }
    expect(videoEditGraphicSchema.safeParse({ width: 3840, height: 2160, objects: Array.from({ length: 16 }, (_, index) => makeObject(index, curves)) }).success).toBe(true)
    expect(videoEditGraphicSchema.safeParse({ width: 3840, height: 2160, objects: Array.from({ length: 200 }, (_, index) => makeObject(index, curves)) }).success).toBe(true)
    const points = Array.from({ length: 1200 }, (_, index) => point(String(index), index, 0))
    expect(videoEditGraphicSchema.safeParse({ width: 3840, height: 2160, objects: Array.from({ length: 8 }, (_, index) => makeObject(index, { x: points })) }).success).toBe(true)
    expect(videoEditGraphicSchema.safeParse({ width: 3840, height: 2160, objects: Array.from({ length: 9 }, (_, index) => makeObject(index, { x: points })) }).success).toBe(true)
  })
  it('prepared快照与求值颜色不能反向修改持久图形，对象顺序保持', () => {
    const graphic = rect({ fill: [.1, .2, .3, 1] })
    graphic.objects.push({ id: 'second', name: '第二层', kind: 'text', parameters: { text: '上层' } })
    const prepared = prepareVideoEditGraphic(graphic)
    graphic.objects[0].parameters.fill = [1, 1, 1, 1]
    graphic.objects[1].parameters.text = '晚改'
    const result = evaluateVideoEditGraphic(prepared, time(0))
    expect(result.map(value => value.command.kind)).toEqual(['rect', 'text'])
    expect(result[0].command).toMatchObject({ fill: [.1, .2, .3, 1] })
    expect(result[1].command).toMatchObject({ text: '上层' })
    if (result[0].command.kind === 'rect') result[0].command.fill[0] = 1
    expect(evaluateVideoEditGraphic(prepared, time(0))[0].command).toMatchObject({ fill: [.1, .2, .3, 1] })
    const empty = prepareVideoEditGraphic({ width: 16, height: 16, objects: [] })
    expect(evaluateVideoEditGraphic(empty, time(0))).toEqual([])
    expect(() => evaluateVideoEditGraphic(empty, time(-1))).toThrow('源时刻')
  })
})
