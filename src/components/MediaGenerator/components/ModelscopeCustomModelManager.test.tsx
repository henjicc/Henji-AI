// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

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

it('删除自定义模型直接调用正式删除入口，不二次确认', async () => {
  render(<ModelscopeCustomModelManager />)
  fireEvent.click(await screen.findByRole('button', { name: 'common:delete' }))
  await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith('owner/my-model'))
  expect(mocks.confirm).not.toHaveBeenCalled()
})
