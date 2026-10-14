import { describe, expect, it } from 'vitest'
import { createVideoEditSequence } from './document'
import { BUILTIN_STYLE_KITS } from './styleKitPresets'
import { migrateStyleKitV1, styleColorHex, styleEasingBezier, styleKeyframeCurves, styleKitPromptHint, styleKitSchema, styleReadingSeconds, styledVideoEditTextStyle, styleTokensSchema } from './styleKit'
import { BUILTIN_TITLE_TEMPLATES, instantiateTitleTemplate } from './titleTemplates'
import { styleKitSubtitleStyle } from './subtitleStyle'
import { defaultVideoEditTextStyle } from './text'
import { compileCodeMaterial } from './codeMaterial/compiler'
import { evaluateCodeMaterial } from './codeMaterial/evaluate'
import { codeCubicBezier } from './codeMaterial/motion'

const kit = BUILTIN_STYLE_KITS[0]
describe('风格模板契约', () => {
  it('抽象概念必须带判据，回弹曲线必须显式允许，旧 Markdown 规则迁入补充说明', () => {
    expect(() => styleKitSchema.parse({ ...kit, profile: { ...kit.profile, concepts: [{ id: 'c', name: '高级感', meaning: '看着贵', criteria: [] }] } })).toThrow()
    expect(() => styleTokensSchema.parse({ ...kit.tokens, motion: { ...kit.tokens.motion, enterEase: [.3, 1.6, .6, 1] } })).toThrow('回弹')
    expect(styleTokensSchema.parse({ ...kit.tokens, motion: { ...kit.tokens.motion, enterEase: [.3, 1.6, .6, 1], allowOvershoot: true } }).motion.enterEase).toEqual([.3, 1.6, .6, 1])
    const upgraded = styleKitSchema.parse(migrateStyleKitV1({ id: 'old', name: '旧风格', tokens: {}, rules: '# 旧规则', samples: [] }))
    expect(upgraded).toMatchObject({ notes: '# 旧规则', rules: [], rhythm: { cutOn: 'auto', shotSeconds: null }, generation: { inject: true } })
  })
  it('三套内置风格都满足设计规则：有定位、场景、带判据的概念和带强度的规则', () => {
    for (const value of BUILTIN_STYLE_KITS) {
      expect(value.profile.summary).not.toBe(''); expect(value.profile.scenarios.length).toBeGreaterThan(0)
      expect(value.profile.concepts.every(concept => concept.criteria.length > 0)).toBe(true)
      expect(new Set(value.rules.map(rule => rule.kind))).toEqual(new Set(['do', 'dont', 'keep', 'vary']))
      expect(value.samples.map(sample => sample.kind)).toEqual(['title', 'lower_third', 'chapter', 'emphasis', 'data', 'caption'])
    }
  })
  it('关键帧曲线与代码缓动同形：命名缓动换成贝塞尔后中点一致', () => {
    const curves = styleKeyframeCurves(kit.tokens)
    expect(curves.enter).toEqual({ interpolation: 'bezier', bezier: styleEasingBezier(kit.tokens.motion.enterEase), durationSeconds: kit.tokens.motion.enterDuration })
    expect(codeCubicBezier(...styleEasingBezier('cubicInOut'), .5)).toBeCloseTo(.5, 2)
    expect(styleReadingSeconds(kit.tokens, '让创作保持一致')).toBeCloseTo(7 / kit.tokens.motion.readingSpeed + kit.tokens.motion.minHold)
  })
  it('代码 tween 接受风格里的贝塞尔曲线', () => {
    const tokens = styleTokensSchema.parse({ ...kit.tokens, motion: { ...kit.tokens.motion, enterEase: [.2, 0, .2, 1] } })
    const program = compileCodeMaterial('export default { apiVersion: 1, languageVersion: 3, name: "曲线", kind: "generator", mode: "dynamic", width: 100, height: 100, durationSeconds: 1, seed: 1, parameters: {}, render(ctx) { return [rect({ id: "r", x: tween(ctx.time, 0, 1, 0, 100, ctx.style.motion.enterEase), y: 0, width: 10, height: 10, fill: ctx.style.palette.accent })] } }')
    const at = (style: typeof tokens) => evaluateCodeMaterial(program, { time: .5, localTime: .5, sequenceTime: .5, width: 100, height: 100, frame: 15, fps: 30, style }, {})[0] as { x: number }
    expect(at(tokens).x).toBeCloseTo(100 * codeCubicBezier(.2, 0, .2, 1, .5), 5)
    expect(at(kit.tokens).x).not.toBeCloseTo(at(tokens).x, 3)
  })
})
describe('文字、字幕、标题模板跟随风格', () => {
  it('没有风格时保持原默认；有风格时取风格字体、字号与颜色', () => {
    expect(styledVideoEditTextStyle(undefined, 1080)).toEqual(defaultVideoEditTextStyle(1080))
    const styled = styledVideoEditTextStyle(kit, 1080, 'display')
    expect(styled).toMatchObject({ fontFamily: kit.tokens.fonts.display.family, fill: { enabled: true, color: styleColorHex(kit.tokens.palette.fg) } })
    const subtitle = styleKitSubtitleStyle(kit)
    expect(subtitle).toMatchObject({ fontFamily: kit.tokens.fonts.body.family, strokes: [{ color: styleColorHex(kit.tokens.palette.bg) }] })
  })
  it('内置标题模板取强调色与风格入出场曲线；显式参数仍优先', () => {
    const sequence = createVideoEditSequence('风格标题')
    const [clip] = instantiateTitleTemplate(BUILTIN_TITLE_TEMPLATES[0], { text: '痕迹' }, sequence, kit)
    const [plate, title] = clip.graphic!.objects
    expect(plate.parameters.fill).toEqual(kit.tokens.palette.accent)
    expect(title.textStyle?.fontFamily).toBe(kit.tokens.fonts.display.family)
    expect(title.curves?.opacity?.[0]).toMatchObject({ interpolation: 'bezier', bezier: styleEasingBezier(kit.tokens.motion.enterEase) })
    expect(title.curves?.opacity?.[1].sourceInUs).toBe(Math.round(kit.tokens.motion.enterDuration * 1e6))
    const [explicit] = instantiateTitleTemplate(BUILTIN_TITLE_TEMPLATES[0], { color: styleColorHex([1, 0, 0, 1]) }, sequence, kit)
    expect(explicit.graphic!.objects[0].parameters.fill).toEqual([1, 0, 0, 1])
  })
  it('生成提示词默认由定位、概念与配色组成，关闭注入后为空，显式描述优先', () => {
    expect(styleKitPromptHint(kit)).toContain(kit.profile.summary)
    expect(styleKitPromptHint(kit)).toContain(styleColorHex(kit.tokens.palette.accent))
    expect(styleKitPromptHint({ ...kit, generation: { inject: false, prompt: '' } })).toBe('')
    expect(styleKitPromptHint({ ...kit, generation: { inject: true, prompt: '胶片质感' } })).toBe('胶片质感')
  })
})
