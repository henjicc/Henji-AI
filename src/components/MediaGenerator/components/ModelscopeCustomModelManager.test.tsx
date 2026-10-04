// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  remove: vi.fn(),
  confirm: vi.fn(),
}))

vi.mock('@/hooks/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/core/logging', () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }))
vi.mock('@/platform/desktopApi', () => ({ openExternal: vi.fn() }))
vi.mock('@/services/modelscopeCustomModels/availability', () => ({ checkModelscopeModelAvailability: vi.fn() }))
vi.mock('@/stores/alertDialogStore', () => ({ showAlertDialog: vi.fn(), requestAlertConfirmation: mocks.confirm }))
vi.mock('@/services/modelscopeCustomModels/ModelscopeCustomModelService', () => ({
  modelscopeCustomModelService: {
    listModels: mocks.list,
    deleteModel: mocks.remove,
    addModel: vi.fn(),
    updateModel: vi.fn(),
  },
}))

import ModelscopeCustomModelManager from './ModelscopeCustomModelManager'

const model = {
  id: 'owner/my-model',
  name: '我的模型',
  modelType: { imageGeneration: true, imageEditing: false },
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.list.mockResolvedValue([model])
  mocks.remove.mockResolvedValue(undefined)
})
afterEach(cleanup)

describe('魔搭自定义模型管理：删除确认（5.6 第二批）', () => {
  it('删除走应用统一确认弹窗而不是浏览器原生 confirm()，取消时不删除', async () => {
    const nativeConfirm = vi.fn(() => true)
    vi.stubGlobal('confirm', nativeConfirm)
    mocks.confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    render(<ModelscopeCustomModelManager />)
    const remove = await screen.findByRole('button', { name: 'common:delete' })

    fireEvent.click(remove)
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce())
    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({
      title: 'modelscopeCustomModel.actions.deleteTitle',
      message: 'modelscopeCustomModel.confirmDelete',
      confirmLabel: 'common:delete',
    }))
    expect(mocks.remove).not.toHaveBeenCalled()

    fireEvent.click(remove)
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith('owner/my-model'))
    expect(nativeConfirm).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
