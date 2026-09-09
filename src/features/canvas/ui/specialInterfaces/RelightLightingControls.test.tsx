// @vitest-environment jsdom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { compileManualRelightPrompt, DEFAULT_RELIGHT_SETTINGS } from '@/features/canvas/capabilities/relightPolicy'
import { RelightLightingControls, type RelightLightingDraft } from './RelightLightingControls'
import { RelightDirectionVisualizer } from './RelightDirectionVisualizer'

afterEach(cleanup)

function Harness({ onCommit }: { onCommit: (value: RelightLightingDraft) => void }): JSX.Element {
  const [saved, setSaved] = useState<RelightLightingDraft>({ brightness: 0, colorPreset: 'neutral' })
  const [draft, setDraft] = useState<RelightLightingDraft | null>(null)
  const value = draft ?? saved
  return <>
    <RelightLightingControls value={value} brightnessTitle="亮度" colorTitle="色调"
      onPreview={setDraft} onCommit={(next) => { setSaved(next); onCommit(next) }} />
    <RelightDirectionVisualizer direction="top" {...value} sourceImage={null} sourceAlt="源图" onDirectionChange={() => {}} />
  </>
}

describe('打光滑条与光束预览', () => {
  it('连续拖动只预览，松手提交最后档位，取消拖动恢复已保存的光束', () => {
    const commit = vi.fn()
    render(<Harness onCommit={commit} />)
    const brightness = screen.getByRole('slider', { name: '亮度' })
    const stage = screen.getByRole('slider', { name: '主光方向' })
    brightness.setPointerCapture = vi.fn()
    fireEvent.pointerDown(brightness, { button: 0, pointerId: 1 })
    fireEvent.change(brightness, { target: { value: '3' } })
    fireEvent.change(brightness, { target: { value: '4' } })
    expect(stage.getAttribute('data-relight-brightness')).toBe('2')
    expect(commit).not.toHaveBeenCalled()
    fireEvent.pointerUp(brightness, { pointerId: 1 })
    expect(commit).toHaveBeenCalledTimes(1)
    expect(commit).toHaveBeenCalledWith({ brightness: 2, colorPreset: 'neutral' })
    fireEvent.pointerDown(brightness, { button: 0, pointerId: 2 })
    fireEvent.change(brightness, { target: { value: '0' } })
    expect(stage.getAttribute('data-relight-brightness')).toBe('-2')
    fireEvent.pointerCancel(brightness, { pointerId: 2 })
    expect(stage.getAttribute('data-relight-brightness')).toBe('2')
    expect(commit).toHaveBeenCalledTimes(1)
  })

  it('色调与亮度保留合法契约值，非指针变更立即提交并用于正式提示词', () => {
    const commit = vi.fn()
    render(<Harness onCommit={commit} />)
    fireEvent.change(screen.getByRole('slider', { name: '色调' }), { target: { value: '1' } })
    fireEvent.change(screen.getByRole('slider', { name: '亮度' }), { target: { value: '0' } })
    expect(screen.getByRole('slider', { name: '色调' }).getAttribute('aria-valuetext')).toBe('暖白')
    expect(screen.getByRole('slider', { name: '亮度' }).getAttribute('aria-valuetext')).toBe('很暗')
    expect(screen.getByRole('slider', { name: '主光方向' }).getAttribute('data-relight-color')).toBe('warm')
    const value = commit.mock.lastCall?.[0] as RelightLightingDraft
    expect(value).toEqual({ brightness: -2, colorPreset: 'warm' })
    const prompt = compileManualRelightPrompt({ ...DEFAULT_RELIGHT_SETTINGS, manual: { ...DEFAULT_RELIGHT_SETTINGS.manual, ...value } })
    expect(prompt).toContain('very low-key lighting')
    expect(prompt).toContain('warm white illumination')
  })
})
