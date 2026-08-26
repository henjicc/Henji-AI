import { describe, expect, it } from 'vitest'

import type { ParamDef } from '@/core/types'

import { validateModelParamConventions } from './modelParamConventionValidator'

const channelParam: ParamDef = {
  id: 'providerChannel',
  type: 'dropdown',
  order: 1,
  role: 'channel',
  name: { key: 'params.fields.apiChannel', absolute: true },
  default: 'regular',
  options: [
    { value: 'regular', label: { key: 'params.options.regular', absolute: true } },
    { value: 'official', label: { key: 'params.options.official', absolute: true } },
  ],
}

/** 渠道多于两档：字段名仍走共享词表，选项是供应商自己的产品叫法。 */
const customChannelParam: ParamDef = {
  id: 'grsaiChannel',
  type: 'dropdown',
  order: 1,
  role: 'channel',
  name: { key: 'params.fields.apiChannel', absolute: true },
  default: 'standard',
  options: [
    { value: 'standard', label: { zh: '标准', en: 'Standard' } },
    { value: 'cl-2k', label: { zh: 'CL · 2K', en: 'CL · 2K' } },
    { value: 'cl-4k', label: { zh: 'CL · 4K', en: 'CL · 4K' } },
  ],
}

const resolutionParam: ParamDef = {
  id: 'resolution',
  type: 'dropdown',
  order: 2,
  name: { key: 'params.fields.resolution', absolute: true },
  default: '1k',
  options: [{ value: '1k', label: '1K' }],
}

function validate(params: ParamDef[]): void {
  validateModelParamConventions({ params }, (message) => {
    throw new Error(message)
  })
}

describe('模型共享参数约定', () => {
  it('接受首位的“普通 / 官方”渠道选择', () => {
    expect(() => validate([channelParam, resolutionParam])).not.toThrow()
  })

  it('接受首位的多档自定义选项渠道', () => {
    expect(() => validate([customChannelParam, resolutionParam])).not.toThrow()
  })

  it('拒绝没有严格排在所有参数之前的渠道选择', () => {
    expect(() => validate([
      { ...channelParam, order: 2 },
      { ...resolutionParam, order: 1 },
    ])).toThrow('Channel param must be ordered before every other param')
  })

  it('多档渠道同样要求排在所有参数之前', () => {
    expect(() => validate([
      { ...customChannelParam, order: 2 },
      { ...resolutionParam, order: 1 },
    ])).toThrow('Channel param must be ordered before every other param')
  })

  it('不再约束渠道选项文案：选项是供应商自己的产品叫法', () => {
    expect(() => validate([{
      ...channelParam,
      options: [
        { value: 'vt', label: { zh: 'VT（备用线路）', en: 'VT (Backup)' } },
        { value: '4k-vip', label: { zh: 'VIP · 4K', en: 'VIP · 4K' } },
      ],
    }, resolutionParam])).not.toThrow()
  })

  it('拒绝把渠道收进展示分组或高级面板', () => {
    expect(() => validateModelParamConventions({
      params: [channelParam, resolutionParam],
      paramPresentation: {
        groups: [{
          id: 'advanced',
          name: { zh: '高级', en: 'Advanced' },
          order: 1,
          sections: [{
            id: 'advanced-channel',
            name: { zh: '高级', en: 'Advanced' },
            paramIds: ['providerChannel'],
          }],
        }],
      },
    }, (message) => {
      throw new Error(message)
    })).toThrow('Channel param must remain a top-level param')
  })

  it('拒绝用了共享渠道词表却没声明 role 的参数', () => {
    const { role: _role, ...withoutRole } = channelParam
    expect(() => validate([withoutRole as ParamDef, resolutionParam]))
      .toThrow("Param using the shared Channel label must declare role 'channel'")
  })

  it('拒绝名字叫“渠道”却没声明 role 的顶层选择器', () => {
    expect(() => validate([
      { ...customChannelParam, role: undefined, name: { zh: '渠道', en: 'Channel' } },
      resolutionParam,
    ])).toThrow("Param named \"渠道\" must declare role 'channel'")
  })

  it('拒绝声明了渠道 role 却自己另写字段名的参数', () => {
    expect(() => validate([
      { ...customChannelParam, name: { zh: '接入点', en: 'Access Point' } },
      resolutionParam,
    ])).toThrow("Channel param must use sharedFieldText('apiChannel') as its name")
  })

  it.each(['模式', '版本', '变体'])('拒绝名字叫“%s”却没声明 role 的顶层选择器', (zh) => {
    expect(() => validate([
      {
        id: 'someSelector',
        type: 'dropdown',
        order: 1,
        name: { zh, en: 'Selector' },
        default: 'a',
        options: [{ value: 'a', label: 'A' }],
      },
      resolutionParam,
    ])).toThrow(`Param named "${zh}" must declare role 'mode'`)
  })

  it('模式类主选择器不要求排在所有参数之前', () => {
    expect(() => validate([
      { ...resolutionParam, order: 1 },
      {
        id: 'audioSpec',
        type: 'dropdown',
        order: 5,
        role: 'mode',
        name: { zh: '版本', en: 'Version' },
        default: 'hd',
        options: [{ value: 'hd', label: 'HD' }],
      },
    ])).not.toThrow()
  })

  it('展示分组内名字近似的参数不被要求声明 role', () => {
    expect(() => validateModelParamConventions({
      params: [
        {
          id: 'advancedMode',
          type: 'dropdown',
          order: 2,
          name: { zh: '模式', en: 'Mode' },
          default: 'a',
          options: [{ value: 'a', label: 'A' }],
        },
        { ...resolutionParam, order: 1 },
      ],
      paramPresentation: {
        groups: [{
          id: 'advanced',
          name: { zh: '高级', en: 'Advanced' },
          order: 1,
          sections: [{
            id: 'advanced-mode',
            name: { zh: '高级', en: 'Advanced' },
            paramIds: ['advancedMode'],
          }],
        }],
      },
    }, (message) => {
      throw new Error(message)
    })).not.toThrow()
  })
})
