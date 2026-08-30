import fs from 'node:fs'

import { describe, expect, it } from 'vitest'

const manifest = JSON.parse(
  fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as {
  exports: Record<string, Record<string, string>>
  files: string[]
}

describe('published package exports', () => {
  it('固定入口与按需通配入口都只指向随包发布的 dist 文件', () => {
    expect(Object.keys(manifest.exports)).toEqual([
      '.',
      './providers',
      './generation',
      './generation/core',
      './models/*',
      './provider-adapters/*',
      './provider-packs/*',
      './tool-models/*',
      './tool-packs/*',
      './catalog',
      './pricing',
      './llm',
      './llm/streaming',
      './llm/groq',
      './llm/bigmodel',
      './llm/modules',
      './runtime',
      './capabilities',
      './capabilities/speech-recognition',
      './capabilities/speech-recognition/bailian',
      './capabilities/speech-recognition/bailian/realtime',
      './capabilities/speech-recognition/volcengine',
      './capabilities/speech-recognition/volcengine/realtime',
      './capabilities/speech-recognition/siliconflow',
      './capabilities/speech-recognition/groq',
      './capabilities/translation',
      './capabilities/translation/bailian',
      './capabilities/realtime',
      './discovery',
    ])
    for (const conditions of Object.values(manifest.exports)) {
      expect(conditions).not.toHaveProperty('development')
      expect(Object.values(conditions).every((target) => target.startsWith('./dist/'))).toBe(true)
    }
    expect(manifest.files).toContain('dist')
  })
})
