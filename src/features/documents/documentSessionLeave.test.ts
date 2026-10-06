import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createTestRegistry, TEST_DOCUMENT_ROOT, TestToolInstance, type TestContent } from './documentSessionTestKit'

/*
 * 草稿与离开（重要记录 007、012、015）：空草稿删除、保存 / 不保存 / 取消、
 * 起名的重名与非法、另选位置、草稿项目、遗留草稿恢复。
 */

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

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

  it('被别处引用的空草稿（4.1）：离开时询问，不直接删除', async () => {
    const { registry, commands, prompter } = createTestRegistry()
    const session = await registry.create({ kind: 'canvas', container: { kind: 'user' } })
    session.markInUse()
    prompter.leaveChoices.push('cancel')
    expect(await registry.leave(session.id)).toBe('cancelled')
    expect(prompter.log).toEqual(['leave:document:未命名测试 1'])
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

  it('有内容的草稿选“取消”：留在原处，会话与文件都在', async () => {
    const { registry, commands, prompter, session } = await draftWithContent()
    prompter.leaveChoices.push('cancel')
    expect(await registry.leave(session.id)).toBe('cancelled')
    expect(prompter.log).toEqual(['leave:document:未命名测试 1'])
    expect(registry.get(session.id)).toBe(session)
    expect(commands.stored(session.id)?.meta.draft).toBe(true)
  })

  it('有内容的草稿选“不保存”：移到回收站，不再写入', async () => {
    const { registry, commands, prompter, session, tool } = await draftWithContent()
    prompter.leaveChoices.push('discard')
    expect(await registry.leave(session.id)).toBe('discarded')
    expect(commands.trashed).toEqual([session.id])
    expect(registry.get(session.id)).toBeUndefined()
    tool.edit('之后')
    await vi.advanceTimersByTimeAsync(5000)
    expect(commands.calls).not.toContain('saveDocument')
  })

  it('有内容的草稿选“保存”：起名时重名与非法都不能保存，换名后转正并关闭', async () => {
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
    expect(await registry.leave(session.id)).toBe('saved')
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
    expect(await registry.leave(session.id)).toBe('saved')
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
    expect(await registry.leave(session.id)).toBe('saved')
    expect(commands.stored(session.id)?.meta).toMatchObject({ path: 'E:/别处/外部.henji-test', draft: false })
    expect(tool.received.at(-1)).toEqual({ items: ['内容', '已复制素材'] })
  })

  it('起名对话框取消：留在原处，仍是草稿', async () => {
    const { registry, commands, prompter, session } = await draftWithContent()
    prompter.leaveChoices.push('save')
    prompter.saveName = async () => false
    expect(await registry.leave(session.id)).toBe('cancelled')
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

  it('保存草稿项目：起名、另选父文件夹，已打开的文档跟着更新位置', async () => {
    const { registry, commands, prompter } = createTestRegistry()
    const project = await registry.createProject()
    const document = await registry.create({ kind: 'canvas', container: { kind: 'project', projectId: project.id }, name: '剪辑' })
    document.update({ items: ['片段'] })
    prompter.leaveChoices.push('save')
    prompter.saveName = async (info) => {
      expect(info.subject).toEqual({ type: 'project' })
      await info.submit('旅行', 'E:/别处')
      return true
    }
    expect(await registry.leaveProject({ project, isEmpty: false })).toBe('saved')
    expect(prompter.log[0]).toBe('leave:project:未命名项目 1')
    expect(commands.projects.get(project.id)).toMatchObject({ name: '旅行', draft: false, path: 'E:/别处/旅行' })
    expect(commands.stored(document.id)).toMatchObject({ meta: { path: 'E:/别处/旅行/剪辑.henji-test' }, content: { items: ['片段'] } })
    expect(registry.get(document.id)).toBeUndefined()
  })

  it('不保存草稿项目：项目连同已打开的文档一起移到回收站', async () => {
    const { registry, commands, prompter } = createTestRegistry()
    const project = await registry.createProject()
    const document = await registry.create({ kind: 'canvas', container: { kind: 'project', projectId: project.id } })
    document.update({ items: ['x'] })
    prompter.leaveChoices.push('discard')
    expect(await registry.leaveProject({ project, isEmpty: false })).toBe('discarded')
    expect(commands.trashed).toEqual([project.id])
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
