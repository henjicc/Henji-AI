import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

import { audioEditDocumentKind } from '../documents/kinds/audioEdit'
import { parseDocumentText } from '../documents/envelope'
import { PERSISTENCE_FORMATS } from '../persistence/formats'
import { upgradePersistenceContent } from '../persistence/migrations'
import { audioEditProjectFromDocument, audioEditProjectToDocumentContent, createAudioEditDocumentContent } from './documentContent'
import type { AudioEditSourceMetadata } from './types'

/*
 * 口播文档（3.3）：内容与工具内存形态互转、外壳字段不进内容、未知字段保留、空内容与列表摘要。
 */

const source: AudioEditSourceMetadata = { mediaType: 'video', sourcePath: 'D:/外部/采访.mp4', audioPath: 'D:/外部/采访.mp4', sampleRate: 48000, channels: 2, durationFrames: 48000 * 95 }
const shell = { id: 'doc-1', name: '采访', createdAt: 10, updatedAt: 20, revision: 3 }

describe('口播文档内容', () => {
  it('导入即建的内容：外壳字段来自文档元信息，往返后内容不含外壳字段', () => {
    const content = createAudioEditDocumentContent(source)
    const { project, extras } = audioEditProjectFromDocument(shell, content)
    expect(project).toMatchObject({ ...shell, source, transcript: [], cuts: [], referenceScript: '' })
    expect(extras).toEqual({})
    const back = audioEditProjectToDocumentContent(project) as Record<string, unknown>
    for (const key of ['id', 'name', 'createdAt', 'updatedAt', 'revision']) expect(back).not.toHaveProperty(key)
    expect(back.source).toEqual(source)
  })

  it('保留不认识的顶层字段；内容里残留的外壳字段以文档元信息为准', () => {
    const content = { ...createAudioEditDocumentContent(source), name: '旧名', futureField: [1, 2] }
    const { project, extras } = audioEditProjectFromDocument(shell, content)
    expect(project.name).toBe('采访')
    expect(extras).toEqual({ futureField: [1, 2] })
    expect(audioEditProjectToDocumentContent(project, extras)).toMatchObject({ futureField: [1, 2] })
  })

  it('没有素材时报素材缺失；字段不合法时报错', () => {
    expect(() => audioEditProjectFromDocument(shell, audioEditDocumentKind.createEmptyContent())).toThrow(expect.objectContaining({ name: 'AudioEditSourceMissingError' }))
    expect(() => audioEditProjectFromDocument(shell, { ...createAudioEditDocumentContent(source), transcript: [{ id: 'w', text: '超出', startFrame: 0, endFrame: source.durationFrames + 1, included: true, locked: false, granularity: 'word' }] })).toThrow()
  })

  it('空内容：没有素材，或只导入没做任何编辑；有识别、剪辑区间、参考稿或声音处理就不是空的', () => {
    const empty = (value: unknown) => audioEditDocumentKind.isEmptyContent(audioEditDocumentKind.contentSchema.parse(value))
    const imported = createAudioEditDocumentContent(source)
    expect(empty(audioEditDocumentKind.createEmptyContent())).toBe(true)
    expect(empty(imported)).toBe(true)
    expect(empty({ ...imported, referenceScript: '稿子' })).toBe(false)
    expect(empty({ ...imported, cuts: [{ id: 'c', startFrame: 0, endFrame: 10, reason: 'manual', enabled: true }] })).toBe(false)
    expect(empty({ ...imported, transcript: [{ id: 'w', text: '你好', startFrame: 0, endFrame: 10, included: true, locked: false, granularity: 'word' }] })).toBe(false)
    expect(empty({ ...imported, effectChain: [{ id: 'fx', kind: 'mouth_declick', enabled: true, sensitivity: 50, analyzed: false, clicks: [] }] })).toBe(false)
    expect(empty({ ...imported, output: { volumeDb: -2 } })).toBe(false)
  })

  it('列表摘要：素材类型与时长（秒），没有素材时为空', () => {
    expect(audioEditDocumentKind.summarize(audioEditDocumentKind.contentSchema.parse(createAudioEditDocumentContent(source)))).toEqual({ mediaType: 'video', durationSeconds: 95 })
    expect(audioEditDocumentKind.summarize(audioEditDocumentKind.createEmptyContent())).toEqual({ mediaType: null, durationSeconds: null })
  })
})

describe('素材指纹（格式 8）与旧作品', () => {
  const read = (version: number) => parseDocumentText(fs.readFileSync(`tests/fixtures/persistence/document.audio_edit/v${version}.json`, 'utf8'))
  const format = PERSISTENCE_FORMATS.find(value => value.id === 'document.audio_edit')!
  it('各旧版本样本升到 8 与升到 7 的内容逐字段相同，按工具结构打开后素材与时间线不变', () => {
    for (let version = 1; version <= 7; version++) {
      const envelope = read(version)
      const original = structuredClone(envelope.content)
      const atSeven = upgradePersistenceContent({ ...format, version: 7 }, envelope.content, version)
      const atEight = upgradePersistenceContent(format, envelope.content, version)
      expect(envelope.content).toEqual(original)
      expect(atEight).toEqual(atSeven)
      const opened = audioEditProjectFromDocument(shell, atEight).project
      expect(opened).toEqual(audioEditProjectFromDocument(shell, atSeven).project)
      expect(opened.source).toEqual((original as { source: unknown }).source)
      expect(opened.source.fingerprint).toBeUndefined()
    }
  })
  it('source 里不认识的字段（更新版本加的可选信息）打开时保留、保存时原样写回，以后加可选字段不必再提最低可读版本', () => {
    const content = { ...createAudioEditDocumentContent(source), source: { ...source, futureHint: { lane: 2 } } }
    const { project } = audioEditProjectFromDocument(shell, content)
    expect((audioEditProjectToDocumentContent(project).source as Record<string, unknown>).futureHint).toEqual({ lane: 2 })
  })
  it('格式 8 的样本读回采样指纹；只认识格式 7 的程序按“请升级”拒绝，不当成损坏', () => {
    const envelope = read(8)
    expect(envelope.kindMinReaderVersion).toBe(8)
    const { project } = audioEditProjectFromDocument(shell, upgradePersistenceContent(format, envelope.content, 8))
    expect(project.source.fingerprint).toEqual({ size: expect.any(Number), mtimeMs: expect.any(Number), digest: expect.stringMatching(/^[a-f0-9]{64}$/) })
    expect(() => upgradePersistenceContent({ ...format, version: 7 }, envelope.content, 8, undefined, envelope.kindMinReaderVersion)).toThrowError(expect.objectContaining({ code: 'newer-version' }))
  })

  it('版本 9 的样本按严格结构打开，交接材料原样写回', () => {
    const sample = JSON.parse(fs.readFileSync('tests/fixtures/persistence/document.audio_edit/v9.json', 'utf8')) as { id: string; name: string; content: Record<string, unknown> }
    const { project, extras } = audioEditProjectFromDocument({ id: sample.id, name: sample.name, createdAt: 0, updatedAt: 0, revision: 0 }, sample.content)
    expect(project.suggestionHandoff).toEqual(sample.content.suggestionHandoff)
    expect(extras).toEqual({})
    const written = audioEditProjectToDocumentContent(project, extras) as Record<string, unknown>
    expect(written.suggestions).toEqual(sample.content.suggestions)
    expect(written.suggestionHandoff).toEqual(sample.content.suggestionHandoff)
  })
})
