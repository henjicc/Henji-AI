/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi, type MockedFunction } from 'vitest'
import type { ComponentProps } from 'react'

import i18n from '@/i18n/config'
import {
  createProviderFromPreset,
  findLlmProviderPreset,
  type LlmProviderConfig,
} from '@henjicc/ai-sdk'

const openExternal = vi.hoisted(() => vi.fn())
vi.mock('../hooks/useExternalLink', () => ({
  useExternalLink: () => ({ openExternal }),
}))

import LlmProviderDialog from './LlmProviderDialog'

type DialogProps = ComponentProps<typeof LlmProviderDialog>
type SaveHandler = DialogProps['onSave']
type DeleteHandler = DialogProps['onDelete']

beforeAll(async () => {
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: vi.fn(() => null),
  })
  await i18n.changeLanguage('zh-CN')
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function customProvider(overrides: Partial<LlmProviderConfig> = {}): LlmProviderConfig {
  return {
    providerId: 'custom-one',
    credentialId: 'custom-one',
    setup: { kind: 'custom' },
    displayName: '自定义一号',
    adapter: 'openai',
    baseUrl: 'https://api.example.com/v1',
    enabled: true,
    ...overrides,
  }
}

function renderDialog({
  providers = [],
  onSave = vi.fn(async () => undefined),
  onDelete = vi.fn(async () => undefined),
}: {
  providers?: LlmProviderConfig[]
  onSave?: SaveHandler
  onDelete?: DeleteHandler
} = {}) {
  render(
    <LlmProviderDialog
      isOpen
      providers={providers}
      onClose={vi.fn()}
      onSave={onSave}
      onDelete={onDelete}
    />
  )
  return {
    onSave: onSave as MockedFunction<SaveHandler>,
    onDelete: onDelete as MockedFunction<DeleteHandler>,
  }
}

