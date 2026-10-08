import fsp from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createDocumentKindRegistry, defineSkeletonDocumentKind } from '../../../../src/core/documents/kinds'
import { buildDocumentEnvelope, serializeDocumentEnvelope } from '../../../../src/core/documents/envelope'
import { createTestEnvironment, type TestEnvironment } from './documents.test-support'
import * as persistenceContracts from '../../../../src/core/persistence/fileContracts'
import { upgradeStoredFile } from '../persistence/stored-file'

let environment: TestEnvironment | undefined
afterEach(async () => { await environment?.cleanup(); environment = undefined; vi.restoreAllMocks() })

describe('文档升级的真实文件边界', () => {
  async function setup(fail = false, missing = false) {
    const skeleton = defineSkeletonDocumentKind({ id: 'canvas', extension: '.henji-test', standaloneFolderNames: { zh: '画布', en: 'Canvas' }, untitledNames: { zh: '未命名画布', en: 'Untitled' }, storage: 'json' })
    const step = vi.fn((content: unknown) => { if (fail) throw new Error('migration exploded'); return { title: (content as { label: string }).label } })
    const kind = { ...skeleton, version: 2, contentSchema: z.object({ title: z.string() }), migrations: missing ? {} as Record<number, (content: unknown) => unknown> : { 1: step } }
    environment = createTestEnvironment({ kinds: createDocumentKindRegistry([kind]) })
    const filePath = path.join(environment.workRoot, '画布', '升级.henji-test')
    await fsp.mkdir(path.dirname(filePath), { recursive: true })
    const text = serializeDocumentEnvelope(buildDocumentEnvelope({ kind: 'canvas', kindVersion: 1, id: 'upgrade', name: '升级', createdAt: '2026-10-09T00:00:00.000Z', updatedAt: '2026-10-09T00:00:00.000Z', revision: 0, draft: false, content: { label: '原内容' } }))
    await fsp.writeFile(filePath, text)
    return { env: environment, filePath, text, step }
  }
  it('打开前备份一次，读取后原文件不变，首次保存才写入当前格式', async () => {
    const { env, filePath, text } = await setup()
    const target = { id: 'upgrade', path: filePath }
    const read = await env.services.service.readDocument(target)
    expect(read.content).toEqual({ title: '原内容' }); expect(await fsp.readFile(filePath, 'utf8')).toBe(text)
    const backups = path.join(path.dirname(filePath), '.henji/backups')
    const files = await fsp.readdir(backups); expect(files).toHaveLength(1); expect(await fsp.readFile(path.join(backups, files[0]), 'utf8')).toBe(text)
    await env.services.service.readDocument(target); expect(await fsp.readdir(backups)).toEqual(files)
    await env.services.service.saveDocument({ target, expectedRevision: 0, content: read.content })
    expect(JSON.parse(await fsp.readFile(filePath, 'utf8'))).toMatchObject({ kindVersion: 2, revision: 1, content: { title: '原内容' } })
    expect(await fsp.readFile(path.join(backups, files[0]), 'utf8')).toBe(text)
  })
  it('迁移失败包含步骤和备份位置，原文件不变；缺迁移明确提示旧格式', async () => {
    const { env, filePath, text } = await setup(true)
    await expect(env.services.service.readDocument({ id: 'upgrade', path: filePath })).rejects.toMatchObject({ name: 'PersistenceError', code: 'migration-failed', fromVersion: 1, toVersion: 2, backupPath: expect.stringContaining('backups') })
    expect(await fsp.readFile(filePath, 'utf8')).toBe(text)
    await env.cleanup(); environment = undefined
    const missing = await setup(false, true)
    await expect(missing.env.services.service.readDocument({ id: 'upgrade', path: missing.filePath })).rejects.toThrow('旧版本格式')
    expect(missing.step).not.toHaveBeenCalled()
  })
  it('备份无法写入时不调用迁移，也不改变原文件', async () => {
    const { env, filePath, text, step } = await setup()
    await fsp.writeFile(path.join(path.dirname(filePath), '.henji'), 'blocked')
    await expect(env.services.service.readDocument({ id: 'upgrade', path: filePath })).rejects.toThrow()
    expect(step).not.toHaveBeenCalled(); expect(await fsp.readFile(filePath, 'utf8')).toBe(text)
  })
  it('共享文件适配器的迁移结果校验失败保留步骤、字段与原始备份', async () => {
    environment = createTestEnvironment()
    const filePath = path.join(environment.outside, 'config.json')
    const text = '{"version":1,"keys":{}}'
    await fsp.writeFile(filePath, text)
    const contract = { ...persistenceContracts.persistenceFileContract('keystore'), version: 2, schema: z.object({ version: z.literal(2), key: z.string() }), migrations: { 1: () => ({ version: 2 }) } }
    vi.spyOn(persistenceContracts, 'persistenceFileContract').mockReturnValue(contract)
    await expect(upgradeStoredFile(filePath, 'keystore', JSON.parse(text) as unknown, 1, text)).rejects.toMatchObject({ code: 'migration-failed', fromVersion: 1, toVersion: 2, fields: ['key'], backupPath: expect.stringContaining('backups') })
    expect(await fsp.readFile(filePath, 'utf8')).toBe(text)
    const backupDirectory = path.join(environment.outside, '.henji', 'backups')
    const names = await fsp.readdir(backupDirectory)
    expect(names).toHaveLength(1)
    expect(await fsp.readFile(path.join(backupDirectory, names[0]), 'utf8')).toBe(text)
  })
})
