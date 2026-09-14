import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ prompt: vi.fn(), navigate: vi.fn(), snapshot: vi.fn(), cancel: vi.fn(), dispose: vi.fn(), models: vi.fn() }))
vi.mock('../services/embedded-agent/models', () => ({ listEmbeddedModels: mocks.models }))
vi.mock('../services/embedded-agent/service', () => ({ EmbeddedAgentService: class {
  prompt = mocks.prompt; navigate = mocks.navigate; snapshot = mocks.snapshot; cancel = mocks.cancel; dispose = mocks.dispose
} }))
import { runEmbeddedCli } from './embedded-runner'
import type { AssistantCliOptions } from './arguments'
const options: AssistantCliOptions = { engine: 'pi', goal: '读取项目', approvalMode: 'assistant_decides', captureMode: 'summary',
  printTrace: false, awaitGeneration: false, visible: false, requireVerifiedWrite: false, timeoutMs: 1000 }
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
    expect(write).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'completed', businessVerified: false }))
    expect(mocks.dispose).toHaveBeenCalledOnce()
  })
  it('显式授权才传递完整权限，续聊使用官方会话标识', async () => {
    await runEmbeddedCli({ ...options, approvalMode: 'full_access', threadId: 'existing' }, '', vi.fn())
    expect(mocks.navigate).toHaveBeenCalledWith({ action: 'open', input: 'existing' })
    expect(mocks.prompt).toHaveBeenCalledWith(expect.objectContaining({ access: 'full' }), expect.any(String))
  })
  it('失败消息和超时返回失败，超时停止当前回复并清理进程', async () => {
    mocks.snapshot.mockReturnValue({ busy: false, error: null, pendingMessages: [{ error: '初始化失败' }], messages: [] })
    expect(await runEmbeddedCli(options, '', vi.fn())).toBe(1)
    mocks.snapshot.mockReturnValue({ busy: true, sessionId: 'session' })
    expect(await runEmbeddedCli({ ...options, timeoutMs: 0 }, '', vi.fn())).toBe(1)
    expect(mocks.cancel).toHaveBeenCalledOnce()
    expect(mocks.dispose).toHaveBeenCalledTimes(2)
  })
  it('不支持的验收选项在调用模型之前拒绝，不能产生假通过', async () => {
    for (const flags of [{ requireVerifiedWrite: true }, { awaitGeneration: true }]) {
      await expect(runEmbeddedCli({ ...options, ...flags }, '', vi.fn())).rejects.toThrow('业务结果验收尚未接通')
    }
    await expect(runEmbeddedCli({ ...options, printTrace: true }, '', vi.fn())).rejects.toThrow('embedded_agent')
    expect(mocks.prompt).not.toHaveBeenCalled()
  })
})
