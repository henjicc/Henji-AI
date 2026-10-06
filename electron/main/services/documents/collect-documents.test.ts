import path from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'

import { createTestEnvironment, listFiles, type TestEnvironment } from './documents.test-support'

let env: TestEnvironment
beforeEach(() => { env = createTestEnvironment() })
afterEach(async () => { await env.cleanup() })

it('收集素材把引用到的别处文档复制进项目（新 ID），引用改指向副本；原文档不动，再收集不重复复制（4.1）', async () => {
  const { service } = env.services
  const outside = await service.createDocument({ kind: 'canvas', container: { kind: 'user' }, name: '参考画布' })
  const project = await service.createProject({ name: '短片' })
  const edit = await service.createDocument({ kind: 'canvas', container: { kind: 'project', projectId: project.id }, name: '引用方' })
  await service.saveDocument({ target: { id: edit.meta.id }, expectedRevision: 0, content: { clips: [{ source: { docId: outside.meta.id, path: outside.meta.path }, part: 'n1' }, { source: { docId: edit.meta.id, path: edit.meta.path } }] } })

  const result = await service.collectDocumentMedia({ id: edit.meta.id })
  expect(result.copiedDocuments).toBe(1)
  const copies = (await service.listDocuments({ container: { kind: 'project', projectId: project.id } })).filter((document) => document.name === '参考画布')
  expect(copies).toHaveLength(1)
  expect(copies[0].id).not.toBe(outside.meta.id)
  const read = await service.readDocument({ id: edit.meta.id })
  expect(read.content).toEqual({ clips: [{ source: { docId: copies[0].id, path: copies[0].path }, part: 'n1' }, { source: { docId: edit.meta.id, path: edit.meta.path } }] })
  expect((await service.readDocument({ id: outside.meta.id })).meta.path).toBe(outside.meta.path)

  const again = await service.collectDocumentMedia({ id: edit.meta.id })
  expect(again.copiedDocuments).toBe(0)
  expect(await listFiles(project.path)).toEqual(['.henji/project.json', '参考画布.henji-canvas', '引用方.henji-canvas'])
  expect(path.dirname(copies[0].path)).toBe(project.path)
})
