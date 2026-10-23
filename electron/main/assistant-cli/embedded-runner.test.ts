import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ prompt: vi.fn(), navigate: vi.fn(), snapshot: vi.fn(), cancel: vi.fn(), dispose: vi.fn(), models: vi.fn() }))
vi.mock('../services/embedded-agent/models', () => ({ listEmbeddedModels: mocks.models }))
vi.mock('../services/embedded-agent/service', () => ({ EmbeddedAgentService: class {
  prompt = mocks.prompt; navigate = mocks.navigate; snapshot = mocks.snapshot; cancel = mocks.cancel; dispose = mocks.dispose
} }))
import { runEmbeddedCli } from './embedded-runner'
import type { AssistantCliOptions } from './arguments'
const options: AssistantCliOptions = { goal: '读取项目', approvalMode: 'assistant_decides', captureMode: 'summary',
  visible: false, timeoutMs: 1000 }
beforeEach(() => {
  vi.resetAllMocks()
  mocks.models.mockResolvedValue([{ providerId: 'test', modelId: 'configured' }])
  mocks.snapshot.mockReturnValue({ busy: false, sessionId: 'session', messages: [], error: null })
})
describe('Pi CLI 正式服务边界', () => {
  it('默认只读，传递宿主上下文并明确回复完成不等于业务验收', async () => {
    const write = vi.fn()
    expect(await runEmbeddedCli(options, '{"workspace":{"id":"nodes"}}', write)).toBe(0)
    expect(mocks.prompt).toHaveBeenCalledWith(expect.objectContaining({ access: 'read', model: { providerId: 'test', modelId: 'configured' }, context: '{"workspace":{"id":"nodes"}}' }), expect.any(String))
    expect(write.mock.calls[0][0].runId).toBe(mocks.prompt.mock.calls[0][1])
    expect(write).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'completed', businessVerified: false, threadId: 'session' }))
    expect(mocks.dispose).toHaveBeenCalledOnce()
  })
  it('显式授权才传递完整权限，续聊使用官方会话标识', async () => {
    await runEmbeddedCli({ ...options, approvalMode: 'full_access', threadId: 'existing' }, '', vi.fn())
    expect(mocks.navigate).toHaveBeenCalledWith({ action: 'open', input: 'existing' })
    expect(mocks.prompt).toHaveBeenCalledWith(expect.objectContaining({ access: 'full' }), expect.any(String))
  })
  it('新对话输出的 threadId 可直接续聊，未知线程拒绝时不开始任务', async () => {
    const write = vi.fn()
    await runEmbeddedCli(options, '', write)
    const threadId = write.mock.calls.at(-1)![0].threadId as string
    await runEmbeddedCli({ ...options, threadId }, '', write)
    expect(mocks.navigate).toHaveBeenLastCalledWith({ action: 'open', input: threadId })
    mocks.navigate.mockRejectedValueOnce(new Error('这段对话已不存在'))
    const before = mocks.prompt.mock.calls.length
    await expect(runEmbeddedCli({ ...options, threadId: 'invented' }, '', write)).rejects.toThrow('这段对话已不存在')
    expect(mocks.prompt).toHaveBeenCalledTimes(before)
    expect(mocks.dispose).toHaveBeenCalledTimes(3)
  })
  it('失败消息和超时返回失败，超时停止当前回复并清理进程', async () => {
    mocks.snapshot.mockReturnValue({ busy: false, error: null, pendingMessages: [{ error: '初始化失败' }], messages: [] })
    expect(await runEmbeddedCli(options, '', vi.fn())).toBe(1)
    mocks.snapshot.mockReturnValue({ busy: true, sessionId: 'session' })
    expect(await runEmbeddedCli({ ...options, timeoutMs: 0 }, '', vi.fn())).toBe(1)
    expect(mocks.cancel).toHaveBeenCalledOnce()
    expect(mocks.dispose).toHaveBeenCalledTimes(2)
  })
})
