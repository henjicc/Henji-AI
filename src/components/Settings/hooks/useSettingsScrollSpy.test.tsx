/** @vitest-environment jsdom */

import React, { useCallback, useEffect, useState } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SETTINGS_SECTION_ATTR, useSettingsScrollSpy } from './useSettingsScrollSpy'

function stubContainer(node: HTMLDivElement | null): void {
  if (!node) return
  Object.defineProperty(node, 'clientHeight', { configurable: true, value: 800 })
}

function stubSection(height: number) {
  return (node: HTMLElement | null): void => {
    if (!node) return
    node.getBoundingClientRect = () => ({ top: 0, height } as DOMRect)
  }
}

/** 模拟设置弹窗：滚动容器在首次提交之后才挂载（UiModal 先确定宿主文档再渲染内容）。 */
function DelayedSettingsBody() {
  const [mounted, setMounted] = useState(false)
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const { tailSpacerHeight } = useSettingsScrollSpy({
    container,
    sectionIds: ['general-mcp', 'general-about'],
    onActiveSectionChange: () => undefined,
  })
  const attachContainer = useCallback((node: HTMLDivElement | null) => { stubContainer(node); setContainer(node) }, [])
  useEffect(() => { setMounted(true) }, [])
  if (!mounted) return null
  return (
    <div ref={attachContainer}>
      <section {...{ [SETTINGS_SECTION_ATTR]: 'general-mcp' }} ref={stubSection(900)} />
      <section {...{ [SETTINGS_SECTION_ATTR]: 'general-about' }} ref={stubSection(300)} />
      <div data-testid="spacer" style={{ height: tailSpacerHeight }} />
    </div>
  )
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('useSettingsScrollSpy', () => {
  it('滚动容器延后挂载时仍测量尾部占位，最后一个短分节可以滚到顶部', () => {
    render(<DelayedSettingsBody />)
    // 800 容器高 - 300 末节高 - 16 停靠距离 - 16 下内边距
    expect(screen.getByTestId('spacer').style.height).toBe('468px')
  })
})
