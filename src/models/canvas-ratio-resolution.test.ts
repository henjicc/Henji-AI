import { describe, expect, it } from 'vitest'

const modelSources = import.meta.glob('/src/models/**/*.model.ts', {
  eager: true,
  import: 'default',
  query: '?raw',
}) as Record<string, string>

describe('画布模型参数', () => {
  it('所有模型都将比例与分辨率声明为独立参数', () => {
    const compositeResolutionModels = Object.entries(modelSources)
      .filter(([, source]) =>
        /type:\s*'composite'[\s\S]*?panel:\s*'resolution'/.test(source)
      )
      .map(([file]) => file.replace('/src/models/', ''))

    expect(compositeResolutionModels).toEqual([])
  })
})
