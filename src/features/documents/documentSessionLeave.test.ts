import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createTestRegistry, TEST_DOCUMENT_ROOT, TestToolInstance, type TestContent } from './documentSessionTestKit'
import { DocumentSessionRegistry } from './documentSessionRegistry'
import { dialogDocumentSessionPrompter, useDocumentPromptStore } from './documentPromptStore'
import { testDocumentKind } from './documentSessionTestKit'
import type { DocumentKindDescriptor } from '@/core/documents/kinds'

/*
 * 草稿与离开（重要记录 007、012、015）：空草稿删除、保存 / 不保存 / 取消、
 * 起名的重名与非法、另选位置、草稿项目、遗留草稿恢复。
 */

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('真实提示队列的冲突屏障', () => {
  it.each(['save', 'leave', 'project'] as const)('%s 自动处理已存在的冲突，不要求选择版本', async action => {
    const { commands } = createTestRegistry()
    const registry = new DocumentSessionRegistry({ commands, prompter: dialogDocumentSessionPrompter, kinds: { require: () => testDocumentKind as unknown as DocumentKindDescriptor } })
    const project = commands.seedProject({ name: '草稿项目', draft: true })
    const meta = commands.seed({ name: '草稿', draft: true, content: { items: ['初始'] }, projectId: project.id, folder: project.path })
    const session = await registry.open({ id: meta.id })
    session.update({ items: ['本地'] })
    commands.modifyExternally(meta.id, { items: ['外部'] })
    await vi.advanceTimersByTimeAsync(800)
    expect(useDocumentPromptStore.getState().queue).toEqual([])
    expect(commands.stored(meta.id)?.content).toEqual({ items: ['本地'] })
    if (action === 'save') {
      const pending = registry.save(meta.id)
      await vi.advanceTimersByTimeAsync(0)
      const prompt = useDocumentPromptStore.getState().queue[0]
      if (prompt.type !== 'saveName') throw new Error('缺少起名提示')
      await prompt.info.submit('正式', null); prompt.resolve(true)
      expect(await pending).toBe(true)
      await session.close()
    } else if (action === 'leave') expect(await registry.leave(meta.id)).toBe('saved')
    else expect(await registry.leaveProject({ project, isEmpty: false })).toBe('saved')
    expect(useDocumentPromptStore.getState().queue).toEqual([])
    expect(registry.get(meta.id)).toBeUndefined()
  })

  it('起名 submit 才撞冲突时直接结束提交，不把冲突排在起名后面', async () => {
    const { commands } = createTestRegistry()
    const registry = new DocumentSessionRegistry({ commands, prompter: dialogDocumentSessionPrompter, kinds: { require: () => testDocumentKind as unknown as DocumentKindDescriptor } })
    const meta = commands.seed({ name: '草稿', draft: true, content: { items: ['初始'] } })
    const session = await registry.open({ id: meta.id })
    const saving = registry.save(meta.id)
    await vi.advanceTimersByTimeAsync(0)
    const prompt = useDocumentPromptStore.getState().queue[0]
    if (prompt.type !== 'saveName') throw new Error('缺少起名提示')
    session.update({ items: ['本地'] })
    commands.modifyExternally(meta.id, { items: ['外部'] })
    let settled = false
    const submit = prompt.info.submit('正式', null).catch(error => error as Error).finally(() => { settled = true })
    await vi.advanceTimersByTimeAsync(0)
    try {
      expect(settled).toBe(true)
      expect(await submit).toMatchObject({ name: 'DocumentSessionConflictError' })
      expect(useDocumentPromptStore.getState().queue.map(item => item.type)).toEqual(['saveName'])
    } finally {
      await submit
      prompt.resolve(false)
      await saving
      await session.discard()
    }
  })
})

async function draftWithContent() {
  const kit = createTestRegistry()
  const session = await kit.registry.create({ kind: 'canvas', container: { kind: 'user' } })
  const tool = new TestToolInstance(session.getContent() as TestContent)
  session.attach(tool)
  tool.edit('内容')
  return { ...kit, session, tool }
}

