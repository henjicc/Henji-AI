import { testFilesSource } from './codeMaterial/sourceTestFixtures'
import { describe, expect, it } from 'vitest'
import { DEFAULT_STYLE_TOKENS, styleKitSchema, styleTokensSchema, styleKitRenderKey, resolveVideoEditStyleKit, recommendedStyleKitText, resolveStyleTypeScale } from './styleKit'
import { BUILTIN_STYLE_KITS, availableStyleKitFonts } from './styleKitPresets'
import { compileCodeMaterial } from './codeMaterial/compiler'
import { evaluateCodeMaterial } from './codeMaterial/evaluate'
import { layoutCodeText } from './codeMaterial/textLayout'
import { bindCodeMaterialStyle, readCodeStyleToken } from './codeMaterial/style'
import { videoEditDocumentSchema, videoEditComposition } from './document'
import { createVideoEditTestDocument } from './testFixtures'
import type { CodeTextMeasurer } from './codeMaterial/contract'
import { collectVideoEditFonts } from './fonts'
import { nestVideoEditClips } from './nestedSequences'
import { makeVideoEditItemClip } from './projectItems'

const measureText: CodeTextMeasurer = request => layoutCodeText(request, (text, font) => text.length * Number(font.match(/([\d.]+)px/)![1]) * .6)
const context = { time: 1.5, localTime: 1.5, sequenceTime: 1.5, width: 1920, height: 1080, frame: 45, fps: 30 }
describe('风格包契约与真实作者语言', () => {
  it('新建嵌套子序列保留当前风格，工程快照仍被正式嵌套合成消费', () => {
    const document = createVideoEditTestDocument('嵌套风格'); const sequence = document.sequences[0]; const kit = structuredClone(BUILTIN_STYLE_KITS[0])
    document.styleKits = [kit]; sequence.styleKitId = kit.id
    document.media = [{ id: 'media', name: '参考', kind: 'image', path: '/reference.png', width: 100, height: 100, durationSeconds: 5 }]
    document.items = [{ id: 'item', name: '参考', kind: 'image', mediaId: 'media' }]
    sequence.clips = [makeVideoEditItemClip(document, 'item', sequence.id, { frame: 0 })]
    const nested = nestVideoEditClips(document, sequence.id, [sequence.clips[0].id], '子序列')
    expect(nested.sequence.styleKitId).toBe(kit.id)
    expect(resolveVideoEditStyleKit(nested.document, nested.sequence)?.tokens).toEqual(kit.tokens)
    expect(videoEditComposition(nested.document, nested.sequence.id).styleKits).toEqual([kit])
  })
  it('所有组都有默认、字号从基准派生、RGBA 与回弹严格验证，网格没有人为数量上限', () => {
    expect(styleTokensSchema.parse({})).toEqual(DEFAULT_STYLE_TOKENS)
    expect(resolveStyleTypeScale(styleTokensSchema.parse({ typeScale: { baseSize: .02, ratio: 1.5 } })).typeScale.xl).toBeCloseTo(.045)
    expect(() => styleTokensSchema.parse({ palette: { bg: [255, 0, 0, 1] } })).toThrow()
    expect(() => styleTokensSchema.parse({ motion: { enterEase: 'backOut' } })).toThrow()
    expect(styleTokensSchema.parse({ layout: { grid: 2000 } }).layout.grid).toBe(2000)
    expect(() => styleKitSchema.parse({ ...BUILTIN_STYLE_KITS[0], samples: [BUILTIN_STYLE_KITS[0].samples[0], BUILTIN_STYLE_KITS[0].samples[0]] })).toThrow()
  })
  it('六档十八个样例编译并确定求值，在横竖画幅保持令牌颜色和字体', () => {
    expect(BUILTIN_STYLE_KITS).toHaveLength(6)
    for (const kit of BUILTIN_STYLE_KITS) for (const sample of kit.samples) {
      const program = compileCodeMaterial(sample.source)
      for (const size of [{ width: 1920, height: 1080 }, { width: 1080, height: 1920 }]) {
        const frame = { ...context, ...size, style: kit.tokens }
        const commands = evaluateCodeMaterial(program, frame, {}, { measureText })
        expect(commands.length).toBeGreaterThan(0)
        expect(evaluateCodeMaterial(program, frame, {}, { measureText })).toEqual(commands)
        expect(JSON.stringify(commands)).toContain(kit.tokens.fonts.body.family)
        expect(commands[0]).toMatchObject({ children: [expect.objectContaining({ fill: kit.tokens.palette.surface }), expect.anything(), expect.anything(), expect.anything()] })
      }
    }
  })
  it('ctx.style别名和缓动真实注入，默认缺省有效，属性写入与原型越界被拒绝', () => {
    const source = BUILTIN_STYLE_KITS[0].samples[0].source
    const program = compileCodeMaterial(source)
    const tokens = structuredClone(DEFAULT_STYLE_TOKENS); tokens.palette.surface = [.2, .3, .4, .5]
    const commands = evaluateCodeMaterial(program, { ...context, style: tokens }, {}, { measureText })
    expect(commands[0]).toMatchObject({ children: [expect.objectContaining({ fill: tokens.palette.surface }), expect.anything(), expect.anything(), expect.anything()] })
    expect(evaluateCodeMaterial(program, context, {}, { measureText }).length).toBeGreaterThan(0)
    for (const body of ['ctx.style.palette.bg=[1,0,0,1];return [];', 'return [ctx.style.constructor];', 'return [ctx.style.palette.unknown];']) expect(() => compileCodeMaterial(testFilesSource(source).replace(/render\(ctx\) \{[\s\S]*$/, `render(ctx) { ${body} } }`))).toThrow()
    expect(() => readCodeStyleToken(tokens, ['__proto__'])).toThrow()
    expect(() => evaluateCodeMaterial(program, { ...context, style: { ...tokens, palette: { ...tokens.palette, surface: [2, 0, 0, 1] } } }, {}, { measureText })).toThrow()
  })
  it('滤镜可信IR绑定随令牌改变，固定令牌复用且不复制无风格程序', () => {
    const program = compileCodeMaterial('export default {apiVersion:1,languageVersion:3,name:"风格滤镜",kind:"filter",mode:"static",width:1920,height:1080,durationSeconds:5,seed:1,parameters:{},render(ctx){return mix(sample(ctx.u,ctx.v),ctx.style.palette.accent,.5);}}')
    const tokens = structuredClone(DEFAULT_STYLE_TOKENS)
    const first = bindCodeMaterialStyle(program, tokens)
    expect(bindCodeMaterialStyle(program, tokens)).toBe(first)
    tokens.palette.accent = [.1, .2, .3, 1]
    expect(bindCodeMaterialStyle(program, tokens)).not.toBe(first)
    expect(JSON.stringify(first)).not.toContain('"kind":"style"')
    expect(bindCodeMaterialStyle(first)).toBe(first)
  })
  it('序列与片段覆盖、工程快照序列化和渲染键保留完整契约', () => {
    const a = structuredClone(BUILTIN_STYLE_KITS[0]); const b = structuredClone(BUILTIN_STYLE_KITS[1]); const document = createVideoEditTestDocument('风格快照')
    document.styleKits = [a, b]; document.sequences[0].styleKitId = a.id
    expect(resolveVideoEditStyleKit(document, document.sequences[0])).toBe(a)
    expect(resolveVideoEditStyleKit(document, document.sequences[0], { styleKitId: b.id })).toBe(b)
    expect(videoEditComposition(videoEditDocumentSchema.parse(JSON.parse(JSON.stringify(document))), document.sequences[0].id).styleKits).toEqual([a, b])
    expect(new Set(collectVideoEditFonts(document).map(use => use.font))).toEqual(new Set(Object.values(a.tokens.fonts).map(font => font.family)))
    expect(() => videoEditDocumentSchema.parse({ ...document, styleKits: [b] })).toThrow()
    expect(() => videoEditDocumentSchema.parse({ ...document, styleKits: [a, b, { ...a, id: document.sequences[0].id }] })).toThrow()
    expect(styleKitRenderKey(a)).not.toBe(styleKitRenderKey({ ...a, revision: a.revision + 1 }))
    expect(styleKitRenderKey(a)).not.toBe(styleKitRenderKey({ ...a, tokens: b.tokens }))
    expect(recommendedStyleKitText(a, 1080).fill).toEqual({ enabled: true, color: expect.any(String) })
    expect(availableStyleKitFonts(a, []).tokens.fonts.body.family).toBe('sans-serif')
  })
})
