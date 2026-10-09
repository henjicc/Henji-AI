import { describe, expect, it } from 'vitest'

import { ImageEditorPanelRegistryV3, type ImageEditorPanelDefinitionV3 } from './panelRegistry'

const panel = (id: string, order = 0): ImageEditorPanelDefinitionV3 => ({
  id, order, title: id, titleKey: `panels.${id}`, component: () => null,
})

describe('图片面板登记', () => {
  it('独立条目按宿主 profile 过滤并稳定排序，无未实现的空壳面板', () => {
    const registry = new ImageEditorPanelRegistryV3([panel('properties', 2), panel('layers', 1), panel('history', 3)])
    expect(registry.list({ panels: ['properties', 'layers'] }).map(({ id }) => id)).toEqual(['layers', 'properties'])
    expect(registry.list({ panels: [] })).toEqual([])
    expect(registry.list({ panels: ['color'] })).toEqual([])
  })

  it('重复或保留登记失败，不覆盖已有面板', () => {
    expect(() => new ImageEditorPanelRegistryV3([panel('layers'), panel('layers')])).toThrow('重复登记')
    expect(() => new ImageEditorPanelRegistryV3([panel('preview')])).toThrow('无效')
    expect(() => new ImageEditorPanelRegistryV3([panel('bad/id')])).toThrow('无效')
    expect(() => new ImageEditorPanelRegistryV3([panel('layers', NaN)])).toThrow('排序')
  })
})
