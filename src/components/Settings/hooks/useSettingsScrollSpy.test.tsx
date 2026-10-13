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
function DelayedSettingsBody({ scrollable = true }: { scrollable?: boolean }) {
  const [mounted, setMounted] = useState(false)
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  useSettingsScrollSpy({
    container,
    sectionIds: ['general-mcp', 'general-about'],
    onActiveSectionChange: () => undefined,
  })
  const attachContainer = useCallback((node: HTMLDivElement | null) => { stubContainer(node); setContainer(node) }, [])
  useEffect(() => { setMounted(true) }, [])
  if (!mounted) return null
  return (
    <div ref={attachContainer} style={{ overflowY: scrollable ? 'auto' : 'hidden' }}>
      <section {...{ [SETTINGS_SECTION_ATTR]: 'general-mcp' }} ref={stubSection(900)} />
      <section data-testid="last" {...{ [SETTINGS_SECTION_ATTR]: 'general-about' }} ref={stubSection(300)} />
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
  it('滚动容器延后挂载时仍给末节设最小高度，最后一个短分节可以滚到顶部', () => {
    render(<DelayedSettingsBody />)
    // 800 容器高 - 16 停靠距离 - 16 下内边距；末节内容伸缩时总高度不变，不会跳动
    expect(screen.getByTestId('last').style.minHeight).toBe('768px')
  })
  it('铺满型大类（容器不滚动）不给末节加最小高度', () => {
    render(<DelayedSettingsBody scrollable={false} />)
    expect(screen.getByTestId('last').style.minHeight).toBe('')
  })
})
