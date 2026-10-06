// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import type { FakeDocumentCommands as FakeCommands } from '../documentSessionTestKit'

/*
 * 通用文档与项目能力的结果级场景（存储底座 2.5）：经正式调用、授权、事务与读回，
 * 只把 IPC 边界（@/commands/documents）换成内存替身，断言作品“磁盘”真的变化。
 */

const holder = vi.hoisted(() => ({ fake: null as FakeCommands | null }))

// 工厂里不能导入测试替身：替身经会话登记表又导入本模块，会循环等待。调用时再取 holder 里的替身。
vi.mock('@/commands/documents', () => {
  const call = (name: string) => (...args: unknown[]) => {
    const fake = holder.fake as unknown as Record<string, (...input: unknown[]) => unknown>
    return fake[name](...args)
  }
  return {
    listDocuments: call('listDocuments'),
    readDocument: call('readDocument'),
    createDocument: call('createDocument'),
    saveDocument: call('saveDocument'),
    renameDocument: call('renameDocument'),
    finalizeDocument: call('finalizeDocument'),
    moveDocument: call('moveDocument'),
    duplicateDocument: call('duplicateDocument'),
    trashDocument: call('trashDocument'),
    deleteEmptyDraft: call('deleteEmptyDraft'),
    revealDocument: call('revealDocument'),
    forgetDocument: call('forgetDocument'),
    checkDocumentName: call('checkName'),
    refreshDocumentIndex: call('refreshIndex'),
    listProjects: call('listProjects'),
    createProject: call('createProject'),
    renameProject: call('renameProject'),
    finalizeProject: call('finalizeProject'),
    trashProject: call('trashProject'),
    revealProject: call('revealProject'),
    collectDocumentMedia: call('collectDocumentMedia'),
    importFileToContainer: call('importFile'),
    setProjectMainDocument: call('setProjectMainDocument'),
    registerExternalProject: call('registerExternalProject'),
    forgetExternalLocation: call('forgetExternalLocation'),
    exportDocumentPackage: call('exportDocumentPackage'),
    exportProjectPackage: call('exportProjectPackage'),
    importDocumentPackage: call('importPackage'),
    resolveDocumentLink: call('resolveDocumentLink'),
  }
})

const { createApplicationHarness } = await import('@/tests/applicationHarness')
const { FakeDocumentCommands } = await import('../documentSessionTestKit')

let fake: FakeCommands

beforeEach(() => {
  fake = new FakeDocumentCommands()
  holder.fake = fake
})

afterEach(() => { holder.fake = null })

it('通过通用 change 修改文档名并从作品索引读回', async () => {
  const meta = fake.seed({ name: '旧画布', content: { items: ['a'] } })
  fake.seed({ name: '已存在', content: { items: [] } })
  const app = createApplicationHarness()
  try {
    const ref = { kind: 'documents.document', id: meta.id }
    expect((await app.change(ref, { 'documents.document.name': '新画布' })).ok).toBe(true)
    expect(fake.stored(meta.id)?.meta.name).toBe('新画布')
    expect((await app.read(ref, ['documents.document.name'])).properties).toMatchObject({ 'documents.document.name': '新画布' })
    // 重名不加后缀：失败且原名不变
    const conflict = await app.change(ref, { 'documents.document.name': '已存在' })
    expect(conflict.ok).toBe(false)
    expect(fake.stored(meta.id)?.meta.name).toBe('新画布')
  } finally {
    app.dispose()
  }
})

