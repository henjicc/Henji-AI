/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import i18n from '@/i18n/config'
import { createDefaultLlmConfig } from '@/core/llm/defaults'
import AgentModelProfilesSection from './AgentModelProfilesSection'

vi.mock('@/commands/llmRuntime', () => ({ llmVerifyModelCapabilities: vi.fn() }))
afterEach(cleanup)

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
