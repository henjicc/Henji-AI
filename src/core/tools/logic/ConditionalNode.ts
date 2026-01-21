/**
 * ConditionalNode - 条件分支节点
 */

import { defineToolNode } from '../../defineToolNode'

export const conditionalNode = defineToolNode({
  type: 'conditional',
  name: { zh: '条件分支', en: 'Conditional' },
  description: {
    zh: '根据条件选择不同的输出',
    en: 'Choose output based on condition'
  },
  icon: 'branch',
  category: 'logic-control',

  inputs: [
    {
      id: 'condition',
      name: { zh: '条件', en: 'Condition' },
      type: 'boolean',
      required: true
    },
    {
      id: 'trueValue',
      name: { zh: '真值输出', en: 'True Value' },
      type: 'any',
      required: true
    },
    {
      id: 'falseValue',
      name: { zh: '假值输出', en: 'False Value' },
      type: 'any',
      required: true
    }
  ],

  outputs: [
    {
      id: 'output',
      name: { zh: '输出', en: 'Output' },
      type: 'any'
    }
  ],

  execute: (inputs) => {
    const { condition, trueValue, falseValue } = inputs
    return { output: condition ? trueValue : falseValue }
  }
})
