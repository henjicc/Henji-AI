import fs from 'node:fs'

import { describe, expect, it } from 'vitest'

const manifest = JSON.parse(
  fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as {
  exports: Record<string, Record<string, string>>
  files: string[]
}

describe('published package exports', () => {
  it('六个入口都只指向随包发布的 dist 文件', () => {
    expect(Object.keys(manifest.exports)).toEqual([
      '.',
      './providers',
      './generation',
      './catalog',
      './llm',
      './runtime',
    ])
    for (const conditions of Object.values(manifest.exports)) {
      expect(conditions).not.toHaveProperty('development')
      expect(Object.values(conditions).every((target) => target.startsWith('./dist/'))).toBe(true)
    }
    expect(manifest.files).toContain('dist')
  })
})
