/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi, type MockedFunction } from 'vitest'
import type { ComponentProps } from 'react'

import i18n from '@/i18n/config'
import {
  createProviderFromPreset,
  findLlmProviderPreset,
  normalizeLlmProviderSetup,
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
  it('新建 custom provider 时用一次提交同时发送 key 与管理地址', async () => {
    const { onSave } = renderDialog()
    fireEvent.change(screen.getByPlaceholderText('例如：我的模型服务'), { target: { value: '团队代理' } })
    fireEvent.change(screen.getByPlaceholderText('例如：https://api.example.com/v1'), {
      target: { value: 'https://proxy.example.com/v1' },
    })
    fireEvent.change(screen.getByLabelText('API 密钥'), { target: { value: 'dialog-secret' } })
    fireEvent.change(screen.getByPlaceholderText('可选，例如：https://example.com/keys'), {
      target: { value: 'https://proxy.example.com/keys' },
    })
    fireEvent.click(screen.getByRole('button', { name: '添加供应商' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    const [provider, seedModels, credential] = onSave.mock.calls[0]
    expect(provider).toMatchObject({
      providerId: 'provider',
      credentialId: 'provider',
      displayName: '团队代理',
      setup: { kind: 'custom', apiKeyManagementUrl: 'https://proxy.example.com/keys' },
    })
    expect(seedModels).toEqual([])
    expect(credential).toEqual({ kind: 'set', apiKey: 'dialog-secret' })
  })

  it('编辑时不回显旧 key，留空明确发送 unchanged', async () => {
    const { onSave } = renderDialog({ providers: [customProvider()] })
    expect((screen.getByLabelText('API 密钥') as HTMLInputElement).value).toBe('')
    expect(screen.getByPlaceholderText('留空则保留现有密钥')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '保存供应商' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave.mock.calls[0][2]).toEqual({ kind: 'unchanged' })
  })

  it('危险管理地址由正式契约拒绝，错误可理解且草稿不丢失', async () => {
    const onSave = vi.fn(async (provider: LlmProviderConfig) => {
      normalizeLlmProviderSetup(provider.setup!)
    })
    renderDialog({ onSave })
    fireEvent.change(screen.getByPlaceholderText('例如：我的模型服务'), { target: { value: '危险代理' } })
    fireEvent.change(screen.getByPlaceholderText('可选，例如：https://example.com/keys'), {
      target: { value: 'javascript:alert(1)' },
    })
    fireEvent.click(screen.getByRole('button', { name: '添加供应商' }))

    expect((await screen.findByRole('alert')).textContent).toContain('必须是有效的 http:// 或 https:// 地址')
    expect((screen.getByPlaceholderText('例如：我的模型服务') as HTMLInputElement).value).toBe('危险代理')
    expect((screen.getByPlaceholderText('可选，例如：https://example.com/keys') as HTMLInputElement).value)
      .toBe('javascript:alert(1)')
  })

  it('preset 显示官方密钥入口和只读名称，custom 无 URL 时不显示入口', async () => {
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
    expect(screen.queryByPlaceholderText('例如：我的模型服务')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '获取/管理 API Key' }))
    expect(openExternal).toHaveBeenCalledWith(preset.apiKeyUrl)
    unmount()

    renderDialog({ providers: [customProvider()] })
    expect(screen.queryByRole('button', { name: '获取/管理 API Key' })).toBeNull()
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
