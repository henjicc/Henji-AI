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
  it('产品渠道应显示在比例与分辨率之前', () => {
    const param = dropdownParam('providerChannel', '渠道', 'Channel')
    param.name = { key: 'params.fields.apiChannel', absolute: true }
    expect(isPrimarySelectorParam(param)).toBe(true)
  })

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

  it('音频声道不应被当作产品渠道提前', () => {
    const param = dropdownParam('audioChannel', '声道', 'Channel')
    param.name = { key: 'params.fields.channel', absolute: true }
    expect(isPrimarySelectorParam(param)).toBe(false)
  })

  it('自定义标签的产品渠道（未使用共享 apiChannel key）也应显示在比例与分辨率之前', () => {
    const param = dropdownParam('grsaiNanoBanana2Channel', '渠道', 'Channel')
    expect(isPrimarySelectorParam(param)).toBe(true)
  })
})
