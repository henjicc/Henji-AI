import { describe, expect, it } from 'vitest'
import { selectProjectCoverSources, type ProjectCoverSourceDto } from './project-cover-layout'

function sources(count: number): ProjectCoverSourceDto[] {
  return Array.from({ length: count }, (_item, index) => ({
    source: `image-${index + 1}`,
    sourceKind: 'image',
  }))
}

describe('selectProjectCoverSources', () => {
  it.each([
    { inputCount: 1, expected: ['image-1'] },
    { inputCount: 2, expected: ['image-1', 'image-2'] },
    { inputCount: 3, expected: ['image-1', 'image-2'] },
    { inputCount: 4, expected: ['image-1', 'image-2', 'image-3', 'image-4'] },
  ])('$inputCount 张图按产品规则选取', ({ inputCount, expected }) => {
    expect(selectProjectCoverSources(sources(inputCount)).map((item) => item.source)).toEqual(expected)
  })
})
