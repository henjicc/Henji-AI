import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseDocumentText } from '../../documents/envelope'
import { VIDEO_EDIT_DOCUMENT_VERSION } from '../../persistence/schemaVersions'
import { CodeMaterialError } from '../codeMaterial/contract'
import { videoEditDocumentSchema } from '../document'
import { parseCodeSceneSchema, validateCodeSceneRecords } from './sceneDeclaration'
import { videoEditSceneReferenceIssues } from './sceneSchema'
import { GOLDEN_SCENE_DECLARATION, goldenScene } from './sceneTestFixtures'

type Content = { scenes: Array<{ records: Array<{ parent?: string }> }>; sequences: Array<{ clips: Array<{ id: string; code?: { parameters: Record<string, unknown> } }> }> }
const golden = (): Content => parseDocumentText(fs.readFileSync('tests/fixtures/persistence/document.video_edit/v42.json', 'utf8')).content as Content
const parseDocument = (content: Content) => videoEditDocumentSchema.safeParse({ format: 'henji-video-project', version: VIDEO_EDIT_DOCUMENT_VERSION, id: 'golden', name: '黄金样本', revision: 0, ...content })

describe('片子数据', () => {
  it('按代码声明逐条校验：黄金片子数据合法，未声明字段、缺必填、素材不存在、引用错类型都被指出', () => {
    const schema = parseCodeSceneSchema(GOLDEN_SCENE_DECLARATION)
    expect(schema.kinds.shot.fields.rate).toMatchObject({ optional: true, default: 1 })
    const media = new Map([['screen', 'video' as const]])
    expect(validateCodeSceneRecords(schema, goldenScene('screen'), { media })).toEqual([])
    const broken = goldenScene('screen')
    broken.records[0].values.extra = 1
    delete broken.records[2].values.src
    broken.records[3].values.media = 'missing'
    broken.records[5].values.win = 'fo-1'
    expect(validateCodeSceneRecords(schema, broken, { media }).map(issue => [issue.recordId, issue.path])).toEqual([['seg-switch', 'values.extra'], ['sh-1', 'values.src'], ['sh-2', 'values.media'], ['fk-1', 'values.win']])
  })

  it('声明从严：未知键、源时间写在没有所属素材的记录类型上、所属素材引用到没有素材的记录类型，都直接拒绝', () => {
    expect(() => parseCodeSceneSchema({ ...GOLDEN_SCENE_DECLARATION, extra: true })).toThrow(CodeMaterialError)
    expect(() => parseCodeSceneSchema({ ...GOLDEN_SCENE_DECLARATION, kinds: { cut: { fields: { from: { type: 'sourceTime' } } } } })).toThrow(CodeMaterialError)
    const { footage: _footage, ...window } = GOLDEN_SCENE_DECLARATION.kinds.window
    expect(() => parseCodeSceneSchema({ ...GOLDEN_SCENE_DECLARATION, kinds: { ...GOLDEN_SCENE_DECLARATION.kinds, window } })).toThrow('focusKey.footage')
  })

  it('role 的前提不满足就拒绝：段落与剪切要有起止，剪切的 enabled 是布尔，窗口内容要 untilNext、footage、唯一的源时间与约定字段类型', () => {
    const kinds = GOLDEN_SCENE_DECLARATION.kinds
    const broken = (name: keyof typeof kinds, patch: Record<string, unknown>) => () => parseCodeSceneSchema({ ...GOLDEN_SCENE_DECLARATION, kinds: { ...kinds, [name]: { ...kinds[name], ...patch } } })
    expect(parseCodeSceneSchema(GOLDEN_SCENE_DECLARATION).kinds.shot.role).toBe('shot')
    expect(broken('segment', { end: undefined, influence: undefined })).toThrow('segment.role')
    expect(broken('cut', { fields: { ...kinds.cut.fields, enabled: { type: 'number', min: 0, max: 1, default: 1 } } })).toThrow('cut.role')
    expect(broken('shot', { influence: undefined })).toThrow('shot.role')
    expect(broken('shot', { fields: { ...kinds.shot.fields, from: { type: 'sourceTime' } } })).toThrow('shot.role')
    expect(broken('shot', { fields: { ...kinds.shot.fields, rate: { type: 'text', maxLength: 8, default: '1' } } })).toThrow('shot.role')
    expect(broken('focus', { role: 'window' })).toThrow('focus.role')
  })

  it('剪辑文档：父记录悬空、代码参数引用不存在的片子数据都被拒', () => {
    expect(parseDocument(golden()).success).toBe(true)
    const dangling = golden()
    dangling.scenes[0].records[2].parent = 'missing'
    expect(parseDocument(dangling).success).toBe(false)
    const missing = golden()
    missing.sequences[0].clips.find(clip => clip.id === 'golden-clip')!.code!.parameters.film = { kind: 'scene', sceneId: 'missing' }
    expect(parseDocument(missing).success).toBe(false)
  })

  it('同一份片子数据可被多个片段、多条序列引用（各按自己的素材时间解释），只核对引用存在', () => {
    const film = { kind: 'scene', sceneId: 'golden-scene' }
    const clip = { code: { parameters: { film } } }
    const document = (sequences: Array<{ id: string; clips: unknown[] }>) => ({ scenes: [goldenScene('screen')], items: [], sequences }) as unknown as Parameters<typeof videoEditSceneReferenceIssues>[0]
    expect(videoEditSceneReferenceIssues(document([{ id: 'main', clips: [clip, clip] }, { id: 'other', clips: [{ code: { parameters: {} }, effects: [{ code: { parameters: { film } } }] }] }]))).toEqual([])
    expect(videoEditSceneReferenceIssues(document([{ id: 'main', clips: [{ effects: [{ code: { parameters: { film: { kind: 'scene', sceneId: 'missing' } } } }] }] }]))).toEqual(['代码参数引用的片子数据不存在：missing'])
  })
})