it('新建项目、把文档移进去、创建副本再移到回收站，作品文件随之变化', async () => {
  const meta = fake.seed({ name: '分镜', content: { items: ['a'] } })
  const app = createApplicationHarness()
  try {
    type Verified = { verification: { verified: boolean } }
    const created = await app.requireResult('create_project', { name: '宣传片' }) as { resultRef: { id: string } } & Verified
    const projectId = created.resultRef.id
    // 写入都带从作品索引回读的核实回执（外部智能体据此判定成功）
    expect(created.verification.verified).toBe(true)
    expect(fake.projects.get(projectId)?.name).toBe('宣传片')

    const moved = await app.requireResult('move_document', { documentId: meta.id, projectId }) as { projectId: string | null } & Verified
    expect(moved.projectId).toBe(projectId)
    expect(moved.verification.verified).toBe(true)
    expect(fake.stored(meta.id)?.meta.container).toEqual({ kind: 'project', projectId })

    const listed = await app.requireResult('list_documents', { location: 'project', projectId }) as { documents: Array<{ name: string; projectName: string | null }> }
    expect(listed.documents).toEqual([expect.objectContaining({ name: '分镜', projectName: '宣传片' })])
    expect(JSON.stringify(listed)).not.toContain('D:/')

    const copy = await app.requireResult('duplicate_document', { documentId: meta.id }) as { resultRef: { id: string }; name: string } & Verified
    expect(copy.name).toBe('分镜 (2)')
    expect(copy.verification.verified).toBe(true)
    expect(fake.stored(copy.resultRef.id)?.meta.container).toEqual({ kind: 'project', projectId })

    // 移到回收站是破坏性操作：必须带上读取目标时拿到的基线
    const baseline = await app.read({ kind: 'documents.document', id: copy.resultRef.id }, ['documents.document.name'])
    const trashed = await app.requireResult('trash_document', { documentId: copy.resultRef.id }, baseline.revisions as Record<string, number>) as { status: string } & Verified
    expect(trashed.status).toBe('trashed')
    expect(trashed.verification.verified).toBe(true)
    expect(fake.trashed).toContain(copy.resultRef.id)
    expect(fake.stored(copy.resultRef.id)).toBeUndefined()
  } finally {
    app.dispose()
  }
})

it('移动遇到重名时给出改道办法，按 keepBoth 重试后两个都保留', async () => {
  const project = fake.seedProject({ name: '项目甲' })
  fake.seed({ name: '镜头', content: { items: [] }, folder: project.path, projectId: project.id })
  const outside = fake.seed({ name: '镜头', content: { items: ['b'] } })
  const app = createApplicationHarness()
  try {
    const failed = await app.call('move_document', { documentId: outside.id, projectId: project.id })
    expect(failed.ok).toBe(false)
    expect(JSON.stringify(failed)).toContain('keepBoth')
    expect(fake.stored(outside.id)?.meta.container).toEqual({ kind: 'user' })

    const moved = await app.requireResult('move_document', { documentId: outside.id, projectId: project.id, onConflict: 'keepBoth' }) as { name: string }
    expect(moved.name).toBe('镜头 (2)')
    expect(fake.stored(outside.id)?.meta.container).toEqual({ kind: 'project', projectId: project.id })
  } finally {
    app.dispose()
  }
})

it('复制进另一个项目与导出为单个文件（4.1）：副本落在目标项目，导出只给文件名不给路径', async () => {
  const meta = fake.seed({ name: '海报', content: { items: ['a'] } })
  const project = fake.seedProject({ name: '短片' })
  const app = createApplicationHarness()
  try {
    type Verified = { verification: { verified: boolean } }
    const copy = await app.requireResult('duplicate_document', { documentId: meta.id, projectId: project.id }) as { resultRef: { id: string }; projectId: string | null } & Verified
    expect(copy.projectId).toBe(project.id)
    expect(copy.verification.verified).toBe(true)
    expect(fake.stored(copy.resultRef.id)?.meta.container).toEqual({ kind: 'project', projectId: project.id })
    expect(fake.stored(meta.id)?.meta.container).toEqual({ kind: 'user' })

    const exported = await app.call('export_document_package', { projectId: project.id }) as { ok?: boolean; data?: { fileName: string } }
    expect(JSON.stringify(exported)).toContain('短片.henjipack')
    expect(JSON.stringify(exported)).not.toContain('D:/')
    expect(fake.exportedPackages.at(-1)).toMatchObject({ projectId: project.id })
    const both = await app.call('export_document_package', { documentId: meta.id, projectId: project.id })
    expect(JSON.stringify(both)).toContain('只能给一个')
  } finally {
    app.dispose()
  }
})