describe('离开文档', () => {
  it('已保存过的文档离开时不询问，写完后关闭', async () => {
    const { registry, commands, prompter } = createTestRegistry()
    const meta = commands.seed({ name: '海报', content: { items: [] } })
    const session = await registry.open({ id: meta.id })
    session.update({ items: ['改'] })
    expect(await registry.leave(meta.id)).toBe('closed')
    expect(prompter.log).toEqual([])
    expect(commands.stored(meta.id)?.content).toEqual({ items: ['改'] })
  })

  it('空草稿直接删除，不询问', async () => {
    const { registry, commands, prompter } = createTestRegistry()
    const session = await registry.create({ kind: 'canvas', container: { kind: 'user' } })
    expect(session.documentMeta).toMatchObject({ draft: true, name: '未命名测试 1' })
    expect(await registry.leave(session.id)).toBe('discarded')
    expect(prompter.log).toEqual([])
    expect(commands.calls).toContain('deleteEmptyDraft')
    expect(commands.stored(session.id)).toBeUndefined()
    expect(commands.trashed).toEqual([])
    expect(registry.get(session.id)).toBeUndefined()
  })

  it('被别处引用的空草稿直接保留，不删除、不要求起名', async () => {
    const { registry, commands, prompter } = createTestRegistry()
    const session = await registry.create({ kind: 'canvas', container: { kind: 'user' } })
    session.markInUse()
    expect(await registry.leave(session.id)).toBe('saved')
    expect(prompter.log).toEqual([])
    expect(commands.calls).not.toContain('deleteEmptyDraft')
    expect(commands.stored(session.id)?.meta.draft).toBe(true)
  })

  it('内容被清空但尚未写盘的草稿：先写完再删除', async () => {
    const { registry, commands, session, tool } = await draftWithContent()
    await session.flush()
    expect(commands.stored(session.id)?.content).toEqual({ items: ['内容'] })
    tool.clear()
    expect(await registry.leave(session.id)).toBe('discarded')
    expect(commands.stored(session.id)).toBeUndefined()
  })

  it('有内容的草稿离开时保存并保留草稿，下次可继续编辑', async () => {
    const { registry, commands, prompter, session } = await draftWithContent()
    expect(await registry.leave(session.id)).toBe('saved')
    expect(prompter.log).toEqual([])
    expect(commands.trashed).toEqual([])
    expect(commands.stored(session.id)?.content).toEqual({ items: ['内容'] })
    expect(commands.stored(session.id)?.meta.draft).toBe(true)
    expect(registry.get(session.id)).toBeUndefined()
    expect((await registry.open({ id: session.id })).getContent()).toEqual({ items: ['内容'] })
  })

  it('主动保存草稿：起名时重名与非法都不能保存，换名后转正并关闭', async () => {
    const { registry, commands, prompter, session } = await draftWithContent()
    commands.seed({ name: '已有作品', content: { items: [] } })
    prompter.leaveChoices.push('save')
    const checks: string[] = []
    prompter.saveName = async (info) => {
      expect(info.defaultFolder).toBe(TEST_DOCUMENT_ROOT)
      expect(info.initialName).toBe('未命名测试 1')
      checks.push((await info.check('已有作品', null)).status)
      checks.push((await info.check('已有作品 ', null)).status)
      checks.push((await info.check('a:b', null)).status)
      checks.push((await info.check('CON', null)).status)
      checks.push((await info.check('未命名测试 1', null)).status)
      const available = await info.check('新海报', null)
      checks.push(available.status)
      await info.submit('新海报', null)
      return true
    }
    expect(await registry.save(session.id)).toBe(true)
    await session.close()
    expect(checks).toEqual(['duplicate', 'duplicate', 'invalid', 'invalid', 'available', 'available'])
    expect(commands.stored(session.id)?.meta).toMatchObject({ name: '新海报', draft: false, path: `${TEST_DOCUMENT_ROOT}/新海报.henji-test` })
    expect(commands.stored(session.id)?.content).toEqual({ items: ['内容'] })
    expect(registry.get(session.id)).toBeUndefined()
  })

  it('保存时被别处抢先建了同名：提交失败，对话框可换名重试', async () => {
    const { registry, commands, prompter, session } = await draftWithContent()
    prompter.leaveChoices.push('save')
    prompter.saveName = async (info) => {
      expect((await info.check('抢先', null)).status).toBe('available')
      commands.seed({ name: '抢先', content: { items: [] } })
      await expect(info.submit('抢先', null)).rejects.toMatchObject({ name: 'DocumentNameConflictError' })
      await info.submit('另一个名字', null)
      return true
    }
    expect(await registry.save(session.id)).toBe(true)
    await session.close()
    expect(commands.stored(session.id)?.meta.name).toBe('另一个名字')
  })

  it('另选位置：草稿移过去；素材被复制、引用改写时按新位置重新载入内容', async () => {
    const { registry, commands, prompter, session, tool } = await draftWithContent()
    prompter.leaveChoices.push('save')
    prompter.saveName = async (info) => {
      expect((await info.check('外部', 'Z:/不可用')).status).toBe('invalid')
      expect((await info.check('外部', 'E:/别处')).status).toBe('available')
      await info.submit('外部', 'E:/别处')
      return true
    }
    expect(await registry.save(session.id)).toBe(true)
    await session.close()
    expect(commands.stored(session.id)?.meta).toMatchObject({ path: 'E:/别处/外部.henji-test', draft: false })
    expect(tool.received.at(-1)).toEqual({ items: ['内容', '已复制素材'] })
  })

  it('起名对话框取消：留在原处，仍是草稿', async () => {
    const { registry, commands, prompter, session } = await draftWithContent()
    prompter.leaveChoices.push('save')
    prompter.saveName = async () => false
    expect(await registry.save(session.id)).toBe(false)
    expect(registry.get(session.id)).toBe(session)
    expect(commands.stored(session.id)?.meta.draft).toBe(true)
  })
})

