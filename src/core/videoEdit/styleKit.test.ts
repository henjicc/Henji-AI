import { testFilesSource } from './codeMaterial/sourceTestFixtures'
import { describe, expect, it } from 'vitest'
import { STYLE_GUIDE_SECTIONS, composeStyleGuide, parseStyleGuide, resolveVideoEditStyleKit, styleGuideProblems, styleGuideTemplate, styleKitBriefing, styleKitGenerationPrompt, styleKitSchema, styleKitSummary } from './styleKit'
import { BUILTIN_STYLE_KITS } from './styleKitPresets'
import { compileCodeMaterial } from './codeMaterial/compiler'
import { evaluateCodeMaterial } from './codeMaterial/evaluate'
import { layoutCodeText } from './codeMaterial/textLayout'
import { videoEditComposition } from './document'
import { createVideoEditTestDocument } from './testFixtures'
import type { CodeTextMeasurer } from './codeMaterial/contract'
import { nestVideoEditClips } from './nestedSequences'
import { makeVideoEditItemClip } from './projectItems'

const measureText: CodeTextMeasurer = request => layoutCodeText(request, (text, font) => text.length * Number(font.match(/([\d.]+)px/)![1]) * .6)
describe('风格说明书契约', () => {
  it('说明书按二级标题分节，缺必填章节被点名拒绝，强弱只写在文字里', () => {
    expect(styleGuideProblems(styleGuideTemplate())).toHaveLength(STYLE_GUIDE_SECTIONS.filter(spec => spec.required).length)
    const result = styleKitSchema.safeParse({ id: 'a', name: '半成品', guide: '## 定位\n只有定位' })
    expect(result.success).toBe(false)
    expect(result.error?.issues.map(issue => issue.message).join('')).toContain('“核心理念”还没有写')
    const sections = parseStyleGuide('前言\n## 定位\n一句话\n\n## 自定义\n补充\n')
    expect(sections).toEqual([{ title: '', body: '前言' }, { title: '定位', body: '一句话' }, { title: '自定义', body: '补充' }])
    // Canonical order keeps every required section (even empty), drops empty optional ones and keeps author sections last.
    const composed = composeStyleGuide([{ title: '自定义', body: '补充' }, { title: '定位', body: '一句话' }])
    expect(parseStyleGuide(composed).map(section => section.title)).toEqual([...STYLE_GUIDE_SECTIONS.filter(spec => spec.required).map(spec => spec.title), '自定义'])
    expect(Object.keys(styleKitSchema.parse(BUILTIN_STYLE_KITS[0]))).toEqual(expect.arrayContaining(['guide', 'examples']))
    expect(JSON.stringify(BUILTIN_STYLE_KITS[0])).not.toMatch(/"(tokens|rules|strength|palette)"/)
  })
  it('三套内置风格是完整且明显不同的说明书，摘要、生成提示与给助手的全文都来自说明书', () => {
    expect(BUILTIN_STYLE_KITS.map(kit => kit.name)).toEqual(['克制高级', '科技信息', '综艺花字'])
    for (const kit of BUILTIN_STYLE_KITS) {
      expect(styleGuideProblems(kit.guide)).toEqual([])
      expect(styleKitSummary(kit).length).toBeGreaterThan(10)
      expect(styleKitGenerationPrompt(kit)).not.toBe('')
      const briefing = styleKitBriefing(kit)
      expect(briefing).toContain(`# 风格：${kit.name}`); expect(briefing).toContain('## 必须'); expect(briefing).toContain('不要原样照搬')
      expect(styleKitBriefing(kit, { examples: false })).not.toContain('```ts')
    }
    expect(new Set(BUILTIN_STYLE_KITS.map(kit => styleKitSummary(kit))).size).toBe(3)
    expect(BUILTIN_STYLE_KITS[0].guide).toContain('不回弹'); expect(BUILTIN_STYLE_KITS[2].guide).toContain('一次回弹')
  })
  it('参考示例是自带取值的 v3 源码，不读 ctx.style，横竖画幅都能编译并确定求值', () => {
    for (const kit of BUILTIN_STYLE_KITS) for (const example of kit.examples) {
      const source = testFilesSource(example.source)
      expect(source).not.toContain('ctx.style'); expect(example.note).not.toBe('')
      const program = compileCodeMaterial(source)
      for (const size of [{ width: 1920, height: 1080 }, { width: 1080, height: 1920 }]) for (const time of [0, 1.5, program.durationSeconds]) {
        const frame = { time, localTime: time, sequenceTime: time, frame: Math.round(time * 30), fps: 30, ...size }
        const commands = evaluateCodeMaterial(program, frame, {}, { measureText })
        expect(evaluateCodeMaterial(program, frame, {}, { measureText })).toEqual(commands)
      }
    }
    expect(() => compileCodeMaterial('export default {apiVersion:1,languageVersion:3,name:"旧写法",kind:"generator",mode:"static",width:100,height:100,durationSeconds:1,seed:1,parameters:{},render(ctx){return [rect({x:0,y:0,width:1,height:1,fill:ctx.style.palette.bg})];}}')).toThrow()
  })
  it('新建嵌套子序列保留当前风格绑定，工程快照随合成文档带出', () => {
    const document = createVideoEditTestDocument('嵌套风格'); const sequence = document.sequences[0]; const kit = structuredClone(BUILTIN_STYLE_KITS[0])
    document.styleKits = [kit]; sequence.styleKitId = kit.id
    document.media = [{ id: 'media', name: '参考', kind: 'image', path: '/reference.png', width: 100, height: 100, durationSeconds: 5 }]
    document.items = [{ id: 'item', name: '参考', kind: 'image', mediaId: 'media' }]
    sequence.clips = [makeVideoEditItemClip(document, 'item', sequence.id, { frame: 0 })]
    const nested = nestVideoEditClips(document, sequence.id, [sequence.clips[0].id], '子序列')
    expect(nested.sequence.styleKitId).toBe(kit.id)
    expect(resolveVideoEditStyleKit(nested.document, nested.sequence)?.guide).toBe(kit.guide)
    expect(videoEditComposition(nested.document, nested.sequence.id).styleKits).toEqual([kit])
    expect(() => resolveVideoEditStyleKit({ styleKits: [] }, { styleKitId: 'missing' })).toThrow('绑定的风格不存在')
  })
})
