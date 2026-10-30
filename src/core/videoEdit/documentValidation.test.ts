import fs from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { parseDocumentText } from '../documents/envelope'
import { VIDEO_EDIT_DOCUMENT_VERSION } from '../persistence/schemaVersions'
import { videoEditDocumentSchema, type VideoEditClip, type VideoEditDocument, type VideoEditSequence } from './document'
import { freezeVideoEditDocument, parseVideoEditDocument } from './documentValidation'

const content = parseDocumentText(fs.readFileSync('tests/fixtures/persistence/document.video_edit/v42.json', 'utf8')).content as object
const base = parseVideoEditDocument({ format: 'henji-video-project', version: VIDEO_EDIT_DOCUMENT_VERSION, id: 'golden', name: '黄金样本', revision: 0, ...content })
const scene = base.scenes![0]
const definition = base.codeMaterials![0]
const editSequence = (edit: (sequence: VideoEditSequence) => VideoEditSequence): VideoEditDocument => ({ ...base, sequences: base.sequences.map(edit) })
const editClip = (id: string, edit: (clip: VideoEditClip) => VideoEditClip): VideoEditDocument => editSequence(sequence => ({ ...sequence, clips: sequence.clips.map(clip => clip.id === id ? edit(clip) : clip) }))

function outcome(run: () => VideoEditDocument): { value?: VideoEditDocument; error?: unknown } {
  try { return { value: run() } } catch (error) { return { error } }
}
/** next 里原样沿用 base 的节点（已冻结），结果里必须还是同一个对象。 */
function expectShared(result: unknown, next: unknown): void {
  if (typeof next !== 'object' || next === null) return
  if (Object.isFrozen(next)) { expect(result).toBe(next); return }
  for (const key of Object.keys(next)) expectShared((result as Record<string, unknown>)[key], (next as Record<string, unknown>)[key])
}

const cases: Array<[string, VideoEditDocument, boolean]> = [
  ['删除片段', editSequence(sequence => ({ ...sequence, clips: sequence.clips.filter(clip => clip.id !== 'golden-native-instance') })), true],
  ['移动片段', editClip('golden-sound-clip', clip => ({ ...clip, start: clip.start + 5 })), true],
  ['调换片段顺序', editSequence(sequence => ({ ...sequence, clips: [...sequence.clips].reverse() })), true],
  ['改片段属性', editClip('golden-frame-hold', clip => ({ ...clip, opacity: 0.5, enabled: false })), true],
  ['改片子数据', { ...base, scenes: [{ ...scene, records: [...scene.records.map(record => record.id === 'seg-switch' ? { ...record, values: { ...record.values, end: 3 } } : record), { id: 'seg-new', kind: 'segment', values: { name: '新段', start: 3, end: 4 } }] }] }, true],
  // 新增的元素在原文档里没有对应元素，整个解析，所以用全新的对象
  ['新增代码版本', { ...base, codeMaterials: [{ ...definition, versions: [...definition.versions, { ...structuredClone(definition.versions[0]), id: 'code-version-2' }] }] }, true],
  ['改顶层字段（名称会被修剪）', { ...base, name: '  黄金样本  ', posterFrame: { sequenceId: base.sequences[0].id, frame: 12 } }, true],
  ['非法：片段放到不同类型的轨道', editClip('golden-sound-clip', clip => ({ ...clip, track: 1 })), false],
  ['非法：片段多出未知字段', editClip('golden-frame-hold', clip => ({ ...clip, unknownField: 1 }) as VideoEditClip), false],
  ['非法：删除仍被代码参数引用的片子数据', { ...base, scenes: [] }, false],
  ['非法：片子数据记录标识重复', { ...base, scenes: [{ ...scene, records: [...scene.records, scene.records[0]] }] }, false],
  ['非法：默认代码版本不存在', { ...base, codeMaterials: [{ ...definition, defaultVersionId: 'missing-version' }] }, false],
]

