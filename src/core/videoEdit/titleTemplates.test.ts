import { expect, it } from 'vitest'
import { createVideoEditSequence } from './document'
import { BUILTIN_TITLE_TEMPLATES, captureTitleTemplate, instantiateTitleTemplate, titleColor, titleTemplateOverridesSchema } from './titleTemplates'
import { evaluateVideoEditGraphic, prepareVideoEditGraphic } from './graphics'

it('六类模板共享图形求值，文字/颜色/秒数转换为当前序列帧和入出场关键帧', () => {
  const sequence = createVideoEditSequence('标题'); sequence.frameRate = { numerator: 30000, denominator: 1001 }
  for (const template of BUILTIN_TITLE_TEMPLATES) {
    const clip = instantiateTitleTemplate(template, { text: '痕迹', color: template.parameters.textColor, font: 'monospace', durationSeconds: 4 }, sequence)[0]
    expect(clip.duration).toBe(120); const graphic = clip.graphic!; const prepared = prepareVideoEditGraphic(graphic)
    const last = (119 / (30000 / 1001)) * 1e6
    expect(evaluateVideoEditGraphic(prepared, { sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 } }).every(draw => ('color' in draw.command ? draw.command.color : 'fill' in draw.command ? draw.command.fill : [0, 0, 0, 0])[3] === 0)).toBe(true)
    const middle = evaluateVideoEditGraphic(prepared, { sourceInUs: 2000000, sourceRemainder: { numerator: 0, denominator: 1 } })
    expect(middle.some(draw => draw.command.kind === 'text' && draw.command.text.includes('痕迹') && draw.command.fontFamily === 'monospace')).toBe(true)
    expect(graphic.objects[0].curves?.opacity?.at(-1)?.sourceInUs).toBe(Math.round(last))
  }
})
it('计数到达最后一帧；滚动字幕位置从画面下方移动到上方', () => {
  const sequence = createVideoEditSequence('动画')
  const counter = instantiateTitleTemplate(BUILTIN_TITLE_TEMPLATES[4], { countFrom: 5, countTo: 42 }, sequence)[0]
  const points = counter.graphic!.objects[0].curves!.text
  expect(points[0].value).toBe('累计 5'); expect(points.at(-1)?.value).toBe('累计 42')
  const credits = instantiateTitleTemplate(BUILTIN_TITLE_TEMPLATES[3], {}, sequence)[0]
  for (const object of credits.graphic!.objects) { expect(object.curves?.y?.[0].value).toBeGreaterThanOrEqual(sequence.height); expect(object.curves?.y?.at(-1)?.value).toBeLessThan(0) }
})
it('用户组合复制时重映射对象标识、缩放画幅、换算时长且保持独立文本', () => {
  const sequence = createVideoEditSequence('保存')
  const snapshots = instantiateTitleTemplate(BUILTIN_TITLE_TEMPLATES[0], {}, sequence)
  const original = snapshots.map((clip, i) => ({ ...clip, id: `clip-${i}`, itemId: `item-${i}`, start: 30, track: 1 }))
  const template = captureTitleTemplate('组合', sequence, original)
  const target = { ...sequence, width: 3840, height: 2160, frameRate: { numerator: 60, denominator: 1 } }
  const result = instantiateTitleTemplate(template, { durationSeconds: 10, text: '新姓名', subtitle: '新职务', textColor: template.parameters.color }, target)[0]
  expect(result.duration).toBe(600); expect(result.graphic!.width).toBe(3840)
  const texts = result.graphic!.objects.filter(object => object.kind === 'text')
  expect(texts.map(object => object.parameters.text)).toEqual(['新姓名', '新职务'])
  expect(texts[0].parameters.color).toEqual(titleColor(template.parameters.color))
  expect(result.graphic!.objects[0].id).not.toBe(original[0].graphic!.objects[0].id)
  expect(template.content?.clips[0].graphic?.objects[1].parameters.text).toBe('姓名')
})
it('助手只覆盖文字时不补默认值重置原时长或颜色', () => {
  expect(titleTemplateOverridesSchema.parse({ text: '新版标题' })).toEqual({ text: '新版标题' })
  const sequence = createVideoEditSequence('部分修改'); const template = BUILTIN_TITLE_TEMPLATES[3]
  const result = instantiateTitleTemplate(template, titleTemplateOverridesSchema.parse({ text: '新版标题' }), sequence)
  expect(result[0].duration).toBe(360)
})