describe('草稿项目', () => {
  it('空的草稿项目直接移到回收站，不询问', async () => {
    const { registry, commands, prompter } = createTestRegistry()
    const project = await registry.createProject()
    expect(await registry.leaveProject({ project, isEmpty: true })).toBe('discarded')
    expect(prompter.log).toEqual([])
    expect(commands.trashed).toEqual([project.id])
  })

  it('有内容的草稿项目离开时保留整组草稿和文档内容', async () => {
    const { registry, commands, prompter } = createTestRegistry()
    const project = await registry.createProject()
    const document = await registry.create({ kind: 'canvas', container: { kind: 'project', projectId: project.id }, name: '剪辑' })
    document.update({ items: ['片段'] })
    expect(await registry.leaveProject({ project, isEmpty: false })).toBe('saved')
    expect(prompter.log).toEqual([])
    expect(commands.projects.get(project.id)?.draft).toBe(true)
    expect(commands.stored(document.id)?.content).toEqual({ items: ['片段'] })
    expect(commands.trashed).toEqual([])
    expect(registry.get(document.id)).toBeUndefined()
  })
})

describe('遗留草稿', () => {
  it('只列出没打开的草稿；恢复即打开，丢弃移到回收站', async () => {
    const { registry, commands } = createTestRegistry()
    const leftover = commands.seed({ name: '未命名测试 3', content: { items: ['x'] }, draft: true })
    commands.seed({ name: '已保存', content: { items: ['x'] } })
    const open = await registry.create({ kind: 'canvas', container: { kind: 'user' } })
    const drafts = await registry.listLeftoverDrafts({ kind: 'canvas' })
    expect(drafts.map((draft) => draft.id)).toEqual([leftover.id])
    expect(drafts.some((draft) => draft.id === open.id)).toBe(false)

    const recovered = await registry.open({ id: leftover.id, path: leftover.path })
    expect(recovered.documentMeta.draft).toBe(true)
    expect(await registry.listLeftoverDrafts({ kind: 'canvas' })).toEqual([])
    await expect(registry.discardLeftoverDraft(leftover)).rejects.toThrow()

    await recovered.close()
    await registry.discardLeftoverDraft(leftover)
    expect(commands.trashed).toEqual([leftover.id])
  })
})
