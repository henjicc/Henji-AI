import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const modelFiles = [
  'seedance-2.0.model.ts',
  'seedance-2.0-fast.model.ts',
  'seedance-2.0-mini.model.ts',
]

describe('KIE Seedance 2.0 音频默认值', () => {
  it.each(modelFiles)(
    '%s 仅在用户明确开启时生成音频',
    (fileName) => {
      const source = readFileSync(resolve(__dirname, fileName), 'utf8')
      const audioParameter = /id:\s*'[^']*GenerateAudio'[\s\S]*?default:\s*(true|false)/.exec(source)
      const builderFallback = /const generateAudio\s*=\s*([^\r\n]+)/.exec(source)

      expect(audioParameter?.[1]).toBe('false')
      expect(builderFallback?.[1]).toMatch(/===\s*true\s*$/)
      expect(builderFallback?.[1]).not.toContain('?')
    }
  )
})
