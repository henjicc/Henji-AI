import { describe, expect, it } from 'vitest'

import type { ParamDef } from '@/core/types'

import { validateModelParamConventions } from './modelParamConventionValidator'

const channelParam: ParamDef = {
  id: 'providerChannel',
  type: 'dropdown',
  order: 1,
  name: { key: 'params.fields.apiChannel', absolute: true },
  default: 'regular',
  options: [
    { value: 'regular', label: { key: 'params.options.regular', absolute: true } },
    { value: 'official', label: { key: 'params.options.official', absolute: true } },
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

  it('拒绝没有严格排在所有参数之前的渠道选择', () => {
    expect(() => validate([
      { ...channelParam, order: 2 },
      { ...resolutionParam, order: 1 },
    ])).toThrow('Channel param must be ordered before every other param')
  })

  it('拒绝绕过共享“普通 / 官方”文案的渠道选项', () => {
    expect(() => validate([{
      ...channelParam,
      options: [
        { value: 'regular', label: { zh: '普通接口', en: 'Standard' } },
        { value: 'official', label: { zh: '官方接口', en: 'Official' } },
      ],
    }, resolutionParam])).toThrow('Channel param options must use shared Regular and Official labels')
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
})
