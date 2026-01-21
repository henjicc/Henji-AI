/**
 * ConvertTypeNode - 类型转换节点
 */

import { defineToolNode } from '../../defineToolNode'

export const convertTypeNode = defineToolNode({
  type: 'convert-type',
  name: { zh: '类型转换', en: 'Convert Type' },
  description: { zh: '将值转换为指定类型', en: 'Convert value to specified type' },
  icon: 'convert',
  category: 'data-conversion',

  inputs: [
    {
      id: 'input',
      name: { zh: '输入值', en: 'Input Value' },
      type: 'any',
      required: true
    },
    {
      id: 'targetType',
      name: { zh: '目标类型', en: 'Target Type' },
      type: 'string',
      required: true,
      default: 'string'
    }
  ],

  outputs: [
    {
      id: 'output',
      name: { zh: '转换后值', en: 'Converted Value' },
      type: 'any'
    }
  ],

  execute: (inputs) => {
    const { input, targetType } = inputs

    switch (targetType) {
      case 'string':
        return { output: String(input) }
      case 'number':
        return { output: Number(input) }
      case 'boolean':
        return { output: Boolean(input) }
      default:
        return { output: input }
    }
  }
})
