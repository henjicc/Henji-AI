// @vitest-environment jsdom
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { beforeEach, afterEach, it, expect } from 'vitest'
import { CodeProjectRepository } from '../../../../electron/main/services/documents/code-project'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { getPlatform } from '@/platform/runtime'
import { createVideoEditTestProject, closeAllVideoEdits } from './videoEditDocumentTestKit'
import { CODE_PROJECT_FILE, CODE_PROJECT } from './videoEditCodeProjectReflection'
let root: string
let repository: CodeProjectRepository
let app: ReturnType<typeof createApplicationHarness>
beforeEach(async () => {
  installHarnessNativeStorage()
  root = await fsp.mkdtemp(path.join(os.tmpdir(), 'henji-project-public-')); await fsp.mkdir(path.join(root, '.henji'))
  repository = new CodeProjectRepository(path.join(root, '代码'))
  Object.assign(getPlatform().documents, {
    readCodeProject: () => repository.state(),
    changeCodeProject: (request: Parameters<CodeProjectRepository['change']>[0]) => repository.change(request),
    commitCodeProject: (request: { message: string }) => repository.commitWorkspace(request.message),
  })
  app = createApplicationHarness()
})
afterEach(async () => { app.dispose(); await closeAllVideoEdits(); uninstallHarnessNativeStorage(); await fsp.rm(root, { recursive: true, force: true }) })
it('正式通用事务创建多个文件只提交一次，属性读回且撤销追加提交', async () => {
  const owner = await createVideoEditTestProject(); const parent = { kind: 'video_edit.document', id: owner.document.id }
  const changes = ['README.md', 'style/tokens.ts'].map(file => ({ kind: 'create_items', entityType: CODE_PROJECT_FILE, parent, items: [{ properties: { path: file, source: file } }] }))
  const result = await app.requireResult('change_application_entities', { summary: '创建普通源码树', changes }, (await app.read(parent)).revisions as Record<string, number>)
  expect((await repository.state()).log).toHaveLength(1)
  expect((await repository.state()).log[0].message).toBe('创建普通源码树')
  const file = await app.read({ kind: CODE_PROJECT_FILE, id: `${parent.id}:README.md` }, [`${CODE_PROJECT_FILE}.source`, `${CODE_PROJECT_FILE}.bytes`])
  expect(file.properties).toMatchObject({ [`${CODE_PROJECT_FILE}.source`]: 'README.md', [`${CODE_PROJECT_FILE}.bytes`]: 9 })
  await app.requireResult('undo_application_changes', { undoRef: result.undoRef })
  expect((await repository.state()).files).toEqual([])
  expect((await repository.state()).log).toHaveLength(2)
  expect((await app.read({ kind: CODE_PROJECT, id: parent.id }, [`${CODE_PROJECT}.head`])).properties).toHaveProperty(`${CODE_PROJECT}.head`)
})
it('后续步骤失败不落提交；外部冲突不覆盖；显式算法能力提交外部状态', async () => {
  const owner = await createVideoEditTestProject(); const parent = { kind: 'video_edit.document', id: owner.document.id }
  const create = { kind: 'create_items', entityType: CODE_PROJECT_FILE, parent, items: [{ properties: { path: 'a.ts', source: 'a' } }] }
  const failed = await app.call('change_application_entities', { summary: '整批拒绝', changes: [create, create] }, (await app.read(parent)).revisions as Record<string, number>)
  expect(failed.ok).toBe(false)
  expect((await repository.state()).head).toBeNull()
  await app.requireResult('change_application_entities', { summary: '新文件', changes: [create] }, (await app.read(parent)).revisions as Record<string, number>)
  await fsp.writeFile(path.join(repository.dir, 'a.ts'), 'outside')
  const ref = { kind: CODE_PROJECT_FILE, id: `${parent.id}:a.ts` }
  expect((await app.change(ref, { [`${CODE_PROJECT_FILE}.source`]: 'overwrite' })).ok).toBe(false)
  expect(await fsp.readFile(path.join(repository.dir, 'a.ts'), 'utf8')).toBe('outside')
  const committed = await app.requireResult('commit_video_edit_code_project', { documentRef: parent, message: '外部编辑' })
  expect(committed.verified).toBe(true)
  expect((await repository.state()).changes).toEqual([])
})

it('文件路径可改名；经原引用读回新路径，撤销恢复原文件', async () => {
  const owner = await createVideoEditTestProject(); const parent = { kind: 'video_edit.document', id: owner.document.id }
  await app.requireResult('change_application_entities', { summary: '创建移动测试', changes: [{ kind: 'create_items', entityType: CODE_PROJECT_FILE, parent, items: [{ properties: { path: 'old.ts', source: 'source' } }] }] }, (await app.read(parent)).revisions as Record<string, number>)
  const ref = { kind: CODE_PROJECT_FILE, id: `${parent.id}:old.ts` }
  const changed = await app.change(ref, { [`${CODE_PROJECT_FILE}.path`]: 'entries/new.ts', [`${CODE_PROJECT_FILE}.source`]: 'new' })
  expect(changed.ok).toBe(true)
  if (!changed.ok) throw new Error(JSON.stringify(changed.error))
  expect((await repository.state()).files.map(file => file.path)).toEqual(['entries/new.ts'])
  await app.requireResult('undo_application_changes', { undoRef: changed.data.undoRef })
  expect((await repository.state()).files.map(file => file.path)).toEqual(['old.ts'])
})
