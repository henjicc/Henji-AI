import { describe, expect, it } from 'vitest'

import type { ParamDef } from '@/core/types'
import { isPrimarySelectorParam } from './parameterOrder'

function dropdownParam(id: string, zh: string, en: string): ParamDef {
  return {
    id,
    type: 'dropdown',
    order: 1,
    name: { zh, en },
    default: 'default',
    options: [{ value: 'default', label: 'Default' }]
  }
}

describe('ParameterPanel 参数顺序', () => {
  it.each([
    ['mode', '模式', 'Mode'],
    ['version', '版本', 'Version'],
    ['variant', '变体', 'Variant']
  ])('%s 选择器应显示在比例与分辨率之前', (id, zh, en) => {
    expect(isPrimarySelectorParam(dropdownParam(id, zh, en))).toBe(true)
  })

  it('普通参数不应被错误提前', () => {
    expect(isPrimarySelectorParam(dropdownParam('resolution', '分辨率', 'Resolution'))).toBe(false)
  })
})
