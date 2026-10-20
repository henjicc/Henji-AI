
import { describe, expect, it } from 'vitest'
import { STYLE_GUIDE_SECTIONS, composeStyleGuide, parseStyleGuide, resolveVideoEditStyleKit, styleGuideProblems, styleGuideTemplate, styleKitSchema } from './styleKit'
import { BUILTIN_STYLE_KITS } from './styleKitPresets'


import { videoEditComposition } from './document'
import { createVideoEditTestDocument } from './testFixtures'
import { nestVideoEditClips } from './nestedSequences'
import { makeVideoEditItemClip } from './projectItems'

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

it('内置只保留无代码示例的风格占位', () => { expect(BUILTIN_STYLE_KITS).toHaveLength(1); expect(BUILTIN_STYLE_KITS[0].examples).toEqual([]); expect(styleGuideProblems(BUILTIN_STYLE_KITS[0].guide)).toEqual([]) })
