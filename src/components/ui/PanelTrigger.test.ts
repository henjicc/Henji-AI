/** @vitest-environment jsdom */

import { describe, expect, it, vi } from 'vitest'
import {
  isPanelInteractionPortalTarget,
  shouldClosePanelAfterInternalClick,
} from './panelTriggerClosePolicy'

const TARGET = {} as Node

describe('PanelTrigger 面板内部点击关闭策略', () => {
  it('未配置时保持交互型面板打开', () => {
    expect(shouldClosePanelAfterInternalClick(undefined, TARGET)).toBe(false)
  })

  it('支持显式关闭与显式保持打开', () => {
    expect(shouldClosePanelAfterInternalClick(true, TARGET)).toBe(true)
    expect(shouldClosePanelAfterInternalClick(false, TARGET)).toBe(false)
  })

  it('把点击目标交给自定义策略判断', () => {
    const policy = vi.fn(() => true)

    expect(shouldClosePanelAfterInternalClick(policy, TARGET)).toBe(true)
    expect(policy).toHaveBeenCalledWith(TARGET)
  })

  it('下拉和提示词候选 portal 仍归属于当前面板', () => {
    const dropdown = document.createElement('div')
    dropdown.dataset.dropdownPortal = 'true'
    const suggestion = document.createElement('div')
    suggestion.dataset.promptSuggestionPortal = 'true'

    expect(isPanelInteractionPortalTarget(dropdown)).toBe(true)
    expect(isPanelInteractionPortalTarget(suggestion)).toBe(true)
    expect(isPanelInteractionPortalTarget(document.createElement('div'))).toBe(false)
  })
})
