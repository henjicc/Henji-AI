/**
 * PromptTemplateNode - 提示词模板节点
 */

import { defineToolNode } from '../../defineToolNode'

export const promptTemplateNode = defineToolNode({
  type: 'prompt-template',
  name: { zh: '提示词模板', en: 'Prompt Template' },
  description: {
    zh: '使用模板生成提示词，支持变量替换',
    en: 'Generate prompt using template with variable substitution'
  },
  icon: 'template',
  category: 'text-processing',

  inputs: [
    {
      id: 'template',
      name: { zh: '模板', en: 'Template' },
      type: 'string',
      required: true,
      default: '一个{{subject}}，{{style}}风格，{{details}}'
    },
    {
      id: 'variables',
      name: { zh: '变量', en: 'Variables' },
      type: 'object',
      required: false,
      default: {}
    }
  ],

  outputs: [
    {
      id: 'output',
      name: { zh: '生成的提示词', en: 'Generated Prompt' },
      type: 'string'
    }
  ],

  execute: (inputs) => {
    const { template, variables = {} } = inputs
    let result = template

    // 简单的变量替换
    for (const [key, value] of Object.entries(variables)) {
      result = result.replace(new RegExp(`{{${key}}}`, 'g'), String(value))
    }

    return { output: result }
  }
})
