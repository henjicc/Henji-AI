// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import i18n from '@/i18n/config'
import { createDefaultLlmConfig } from '@/core/llm/defaults'
import AgentModelProfilesSection from './AgentModelProfilesSection'

const verify = vi.hoisted(() => vi.fn())
vi.mock('@/commands/llmRuntime', () => ({ llmVerifyModelCapabilities: verify }))
vi.mock('@/core/logging', () => ({ createLogger: () => ({ info: vi.fn(), error: vi.fn() }) }))
afterEach(cleanup)

it('验证失败可就地重试，保留上次结果并用能力名称说明影响', async () => {
  await i18n.changeLanguage('zh-CN')
  const config = createDefaultLlmConfig()
  const profile = config.agentProfiles[0]
  const model = config.models.find(item => item.modelId === profile.primary.modelId && item.providerId === profile.primary.providerId)!
  const result = { providerId: model.providerId, modelId: model.modelId, adapterVersion: 'fixture', verifiedAt: new Date().toISOString(), totalLatencyMs: 10,
    checks: [{ id: 'toolCall' as const, status: 'failed' as const, latencyMs: 10 }, { id: 'usage' as const, status: 'skipped' as const, latencyMs: 0 }],
    usage: { inputTokens: null, outputTokens: null, reasoningTokens: null, cacheReadTokens: null, cacheWriteTokens: null, totalTokens: null }, cost: { status: 'unknown' as const } }
  profile.verifications = [result]
  verify.mockRejectedValueOnce(new Error('connection reset')).mockResolvedValueOnce(result)
  const save = vi.fn(async () => {})
  render(<AgentModelProfilesSection config={config} saveConfig={save} />)
  const details = screen.getAllByRole('button', { name: '详情' })[0]
  const modelDetails = within(details.parentElement!.parentElement!)
  fireEvent.click(details)
  fireEvent.click(screen.getByRole('button', { name: '验证此模型' }))
  const error = await screen.findByRole('alert')
  expect(within(error).getByText('验证没有完成')).toBeTruthy()
  expect(modelDetails.getByText('以下为上次验证结果')).toBeTruthy()
  expect(modelDetails.getByText('调用工具')).toBeTruthy()
  expect(modelDetails.getByText('助手无法操作应用，只能对话。')).toBeTruthy()
  expect(modelDetails.getByText('未验证')).toBeTruthy()
  expect(screen.queryByText(/toolCall|请求协议/)).toBeNull()
  fireEvent.click(within(error).getByRole('button', { name: '重试' }))
  await vi.waitFor(() => expect(save).toHaveBeenCalledOnce())
  expect(verify).toHaveBeenCalledTimes(2)
  expect(screen.queryByRole('alert')).toBeNull()
})

it('详情去掉重复技术摘要，隐藏未知用量，仅显示上次验证的已知用量（含零值）', async () => {
  await i18n.changeLanguage('zh-CN')
  const config = createDefaultLlmConfig()
  const profile = config.agentProfiles[0]
  const unknownUsage = { inputTokens: null, outputTokens: null, reasoningTokens: null, cacheReadTokens: null, cacheWriteTokens: null, totalTokens: null }
  profile.verifications = [{ ...profile.primary, adapterVersion: 'test', verifiedAt: '2026-10-13T00:00:00Z',
    checks: [], totalLatencyMs: 1, usage: unknownUsage, cost: { status: 'unknown' } }]
  const rendered = render(<AgentModelProfilesSection config={config} saveConfig={vi.fn()} />)
  fireEvent.click(screen.getAllByRole('button', { name: '详情' })[0])
  expect(screen.queryByText(/^工具 .*上下文/)).toBeNull()
  expect(screen.queryByText(/^Token：|^上次验证用量：/)).toBeNull()
  expect(screen.getAllByText('会向该模型发起一次最小真实请求').length).toBeGreaterThan(0)
  const known = { ...config, agentProfiles: [{ ...profile, verifications: [{ ...profile.verifications[0], usage: { ...unknownUsage, inputTokens: 120, outputTokens: 30 } }] }] }
  rendered.rerender(<AgentModelProfilesSection config={known} saveConfig={vi.fn()} />)
  expect(screen.getAllByText('上次验证用量：输入 120、输出 30').length).toBeGreaterThan(0)
  expect(screen.queryByText(/用量：.*未知/)).toBeNull()
  known.agentProfiles[0].verifications[0].usage.outputTokens = 0
  rendered.rerender(<AgentModelProfilesSection config={{ ...known }} saveConfig={vi.fn()} />)
  expect(screen.getAllByText('上次验证用量：输入 120、输出 0').length).toBeGreaterThan(0)
})
