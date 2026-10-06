import fsp from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'

import { createTestEnvironment, type TestEnvironment } from './documents.test-support'
import { registerDocumentProgramStateCleaner, resetDocumentProgramStateCleanersForTest } from './program-state-cleaners'

let env: TestEnvironment
beforeEach(() => { env = createTestEnvironment() })
afterEach(async () => {
  resetDocumentProgramStateCleanersForTest()
  await env.cleanup()
})

it('移到回收站、删除空草稿时调用登记的内部缓存清理；单个清理失败不影响操作（4.4）', async () => {
  const { service } = env.services
  const cleaned: string[] = []
  registerDocumentProgramStateCleaner('record', (docId) => { cleaned.push(docId) })
  registerDocumentProgramStateCleaner('broken', () => { throw new Error('坏了') })
  const saved = await service.createDocument({ kind: 'canvas', container: { kind: 'user' }, name: '要删的' })
  await service.trashDocument({ id: saved.meta.id })
  const draft = await service.createDocument({ kind: 'canvas', container: { kind: 'user' }, draft: true })
  await service.deleteEmptyDraft({ id: draft.meta.id })
  expect(cleaned).toEqual([saved.meta.id, draft.meta.id])
})

it('打开别处的文档文件：所在文件夹登记为外部位置并出现在列表；与已有文档同 ID 时换新 ID（4.4）', async () => {
  const { service } = env.services
  const original = await service.createDocument({ kind: 'canvas', container: { kind: 'user' }, name: '原件' })
  const copyPath = path.join(env.outside, '拷贝.henji-canvas')
  await fsp.copyFile(original.meta.path, copyPath)
  const opened = await service.registerExternalDocument(copyPath)
  expect(opened.path).toBe(copyPath)
  expect(opened.id).not.toBe(original.meta.id)
  expect(opened.external).toBe(true)
  expect((await service.listDocuments()).map((document) => document.id).sort()).toEqual([original.meta.id, opened.id].sort())
  await expect(service.registerExternalDocument(path.join(env.outside, '不存在.henji-canvas'))).rejects.toThrow('请选择一个文档文件')
})
