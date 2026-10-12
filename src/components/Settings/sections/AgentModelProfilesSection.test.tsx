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
