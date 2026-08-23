// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest'

import { registry } from '@/core/ModelRegistry'
import { loadRealModelsIntoRegistry } from '@/tests/loadRealModels'

function labelText(value: unknown): string {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return ''
  return Object.values(value).filter((item): item is string => typeof item === 'string').join(' ')
}

describe('模型媒体上传策略', () => {
  beforeAll(async () => {
    await loadRealModelsIntoRegistry()
  })

  it('参数面板不暴露媒体或文件 URL 文本输入框', () => {
    const violations = registry.listAllModels().flatMap((model) => model.params
      .filter((param) => param.type === 'text' || param.type === 'textarea')
      .filter((param) => {
        const placeholder = 'placeholder' in param ? param.placeholder : undefined
        const searchable = [param.id, param.apiField, labelText(param.name), labelText(placeholder)]
          .filter(Boolean)
          .join(' ')
        return /(^|[^a-z])(url|uri)([^a-z]|$)|链接|网址/iu.test(searchable)
      })
      .map((param) => `${model.meta.id}:${param.id}`))

    expect(violations, '媒体/文件 URL 必须改为 image-upload、video-upload 或 file-upload').toEqual([])
  })

  it('上传参数使用数组默认值，保证对话面板与画布共享同一值结构', () => {
    const violations = registry.listAllModels().flatMap((model) => model.params
      .filter((param) => ['image-upload', 'video-upload', 'file-upload'].includes(param.type))
      .filter((param) => !Array.isArray(param.default))
      .map((param) => `${model.meta.id}:${param.id}`))

    expect(violations).toEqual([])
  })
})
