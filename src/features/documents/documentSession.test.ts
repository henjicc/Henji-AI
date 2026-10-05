import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DocumentSessionConflictError } from './documentErrors'
import { createTestRegistry, TestToolInstance, type TestContent } from './documentSessionTestKit'

/*
 * 文档会话：防抖与合并、unchanged、冲突、关闭 / 退出屏障、失败重试（存储底座 2.4）。
 * 用内存替身代替 commands，不跑主进程。
 */

async function openWithTool(content: TestContent = { items: ['a'] }) {
  const kit = createTestRegistry()
  const meta = kit.commands.seed({ name: '海报', content })
  const session = await kit.registry.open({ id: meta.id, path: meta.path })
  const tool = new TestToolInstance(session.getContent() as TestContent)
  const detach = session.attach(tool)
  return { ...kit, meta, session, tool, detach }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('自动保存', () => {
  it('防抖期间的多次修改合并成一次写入，写入的是最后的内容', async () => {
    const { commands, session, tool, meta } = await openWithTool()
    tool.edit('b')
    await vi.advanceTimersByTimeAsync(500)
    tool.edit('c')
    await vi.advanceTimersByTimeAsync(500)
    tool.edit('d')
    expect(session.getState().status).toBe('pending')
    expect(commands.writes).toBe(0)
    await vi.advanceTimersByTimeAsync(800)
    expect(commands.writes).toBe(1)
    expect(commands.stored(meta.id)?.content).toEqual({ items: ['a', 'b', 'c', 'd'] })
    expect(session.getState()).toMatchObject({ status: 'saved', dirty: false })
  })

  it('同一文档串行写入：写入期间的修改等这次完成后再写一次', async () => {
    const { commands, session, tool, meta } = await openWithTool()
    let release!: () => void
    commands.saveGate = new Promise((resolve) => { release = resolve })
    tool.edit('b')
    await vi.advanceTimersByTimeAsync(800)
    expect(session.getState().status).toBe('saving')
    tool.edit('c')
    await vi.advanceTimersByTimeAsync(800)
    commands.saveGate = null
    release()
    // 第二次防抖到期时第一次仍在写：排在其后，不并发
    await vi.advanceTimersByTimeAsync(800)
    expect(commands.maxConcurrentSaves).toBe(1)
    expect(commands.writes).toBe(2)
    expect(commands.stored(meta.id)?.content).toEqual({ items: ['a', 'b', 'c'] })
    expect(session.getState().status).toBe('saved')
  })

  it('内容与磁盘一致时主进程判定 unchanged：不写文件、版本不变', async () => {
    const { commands, session, tool, meta } = await openWithTool()
    tool.touch()
    await vi.advanceTimersByTimeAsync(800)
    expect(commands.calls.filter((call) => call === 'saveDocument')).toHaveLength(1)
    expect(commands.writes).toBe(0)
    expect(session.getState()).toMatchObject({ status: 'saved', dirty: false })
    expect(session.documentMeta.revision).toBe(meta.revision)
  })

  it('没有修改时 flush 不发起保存', async () => {
    const { commands, session } = await openWithTool()
    await session.flush()
    expect(commands.calls).not.toContain('saveDocument')
  })
})

describe('版本冲突', () => {
  it('重新载入：放弃本地修改，把磁盘内容交给工具实例，不触发新的保存', async () => {
    const { commands, prompter, session, tool, meta } = await openWithTool()
    commands.modifyExternally(meta.id, { items: ['别处'] })
    prompter.conflictChoices.push('reload')
    tool.edit('本地')
    await vi.advanceTimersByTimeAsync(800)
    await vi.advanceTimersByTimeAsync(0)
    expect(prompter.log).toEqual(['conflict:海报'])
    expect(tool.content).toEqual({ items: ['别处'] })
    expect(session.getState()).toMatchObject({ status: 'saved', dirty: false })
    await vi.advanceTimersByTimeAsync(5000)
    expect(commands.writes).toBe(0)
    expect(commands.stored(meta.id)?.content).toEqual({ items: ['别处'] })
  })

  it('覆盖：跳过版本核对写入本地内容', async () => {
    const { commands, prompter, session, tool, meta } = await openWithTool()
    commands.modifyExternally(meta.id, { items: ['别处'] })
    prompter.conflictChoices.push('overwrite')
    tool.edit('本地')
    await vi.advanceTimersByTimeAsync(800)
    await vi.advanceTimersByTimeAsync(0)
    expect(commands.stored(meta.id)?.content).toEqual({ items: ['a', '本地'] })
    expect(session.getState()).toMatchObject({ status: 'saved', dirty: false })
  })

  it('稍后处理：保持冲突、暂停自动保存，关闭被阻止；之后仍可选择覆盖', async () => {
    const { commands, prompter, session, tool, meta, registry } = await openWithTool()
    commands.modifyExternally(meta.id, { items: ['别处'] })
    tool.edit('本地')
    await vi.advanceTimersByTimeAsync(800)
    expect(session.getState().status).toBe('conflict')
    tool.edit('再改')
    await vi.advanceTimersByTimeAsync(5000)
    expect(commands.calls.filter((call) => call === 'saveDocument')).toHaveLength(1)
    await expect(session.close()).rejects.toBeInstanceOf(DocumentSessionConflictError)
    expect(registry.get(meta.id)).toBe(session)
    expect(prompter.log).toHaveLength(2)
    await session.resolveConflict('overwrite')
    expect(commands.stored(meta.id)?.content).toEqual({ items: ['a', '本地', '再改'] })
    await session.close()
    expect(registry.get(meta.id)).toBeUndefined()
  })
})

describe('关闭与退出屏障', () => {
  it('关闭前写完最后一次修改，之后解除订阅并移出登记表', async () => {
    const { commands, session, tool, meta, registry } = await openWithTool()
    tool.edit('b')
    await session.close()
    expect(commands.stored(meta.id)?.content).toEqual({ items: ['a', 'b'] })
    expect(session.getState().status).toBe('closed')
    expect(registry.get(meta.id)).toBeUndefined()
    tool.edit('关闭后')
    await vi.advanceTimersByTimeAsync(5000)
    expect(commands.writes).toBe(1)
  })

  it('关闭时等正在写的那次完成', async () => {
    const { commands, session, tool, meta } = await openWithTool()
    let release!: () => void
    commands.saveGate = new Promise((resolve) => { release = resolve })
    tool.edit('b')
    await vi.advanceTimersByTimeAsync(800)
    tool.edit('c')
    let closed = false
    const closing = session.close().then(() => { closed = true })
    await vi.advanceTimersByTimeAsync(0)
    expect(closed).toBe(false)
    commands.saveGate = null
    release()
    await closing
    expect(commands.stored(meta.id)?.content).toEqual({ items: ['a', 'b', 'c'] })
    expect(commands.maxConcurrentSaves).toBe(1)
  })

  it('退出屏障：写完全部会话，删除空草稿，有内容的草稿保留草稿标记以便恢复', async () => {
    const { registry, commands } = createTestRegistry()
    const saved = commands.seed({ name: '已保存', content: { items: ['x'] } })
    const savedSession = await registry.open({ id: saved.id })
    const empty = await registry.create({ kind: 'canvas', container: { kind: 'user' } })
    const draft = await registry.create({ kind: 'canvas', container: { kind: 'user' } })
    savedSession.update({ items: ['x', 'y'] })
    draft.update({ items: ['草稿内容'] })
    await registry.prepareApplicationClose()
    expect(commands.stored(saved.id)?.content).toEqual({ items: ['x', 'y'] })
    expect(commands.stored(empty.id)).toBeUndefined()
    expect(commands.stored(draft.id)).toMatchObject({ meta: { draft: true }, content: { items: ['草稿内容'] } })
    expect(registry.get(empty.id)).toBeUndefined()
  })
})

describe('写入失败', () => {
  it('失败后保留修改并按退避自动重试', async () => {
    const { commands, session, tool, meta } = await openWithTool()
    commands.failSaves = 2
    tool.edit('b')
    await vi.advanceTimersByTimeAsync(800)
    expect(session.getState()).toMatchObject({ status: 'failed', dirty: true })
    expect(session.getState().error?.message).toBe('磁盘已满')
    expect(tool.content).toEqual({ items: ['a', 'b'] })
    await vi.advanceTimersByTimeAsync(2000)
    expect(session.getState().status).toBe('failed')
    await vi.advanceTimersByTimeAsync(4000)
    expect(session.getState()).toMatchObject({ status: 'saved', dirty: false, error: null })
    expect(commands.stored(meta.id)?.content).toEqual({ items: ['a', 'b'] })
  })

  it('手动重试；关闭时写入失败则会话保持打开，修改不丢', async () => {
    const { commands, session, tool, meta, registry } = await openWithTool()
    commands.failSaves = 1
    tool.edit('b')
    await expect(session.close()).rejects.toThrow('磁盘已满')
    expect(registry.get(meta.id)).toBe(session)
    expect(session.getState()).toMatchObject({ status: 'failed', dirty: true })
    await session.retry()
    expect(session.getState().status).toBe('saved')
    await session.close()
    expect(commands.stored(meta.id)?.content).toEqual({ items: ['a', 'b'] })
  })
})

describe('会话唯一', () => {
  it('同一文档同时打开两次得到同一个会话，只读一次', async () => {
    const { registry, commands } = createTestRegistry()
    const meta = commands.seed({ name: '海报', content: { items: [] } })
    const [first, second] = await Promise.all([registry.open({ id: meta.id }), registry.open({ id: meta.id })])
    expect(first).toBe(second)
    expect(commands.calls.filter((call) => call === 'readDocument')).toHaveLength(1)
    expect(() => first.attach(new TestToolInstance({ items: [] }))).not.toThrow()
    expect(() => second.attach(new TestToolInstance({ items: [] }))).toThrow()
  })
})