describe('LlmProviderDialog', () => {
  it('新建 custom provider 时提交供应商字段与 key，并允许填写管理地址', async () => {
    const { onSave } = renderDialog()
    fireEvent.change(screen.getByPlaceholderText('例如：我的模型服务'), { target: { value: '团队代理' } })
    fireEvent.change(screen.getByPlaceholderText('例如：https://api.example.com/v1'), {
      target: { value: 'https://proxy.example.com/v1' },
    })
    fireEvent.change(screen.getByLabelText('API 密钥'), { target: { value: 'dialog-secret' } })
    expect(screen.getByText('密钥管理地址')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '添加供应商' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    const [provider, seedModels, credential] = onSave.mock.calls[0]
    expect(provider).toMatchObject({
      providerId: 'provider',
      credentialId: 'provider',
      displayName: '团队代理',
      setup: { kind: 'custom' },
    })
    expect(seedModels).toEqual([])
    expect(credential).toEqual({ kind: 'set', apiKey: 'dialog-secret' })
  })

  it('编辑时不回显旧 key，留空明确发送 unchanged', async () => {
    const { onSave } = renderDialog({ providers: [customProvider()] })
    expect(screen.queryByLabelText('API 密钥')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '保存供应商' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave.mock.calls[0][2]).toEqual({ kind: 'unchanged' })
  })

  it('可自定义的 LLM 供应商界面显示 SDK 官网与密钥入口，纯 custom 不猜地址', async () => {
    const preset = findLlmProviderPreset('ppio')!
    const { unmount } = render(
      <LlmProviderDialog
        isOpen
        providers={[]}
        onClose={vi.fn()}
        onSave={vi.fn().mockResolvedValue(undefined)}
        onDelete={vi.fn().mockResolvedValue(undefined)}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: '供应商预设' }))
    fireEvent.click(screen.getByRole('option', { name: '派欧云' }))
    expect(screen.queryByText('接口协议')).toBeNull()
    expect(screen.getByText('请求协议由 SDK 按具体模型自动选择，无需手动设置。')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '访问官网' }))
    expect(openExternal).toHaveBeenCalledWith(preset.websiteUrl)
    fireEvent.click(screen.getByRole('button', { name: '获取/管理 API Key' }))
    expect(openExternal).toHaveBeenCalledWith(preset.apiKeyUrl)
    unmount()

    renderDialog({ providers: [customProvider()] })
    expect(screen.queryByRole('button', { name: '访问官网' })).toBeNull()
    expect(screen.queryByRole('button', { name: '获取/管理 API Key' })).toBeNull()
  })

  it('预制供应商隐藏底层协议，自定义接口只显示 Chat 与 Responses', () => {
    renderDialog()
    expect(screen.getByText('接口协议')).toBeTruthy()
    expect(screen.getByRole('button', { name: '接口协议' }).textContent).toContain('Chat Completions')
    expect(screen.queryByText('DeepSeek', { selector: '[role="option"]' })).toBeNull()
    expect(screen.queryByText(/Anthropic/, { selector: '[role="option"]' })).toBeNull()
    fireEvent.change(screen.getByPlaceholderText('例如：https://api.example.com/v1'), {
      target: { value: 'https://api.example.com/v1' },
    })
    fireEvent.click(screen.getByRole('button', { name: '接口协议' }))
    fireEvent.click(screen.getByRole('option', { name: 'OpenAI Responses' }))
    expect(screen.getByText('预览：https://api.example.com/v1/responses')).toBeTruthy()
  })

  it('移除重复说明并把 builtin 重置/custom 删除放在独立分隔行', () => {
    const preset = findLlmProviderPreset('ppio')!
    const builtIn = createProviderFromPreset(preset, { lifecycle: 'builtin' })
    const { unmount } = render(
      <LlmProviderDialog
        isOpen
        providers={[builtIn]}
        onClose={vi.fn()}
        onSave={vi.fn().mockResolvedValue(undefined)}
        onDelete={vi.fn().mockResolvedValue(undefined)}
      />
    )
    expect(screen.queryByText('当前编辑')).toBeNull()
    expect(screen.queryByText(/推荐模型：/)).toBeNull()
    expect(screen.getByRole('button', { name: '重置供应商' }).parentElement?.parentElement?.className)
      .toContain('border-t')
    expect(screen.queryByRole('button', { name: '删除该供应商' })).toBeNull()
    unmount()

    renderDialog({ providers: [customProvider()] })
    expect(screen.getByRole('button', { name: '删除该供应商' }).parentElement?.parentElement?.className)
      .toContain('border-t')
  })

  it('custom 删除只通过高层删除回调提交供应商坐标', async () => {
    const { onDelete } = renderDialog({ providers: [customProvider()] })
    fireEvent.click(screen.getByRole('button', { name: '删除该供应商' }))

    await waitFor(() => expect(onDelete).toHaveBeenCalledWith('custom-one'))
  })

  it('事务失败时保留用户输入并显示可行动错误', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('[llm_provider_settings_commit_failed] restored'))
    renderDialog({ onSave })
    fireEvent.change(screen.getByPlaceholderText('例如：我的模型服务'), { target: { value: '失败代理' } })
    fireEvent.change(screen.getByLabelText('API 密钥'), { target: { value: 'still-here' } })
    fireEvent.click(screen.getByRole('button', { name: '添加供应商' }))

    expect((await screen.findByRole('alert')).textContent).toContain('原有设置已保留')
    expect((screen.getByPlaceholderText('例如：我的模型服务') as HTMLInputElement).value).toBe('失败代理')
    expect((screen.getByLabelText('API 密钥') as HTMLInputElement).value).toBe('still-here')
  })

  it('内置身份被拒绝时引导使用禁用或重置', async () => {
    const preset = findLlmProviderPreset('ppio')!
    const builtIn = createProviderFromPreset(preset, { lifecycle: 'builtin' })
    const onSave = vi.fn().mockRejectedValue(new Error('[llm_provider_builtin_identity_forbidden] rejected'))
    renderDialog({ providers: [builtIn], onSave })

    fireEvent.click(screen.getByRole('button', { name: '保存供应商' }))

    expect((await screen.findByRole('alert')).textContent).toContain('请使用“禁用”或“重置供应商”')
  })
})
