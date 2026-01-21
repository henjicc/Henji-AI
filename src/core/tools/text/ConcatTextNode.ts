/**
 * ConcatTextNode - 文本拼接节点
 */

import { defineToolNode } from '../../defineToolNode'

export const concatTextNode = defineToolNode({
  type: 'text-concat',
  name: { zh: '文本拼接', en: 'Concatenate Text' },
  description: { zh: '将多个文本拼接成一个', en: 'Concatenate multiple texts into one' },
  icon: 'concat',
  category: 'text-processing',

  inputs: [
    {
      id: 'texts',
      name: { zh: '文本列表', en: 'Text List' },
      type: 'array',
      required: true,
      default: []
    },
    {
      id: 'separator',
      name: { zh: '分隔符', en: 'Separator' },
      type: 'string',
      required: false,
      default: ', '
    }
  ],

  outputs: [
    {
      id: 'output',
      name: { zh: '拼接结果', en: 'Concatenated Text' },
      type: 'string'
    }
  ],

  execute: (inputs) => {
    const { texts, separator = ', ' } = inputs
    return { output: texts.join(separator) }
  }
})
