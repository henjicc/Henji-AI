// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DropdownOption } from '@/components/ui/Dropdown'
import { useSettingsStore } from '@/stores/settingsStore'
import { modelDefaultsManager } from '@/features/settings/modelDefaultsManager'
import DefaultModelsSection from './DefaultModelsSection'

vi.mock('@/components/ui/Dropdown', () => ({ default: (props: { options: DropdownOption<string>[]; display?: string; onSelect: (value: string) => void }) => (
  <div><span>{props.display}</span>{props.options.map((option) => <button key={option.value} onClick={() => props.onSelect(option.value)}>{option.label}</button>)}</div>
) }))

describe('默认模型分区的转写选择', () => {
  let keys: Record<string, boolean>
  let original: ReturnType<typeof modelDefaultsManager.getSnapshot>
  beforeEach(() => {
    keys = useSettingsStore.getState().providerKeyStatus
    original = modelDefaultsManager.getSnapshot()
    useSettingsStore.getState().setProviderKeyStatuses({ ...keys, bailian: true })
  })
  afterEach(() => {
    modelDefaultsManager.setDefaultModel('transcription', '')
    modelDefaultsManager.setProvider(original.providerId)
    if (original.models.transcription) modelDefaultsManager.setDefaultModel('transcription', original.models.transcription)
    useSettingsStore.getState().setProviderKeyStatuses(keys)
  })
  it('显示 descriptor 候选，选择写入原默认管理器；文本与远端输入模型不出现', () => {
    render(<DefaultModelsSection />)
    expect(screen.getByText(/默认转写模型|Default transcription model/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^qwen3-asr-flash ·/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /seedasr-2.0-file/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /qwen3-asr-flash-filetrans ·/ }))
    expect(modelDefaultsManager.getSnapshot().models.transcription).toBe('bailian.speech-recognition.qwen3-asr-flash-filetrans')
  })
})
