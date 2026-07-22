import { describe, expect, it } from 'vitest'

import type { TextParamDef } from '@/core/types'
import {
  resolveTextParamPromptDocument,
  resolveTextParamPromptVariables,
  serializeTextParamPromptDocument,
} from './promptTextParam'

const param: TextParamDef = {
  id: 'template',
  type: 'textarea',
  order: 1,
  name: { zh: '模板', en: 'Template' },
  default: '',
  editor: {
    kind: 'prompt',
    preset: 'template-variables',
    variables: [{
      key: 'prompt',
      label: { zh: '当前提示词', en: 'Current prompt' },
      group: { zh: '输入', en: 'Input' },
    }],
  },
}

describe('prompt text param adapter', () => {
  it('由 schema 解析变量候选并保持字符串兼容输出', () => {
    const variables = resolveTextParamPromptVariables(param, 'zh-CN')
    const document = resolveTextParamPromptDocument('优化 {{prompt}}', variables)

    expect(variables).toEqual([{ key: 'prompt', label: '当前提示词', group: '输入' }])
    expect(JSON.stringify(document)).toContain('templateVariable')
    expect(serializeTextParamPromptDocument(document)).toBe('优化 {{prompt}}')
  })
})
