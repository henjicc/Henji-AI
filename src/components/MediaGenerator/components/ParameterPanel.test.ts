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
    param.role = 'channel'
    expect(isPrimarySelectorParam(param)).toBe(true)
  })

  it('自定义标签的产品渠道（未使用共享 apiChannel 词表）同样应提前', () => {
    const param = dropdownParam('grsaiNanoBanana2Channel', '渠道', 'Channel')
    param.role = 'channel'
    expect(isPrimarySelectorParam(param)).toBe(true)
  })

  it.each([
    ['mode', '模式', 'Mode'],
    ['version', '版本', 'Version'],
    ['variant', '变体', 'Variant']
  ])('%s 选择器应显示在比例与分辨率之前', (id, zh, en) => {
    const param = dropdownParam(id, zh, en)
    param.role = 'mode'
    expect(isPrimarySelectorParam(param)).toBe(true)
  })

  it('普通参数不应被错误提前', () => {
    expect(isPrimarySelectorParam(dropdownParam('resolution', '分辨率', 'Resolution'))).toBe(false)
  })

  it('音频声道不应被当作产品渠道提前', () => {
    const param = dropdownParam('audioChannel', '声道', 'Channel')
    param.name = { key: 'params.fields.channel', absolute: true }
    expect(isPrimarySelectorParam(param)).toBe(false)
  })

  it('顺序完全由 role 决定，不再受参数名文案影响', () => {
    // 名字叫「渠道」但没声明 role：这类漏写由 modelParamConventionValidator 在注册时拦下，
    // 面板本身不做文案兜底，避免换个措辞就静默失效。
    expect(isPrimarySelectorParam(dropdownParam('someChannel', '渠道', 'Channel'))).toBe(false)
    // 反过来，名字与角色无关的参数只要声明了 role 就会提前。
    const param = dropdownParam('accessPoint', '接入点', 'Access Point')
    param.role = 'channel'
    expect(isPrimarySelectorParam(param)).toBe(true)
  })
})
