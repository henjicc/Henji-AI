import { describe, expect, it } from 'vitest'

import { audioEditDocumentKind } from '../documents/kinds/audioEdit'
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
    expect(empty({ ...imported, processorChain: [{ id: 'rx', enabled: true, parameters: {} }] })).toBe(false)
  })

  it('列表摘要：素材类型与时长（秒），没有素材时为空', () => {
    expect(audioEditDocumentKind.summarize(audioEditDocumentKind.contentSchema.parse(createAudioEditDocumentContent(source)))).toEqual({ mediaType: 'video', durationSeconds: 95 })
    expect(audioEditDocumentKind.summarize(audioEditDocumentKind.createEmptyContent())).toEqual({ mediaType: null, durationSeconds: null })
  })
})
