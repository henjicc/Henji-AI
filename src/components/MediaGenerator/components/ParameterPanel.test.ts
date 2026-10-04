import { describe, expect, it } from 'vitest'

import type { ParamDef } from '@/core/types'
import { resolveOverflowHiddenIds } from '@/components/ui/overflowLayout'
import { isPrimarySelectorParam, resolveToolbarParamPriority, TOOLBAR_OVERFLOW_PRIORITY } from './parameterOrder'

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

describe('生成底栏收纳优先级（任务 5.3）', () => {
  const switchParam = { id: 'audio', type: 'switch', order: 2, name: { zh: '生成音频', en: 'Audio' }, default: true } as ParamDef
  const durationParam = dropdownParam('duration', '时长', 'Duration')

  it('开关比取值参数先收，比例/分辨率合并面板最后收', () => {
    expect(resolveToolbarParamPriority(switchParam)).toBeLessThan(resolveToolbarParamPriority(durationParam))
    expect(resolveToolbarParamPriority(durationParam)).toBeLessThan(TOOLBAR_OVERFLOW_PRIORITY.special)
  })

  it('排在前面的开关在空间不足时先于后面的时长收进“更多参数”', () => {
    const items = [
      { id: 'leading', priority: TOOLBAR_OVERFLOW_PRIORITY.leading, pinned: true },
      { id: 'special', priority: TOOLBAR_OVERFLOW_PRIORITY.special },
      { id: 'audio', priority: resolveToolbarParamPriority(switchParam) },
      { id: 'duration', priority: resolveToolbarParamPriority(durationParam) },
    ]
    const widths = new Map([['leading', 160], ['special', 150], ['audio', 110], ['duration', 90]])
    // 放得下 模型 + 比例/分辨率 + 时长 + “更多参数”，放不下开关
    expect(resolveOverflowHiddenIds({ items, widths, available: 160 + 150 + 90 + 104 + 36, gap: 12, overflowWidth: 104 }))
      .toEqual(['audio'])
    // 再窄一些：时长也收起，合并面板仍留在底栏
    expect(resolveOverflowHiddenIds({ items, widths, available: 160 + 150 + 104 + 30, gap: 12, overflowWidth: 104 }))
      .toEqual(['audio', 'duration'])
  })
})
