import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PERSISTENCE_FORMATS } from './formats'
import { upgradePersistenceContent } from './migrations'
import { parseDocumentEnvelope } from '../documents/envelope'
import { readLocalPersistenceJson, serializeVersionedPersistenceJson } from './versionedJson'
import { decodePersistenceResource } from './resourceContracts'
import type { RecordingDocument } from '../screenRecording/document'
import { z } from 'zod'

function fixture(id: string, version: number): string {
  return fs.readFileSync(`tests/fixtures/persistence/${id}/v${version}.json`, 'utf8')
}

describe('同源 dev-break 的无损恢复', () => {
  it.each([1, 2])('标题模板 v%s 历史迁移保留内容，当前版本明确拒绝且不写原文件', version => {
    const text = fixture('title-templates', version)
    const raw = JSON.parse(text) as { content: unknown }
    const key = 'video-edit-title-templates'
    const values = new Map([[key, text]])
    const storage = { getItem: (name: string) => values.get(name) ?? null, setItem: (name: string, value: string) => { values.set(name, value) } }
    const current = PERSISTENCE_FORMATS.find(format => format.id === 'title-templates')!
    expect(() => readLocalPersistenceJson(text, key, current, storage)).toThrowError(expect.objectContaining({ code: 'unsupported-version' }))
    expect([...values]).toEqual([[key, text]])
    // Preserve evidence for the historical migration without promising support in the current format.
    const contract = { ...current, version: 4 }
    const upgraded = readLocalPersistenceJson(text, key, contract, storage)
    expect(upgraded).toEqual(raw.content)
    expect(storage.getItem(key)).toBe(text)
    expect(storage.getItem(`${key}:backup:v${version}`)).toBe(text)
    storage.setItem(key, serializeVersionedPersistenceJson(contract, upgraded))
    expect(readLocalPersistenceJson(storage.getItem(key)!, key, contract, storage)).toEqual(upgraded)
  })

  it.each([1, 2])('字幕回填 v%s 的历史1→6迁移保留声音身份与原文字段，当前版本明确拒绝', version => {
    const raw = JSON.parse(fixture('subtitle-manifest', version)) as { captions: unknown; soundIdentities: unknown; soundClips: unknown }
    const before = structuredClone(raw)
    const current = PERSISTENCE_FORMATS.find(format => format.id === 'subtitle-manifest')!
    expect(() => upgradePersistenceContent(current, raw, version)).toThrowError(expect.objectContaining({ code: 'unsupported-version' }))
    // Pure historical migration evidence does not promise current-format compatibility.
    const contract = { ...current, version: 6, schema: z.unknown() }
    const upgraded = upgradePersistenceContent(contract, raw, version) as typeof raw
    expect(upgraded.captions).toEqual(raw.captions)
    expect(upgraded.soundIdentities).toEqual(raw.soundIdentities)
    expect(upgraded.soundClips).toEqual(raw.soundClips)
    expect(upgradePersistenceContent(contract, JSON.parse(JSON.stringify(upgraded)), contract.version)).toEqual(upgraded)
    expect(raw).toEqual(before)
  })

  it('事件页 v1 经正式解码保留全部事件、时间映射、边界与序号', () => {
    const raw = JSON.parse(fixture('capture-log-page', 1)) as Record<string, unknown>
    const before = structuredClone(raw)
    const upgraded = decodePersistenceResource('capture-log-page', raw)
    expect(upgraded).toEqual({ ...raw, version: 2 })
    expect(decodePersistenceResource('capture-log-page', JSON.parse(JSON.stringify(upgraded)))).toEqual(upgraded)
    expect(raw).toEqual(before)
  })

  it.each([2, 3, 4])('录制文档 v%s 的历史2→12迁移保留媒体与理解结果，当前版本明确拒绝', version => {
    const raw = parseDocumentEnvelope(JSON.parse(fixture('document.screen_recording', version)))
    const original = structuredClone(raw)
    const current = PERSISTENCE_FORMATS.find(format => format.id === 'document.screen_recording')!
    expect(() => upgradePersistenceContent(current, raw.content, version)).toThrowError(expect.objectContaining({ code: 'unsupported-version' }))
    const contract = { ...current, version: 12, schema: z.unknown() }
    const upgraded = upgradePersistenceContent(contract, raw.content, version) as RecordingDocument
    const old = raw.content as RecordingDocument
    expect(upgraded.media).toEqual(old.media)
    expect(upgraded.eventPages).toEqual(old.eventPages)
    expect(upgraded.markers).toEqual(old.markers)
    expect(upgraded.understanding).toMatchObject(old.understanding)
    if (version === 2) expect(upgraded.understanding.privacy).toEqual({ candidates: [], warnings: [] })
    if (version < 4) {
      expect(upgraded.scriptCapture).toEqual({ baselines: [], calls: [] })
      expect(upgraded.understanding.operationScript).toEqual({ steps: [] })
    } else expect(upgraded.scriptCapture).toEqual(old.scriptCapture)
    expect(upgraded.directorRun).toBeUndefined()
    const saved = JSON.parse(JSON.stringify({ ...raw, kindVersion: contract.version, content: upgraded }))
    expect(parseDocumentEnvelope(saved).content).toEqual(upgraded)
    expect(upgradePersistenceContent(contract, saved.content, saved.kindVersion)).toEqual(upgraded)
    expect(raw).toEqual(original)
  })
})
