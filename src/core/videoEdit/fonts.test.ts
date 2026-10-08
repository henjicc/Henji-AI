import { expect, it, vi } from 'vitest'
import { createVideoEditDocument, createVideoEditSequence, videoEditComposition, type VideoEditClip } from './document'
import { BUILTIN_TITLE_TEMPLATES, instantiateTitleTemplate, titleTemplateOverridesSchema } from './titleTemplates'
import { defaultVideoEditTextStyle, layoutVideoEditText } from './text'
import { videoEditSubtitleStyleSchema } from './subtitleStyle'
import { collectVideoEditFonts, missingVideoEditFonts } from './fonts'
import { GENERIC_FONT_FACES } from '../fonts/catalog'
import { compileCodeMaterial } from './codeMaterial/compiler'

it('任意字体名贯通文字、图形标题、字幕和嵌套序列；缺字体说明引用片段和回退', () => {
  const document = createVideoEditDocument('字体工程'); const sequence = createVideoEditSequence()
  const title = instantiateTitleTemplate(BUILTIN_TITLE_TEMPLATES[0], { textStyle: { ...defaultVideoEditTextStyle(1080), fontFamily: '思源黑体 Bold' } }, sequence)[0]
  sequence.clips = [{ ...title, id: 'title', itemId: 'title-item', start: 0, track: 1, name: '开场标题' } as VideoEditClip,
    { ...title, graphic: undefined, id: 'text', itemId: 'text-item', kind: 'text', start: 0, track: 1, name: '正文', text: '字体', textStyle: { ...defaultVideoEditTextStyle(1080), fontFamily: '微软雅黑' } } as VideoEditClip]
  sequence.captions = [{ id: 'cue', text: '字幕示例', start: 0, duration: 30, style: videoEditSubtitleStyleSchema.parse({ fontFamily: 'Imported Serif' }) }]
  document.sequences = [sequence]
  const uses = collectVideoEditFonts(document)
  expect(uses.map(use => use.font)).toEqual(expect.arrayContaining(['思源黑体 Bold', '微软雅黑', 'Imported Serif']))
  expect(collectVideoEditFonts(videoEditComposition(document, sequence.id))).toEqual(uses)
  const missing = missingVideoEditFonts(uses, [{ ...GENERIC_FONT_FACES[0], id: 'yahei', family: 'Microsoft YaHei', localizedFamily: '微软雅黑', aliases: [] }])
  expect(missing.map(value => value.font)).toEqual(['思源黑体 Bold', 'Imported Serif'])
  expect(missing[0]).toMatchObject({ fallback: '系统无衬线字体', uses: expect.arrayContaining([expect.objectContaining({ label: expect.stringContaining('开场标题') })]) })
  expect(titleTemplateOverridesSchema.parse({ textStyle: { ...defaultVideoEditTextStyle(1080), fontFamily: 'Imported Serif' } }).textStyle?.fontFamily).toBe('Imported Serif')
})
it('文字布局生成的 Canvas font 不允许字体名注入额外族', () => {
  const measure = vi.fn((_text: string, _font: string) => 20)
  layoutVideoEditText({ text: '标题', textStyle: { ...defaultVideoEditTextStyle(1080), fontFamily: 'Quoted" Font' } }, { width: 1920, height: 1080 }, measure)
  expect(measure.mock.calls[0][1]).toContain('"Quoted\\" Font", sans-serif')
})
it('内置风格只是推荐字体并自动回退，不算缺字体；用户自建风格缺字体照常提示', () => {
  const uses = [{ font: 'Source Han Sans SC', ownerId: 'style:builtin:style:0:display', label: '风格：克制高级' }, { font: 'Source Han Sans SC', ownerId: 'style:mine:display', label: '风格：我的' }]
  expect(missingVideoEditFonts(uses, []).flatMap(item => item.uses.map(use => use.ownerId))).toEqual(['style:mine:display'])
})
it('v3字体参数及自定义组件字体字段的默认、实例和关键帧进入同一缺失检测', () => {
  const program = compileCodeMaterial('export default {apiVersion:1,languageVersion:3,name:"字体组件",kind:"generator",mode:"dynamic",width:64,height:64,durationSeconds:10,seed:1,types:{label:{title:"标签",layout:"row",fields:{face:{type:"font",title:"字体",default:"Missing Default"},power:{type:"number",title:"强度",min:0,max:1,step:.1,default:1}}}},parameters:{face:{type:"font",title:"字体",default:"Missing Font"},label:{type:"label",title:"标签",default:{},animatable:true}},render(ctx){return [];}}')
  const document = createVideoEditDocument('代码字体')
  document.items.push({ id: 'item', kind: 'code', name: '代码字体', code: { definitionId: 'd', versionId: 'v', parameters: {}, curves: { label: [{ id: 'key', sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, value: { face: 'Missing Keyframe', power: .5 }, interpolation: 'hold' }] } } })
  const uses = collectVideoEditFonts(document, () => program)
  expect(uses.map(use => use.font)).toEqual(['Missing Font', 'Missing Default', 'Missing Keyframe'])
  expect(missingVideoEditFonts(uses, []).map(use => use.font)).toEqual(['Missing Font', 'Missing Default', 'Missing Keyframe'])
})
