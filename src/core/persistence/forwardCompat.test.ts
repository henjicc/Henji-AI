import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { PersistenceError, persistenceForwardFields, upgradePersistenceContent, type PersistenceContract } from './migrations'
import { readForwardCompatible, restoreForwardFields } from './forwardCompat'
import { parseVersionedPersistenceJson, serializeVersionedPersistenceJson } from './versionedJson'

const clipSchema = z.object({ id: z.string(), start: z.number() }).strict()
const schema = z.object({ name: z.string(), clips: z.array(clipSchema), meta: z.object({ author: z.string() }) })
const contract: PersistenceContract = { id: 'forward-sample', name: '前向样本', version: 3, minReaderVersion: 2, schema, migrations: { 2: content => content } }
// 由“版本 4”的程序写出：新增了顶层、宽松对象与严格数组元素里的可选字段。
const newer = { name: '片子', future: { lane: 2 }, clips: [{ id: 'a', start: 0, fade: 0.5 }, { id: 'b', start: 30 }], meta: { author: '痕迹', reviewer: '新字段' } }

describe('新版本字段被旧版本读取', () => {
  it('较新版本但最低可读版本不高于本程序：正常打开，记录并在保存时放回未知字段', () => {
    const value = upgradePersistenceContent(contract, newer, 4, undefined, 3) as z.infer<typeof schema>
    expect(value).toEqual({ name: '片子', clips: [{ id: 'a', start: 0 }, { id: 'b', start: 30 }], meta: { author: '痕迹' } })
    const fields = persistenceForwardFields(value)
    expect(fields.map(field => [field.path, field.key])).toEqual(expect.arrayContaining([[[], 'future'], [['clips', { id: 'a' }], 'fade'], [['meta'], 'reviewer']]))
    // 用户在旧版本里改了已有字段、重排了片段：未知字段跟着稳定 id 回到原对象，已知字段以本次编辑为准。
    const edited = { ...value, name: '改名', clips: [{ id: 'b', start: 60 }, { id: 'a', start: 10 }] }
    expect(restoreForwardFields(edited, fields)).toEqual({ name: '改名', future: { lane: 2 }, clips: [{ id: 'b', start: 60 }, { id: 'a', start: 10, fade: 0.5 }], meta: { author: '痕迹', reviewer: '新字段' } })
    expect(newer.clips[0]).toHaveProperty('fade', 0.5)
  })
  it('较新版本且最低可读版本高于本程序，或缺少最低可读版本：提示由更新版本创建，不读取', () => {
    for (const minReader of [4, undefined]) {
      try { upgradePersistenceContent(contract, newer, 4, undefined, minReader); throw new Error('应拒绝') }
      catch (error) {
        expect(error).toBeInstanceOf(PersistenceError)
        expect(error).toMatchObject({ code: 'newer-version', fromVersion: 4, toVersion: 3 })
        expect((error as Error).message).toContain('更新版本')
        expect((error as Error).message).not.toContain('损坏')
      }
    }
  })
  it('未知字段之外的内容不合当前 schema 时仍按内容不受支持拒绝', () => {
    expect(() => upgradePersistenceContent(contract, { ...newer, clips: [{ id: 'a', start: 'x' }] }, 4, undefined, 2)).toThrow(PersistenceError)
  })
  it('当前与较旧版本不受影响：没有前向字段，旧版本仍走逐版本迁移', () => {
    const current = upgradePersistenceContent(contract, { name: 'a', clips: [], meta: { author: 'b' } }, 3, undefined, 2)
    expect(persistenceForwardFields(current)).toEqual([])
    expect(upgradePersistenceContent(contract, { name: 'a', clips: [], meta: { author: 'b' } }, 2)).toEqual(current)
  })
  it('版本化 JSON 容器写出最低可读版本，读取较新容器后保存保留未知字段与原版本戳', () => {
    const library = { ...contract, id: 'forward-library' }
    expect(JSON.parse(serializeVersionedPersistenceJson(library, { name: 'a', clips: [], meta: { author: 'b' } }))).toEqual({ version: 3, minReaderVersion: 2, content: { name: 'a', clips: [], meta: { author: 'b' } } })
    const read = parseVersionedPersistenceJson({ version: 4, minReaderVersion: 3, content: newer }, library) as z.infer<typeof schema>
    const saved = JSON.parse(serializeVersionedPersistenceJson(library, { ...read, name: '旧版本修改' }))
    expect(saved).toMatchObject({ version: 4, minReaderVersion: 3, content: { name: '旧版本修改', future: { lane: 2 }, meta: { reviewer: '新字段' } } })
    expect(() => parseVersionedPersistenceJson({ version: 5, minReaderVersion: 5, content: newer }, library)).toThrow('更新版本')
  })
  it('严格嵌套对象的未知键逐层剥离，不改调用方输入', () => {
    const strict = z.object({ outer: z.object({ inner: z.object({ keep: z.number() }).strict() }).strict() }).strict()
    const input = { outer: { inner: { keep: 1, extra: true }, more: 'x' }, top: 1 }
    const result = readForwardCompatible(strict, input)
    expect(result.value).toEqual({ outer: { inner: { keep: 1 } } })
    expect(restoreForwardFields(result.value, result.fields)).toEqual(input)
    expect(input.outer.inner).toHaveProperty('extra', true)
  })
})
