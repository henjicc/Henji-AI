// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ProviderCenterModelList from './ProviderCenterModelList'
import type { ProviderCenterGroup, ProviderCenterModelItem } from './providerCenterModel'

vi.mock('@/hooks/useI18n', () => ({
  useI18n: () => ({ t: (key: string, params?: Record<string, string>) => (params?.name ? `${key}:${params.name}` : key) }),
}))

afterEach(cleanup)

function generationItem(name: string): ProviderCenterModelItem {
  return {
    id: 'generation:kie:gpt-image-2',
    source: 'generation',
    providerId: 'kie',
    modelId: 'kie-gpt-image-2',
    name,
    category: 'image-generation',
    capabilityIds: ['image-generation'],
    enabled: true,
    generationModel: {
      id: 'kie-gpt-image-2',
      canonicalModelId: 'gpt-image-2',
      name,
      originalName: 'GPT Image 2',
      type: 'image',
      description: '',
      functions: [],
    },
  }
}

function renderList(model: ProviderCenterModelItem, onRenameModel = vi.fn()) {
  const group = { id: 'kie', models: [model] } as unknown as ProviderCenterGroup
  render(
    <ProviderCenterModelList
      group={group}
      category="all"
      onCategoryChange={vi.fn()}
      onModelEnabledChange={vi.fn()}
      onSetFilteredEnabled={vi.fn()}
      onEditModel={vi.fn()}
      onDeleteModel={vi.fn()}
      onRenameModel={onRenameModel}
    />,
  )
  return onRenameModel
}

describe('供应商中心模型列表：就地改名（原“别名”分区）', () => {
  it('生成模型可直接在行内改名，回车提交', () => {
    const onRename = renderList(generationItem('GPT Image 2'))
    fireEvent.click(screen.getByRole('button', { name: 'providerCenter.actions.renameModel' }))
    const input = screen.getByRole('textbox', { name: 'providerCenter.actions.renameModel' })
    expect((input as HTMLInputElement).value).toBe('')
    fireEvent.change(input, { target: { value: '主力出图' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onRename).toHaveBeenCalledWith(expect.objectContaining({ modelId: 'kie-gpt-image-2' }), '主力出图')
  })

  it('改过名的模型在副标题里保留原名；Esc 放弃编辑不提交', () => {
    const onRename = renderList(generationItem('主力出图'))
    expect(screen.getByText('providerCenter.originalName:GPT Image 2 · kie-gpt-image-2')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'providerCenter.actions.renameModel' }))
    const input = screen.getByRole('textbox', { name: 'providerCenter.actions.renameModel' })
    expect((input as HTMLInputElement).value).toBe('主力出图')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onRename).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox')).toBeNull()
  })
})