describe('剪辑文档增量校验', () => {
  it('外部冻结的草稿不是已校验基线，仍规范化名称并复用已校验子树', () => {
    const published = freezeVideoEditDocument({ ...base, scenes: [{ ...scene, name: '  未修剪  ' }] })
    const next = { ...published, posterFrame: { sequenceId: base.sequences[0].id, frame: 3 } }
    const parsed = parseVideoEditDocument(next, published)
    expect(parsed).toEqual(videoEditDocumentSchema.parse(next))
    expect(parsed.scenes![0].name).toBe('未修剪')
    expect(parsed.scenes![0].records).toBe(scene.records)
    expect(parsed.sequences).toBe(base.sequences)
    expect(parseVideoEditDocument(parsed, parsed)).toBe(parsed)
  })

  it('外部浅冻结的根节点也会冻结全部子树，但不会授予校验信任', () => {
    const next = Object.freeze({ ...base, scenes: [{ ...scene, name: '  未修剪  ' }] })
    freezeVideoEditDocument(next)
    expect(() => { next.scenes[0].name = '误改' }).toThrow(TypeError)
    expect(parseVideoEditDocument(next, next).scenes![0].name).toBe('未修剪')
  })

  it.each(cases)('%s：结果或报错与整份校验相同，未改的子树沿用原对象', (_label, next, valid) => {
    const full = outcome(() => videoEditDocumentSchema.parse(next))
    const fast = outcome(() => parseVideoEditDocument(next, base))
    expect(full.error === undefined).toBe(valid)
    if (!valid) {
      expect(fast.value).toBeUndefined()
      expect((fast.error as Error).message).toBe((full.error as Error).message)
      return
    }
    expect(JSON.stringify(fast.value)).toBe(JSON.stringify(full.value))
    expectShared(fast.value, next)
  })

  it('没冻结的原文档可能被改过，其中的值照常校验', () => {
    const mutated = structuredClone(base)
    mutated.sequences[0].clips[0].opacity = 99
    const next = { ...mutated, name: '改过名' }
    const full = outcome(() => videoEditDocumentSchema.parse(next))
    expect(full.error).toBeDefined()
    expect((outcome(() => parseVideoEditDocument(next, mutated)).error as Error).message).toBe((full.error as Error).message)
  })

  it.each(['exportHistory', 'reviewReasons', 'tuned'] as const)('新增 %s 元素没有可信基线时仍校验 undefined', field => {
    const next = structuredClone(base)
    const values: unknown[] = field === 'exportHistory' ? next.exportHistory!
      : field === 'reviewReasons' ? next.sequences[0].captions![0].reviewReasons!
      : next.scenes![0].records.find(record => record.tuned?.length)!.tuned!
    values.push(undefined)
    const full = outcome(() => videoEditDocumentSchema.parse(next))
    expect(full.error).toBeDefined()
    expect((outcome(() => parseVideoEditDocument(next, base)).error as Error).message).toBe((full.error as Error).message)
  })

  it('未冻结基线的必填值缺失时仍按 schema 校验', () => {
    const mutated = structuredClone(base)
    const next = { ...mutated, name: undefined }
    const full = outcome(() => videoEditDocumentSchema.parse(next))
    expect(full.error).toBeDefined()
    expect((outcome(() => parseVideoEditDocument(next, mutated)).error as Error).message).toBe((full.error as Error).message)
  })

  it('结果深度冻结，改到共享子树当场报错', () => {
    const next = parseVideoEditDocument(cases[1][1], base)
    expect(Object.isFrozen(next.sequences[0].clips[0])).toBe(true)
    expect(() => { next.sequences[0].clips.push(next.sequences[0].clips[0]) }).toThrow(TypeError)
  })
})

it('非预期增量异常通知宿主后完整校验，非法输入回退不误报异常', () => {
  const fallback = vi.fn()
  let fail = true
  const value = new Proxy({ ...base, name: '有效名称' }, { get(target, key, receiver) {
    if (key === 'name' && fail) { fail = false; throw new Error('增量路径故障') }
    return Reflect.get(target, key, receiver)
  } })
  expect(parseVideoEditDocument(value, base, fallback).name).toBe('有效名称')
  expect(fallback).toHaveBeenCalledTimes(1)
  expect(fallback.mock.calls[0][0].message).toBe('增量路径故障')
  fallback.mockClear()
  expect(() => parseVideoEditDocument({ ...base, name: '' }, base, fallback)).toThrow()
  expect(fallback).not.toHaveBeenCalled()
})
