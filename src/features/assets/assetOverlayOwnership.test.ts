/** @vitest-environment jsdom */

import { describe, expect, it } from 'vitest'
import {
  hasOpenAssetChildOverlay,
  isAssetCardMenuTriggerTarget,
  isAssetChildOverlayTarget,
} from './assetOverlayOwnership'

describe('资产面板子浮层归属', () => {
  it('把 Portal 内的后代节点识别为资产面板交互', () => {
    const dropdown = document.createElement('div')
    dropdown.dataset.dropdownPortal = 'true'
    const child = document.createElement('span')
    dropdown.appendChild(child)

    expect(isAssetChildOverlayTarget(child)).toBe(true)
    expect(isAssetChildOverlayTarget(document.createElement('div'))).toBe(false)

    const contextMenu = document.createElement('div')
    contextMenu.dataset.assetContextMenu = 'true'
    expect(isAssetChildOverlayTarget(contextMenu)).toBe(true)
  })

  it('只把打开的预览、卡片菜单和下拉视为 Escape 的优先处理者', () => {
    const root = document.createElement('div')
    const preview = document.createElement('div')
    preview.dataset.assetPreview = 'closed'
    root.appendChild(preview)
    expect(hasOpenAssetChildOverlay(root)).toBe(false)

    preview.dataset.assetPreview = 'open'
    expect(hasOpenAssetChildOverlay(root)).toBe(true)
  })

  it('识别卡片菜单触发器的后代节点', () => {
    const trigger = document.createElement('button')
    trigger.dataset.assetCardMenuTrigger = ''
    const icon = document.createElement('span')
    trigger.appendChild(icon)

    expect(isAssetCardMenuTriggerTarget(icon)).toBe(true)
  })
})
