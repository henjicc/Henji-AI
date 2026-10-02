import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  filterThirdPartyComponents,
  loadThirdPartyNotices,
  parseThirdPartyNotices,
} from './thirdPartyLicenses'

const raw = {
  formatVersion: 1,
  target: { platform: 'win32', arch: 'x64' },
  project: { name: '痕迹AI', version: '2.0.0', license: 'Apache-2.0', licenseTextId: 'tA' },
  highlights: ['runtime:ffmpeg'],
  components: [
    {
      id: 'runtime:ffmpeg', name: 'FFmpeg', version: '9.0.2', license: 'GPL-3.0-or-later', ecosystem: 'runtime',
      homepage: 'https://ffmpeg.org', textIds: ['tG'], textOrigin: 'package',
      sources: ['https://github.com/FFmpeg/FFmpeg'], includes: ['x264', 7],
    },
    { id: 'npm:react@18.3.1', name: 'react', version: '18.3.1', license: 'MIT', ecosystem: 'npm', homepage: null, textIds: ['tM'], textOrigin: 'package' },
    { id: 'cargo:serde@1.0.0', name: 'serde', version: '1.0.0', license: 'MIT OR Apache-2.0', ecosystem: 'cargo', homepage: 'https://serde.rs', textIds: [], textOrigin: 'weird' },
    { name: 'missing-id' },
  ],
  texts: { tA: 'Apache', tG: 'GPL', tM: 'MIT', bad: 3 },
}

describe('third-party notices', () => {
  it('校验并规范化构建产物，丢弃无法识别的条目与字段', () => {
    const notices = parseThirdPartyNotices(raw)
    expect(notices.project.license).toBe('Apache-2.0')
    expect(notices.components.map((item) => item.id)).toEqual(['runtime:ffmpeg', 'npm:react@18.3.1', 'cargo:serde@1.0.0'])
    expect(notices.components[0].includes).toEqual(['x264'])
    expect(notices.components[1].homepage).toBeNull()
    expect(notices.components[2].textOrigin).toBe('package')
    expect(notices.texts).toEqual({ tA: 'Apache', tG: 'GPL', tM: 'MIT' })
    expect(() => parseThirdPartyNotices({ components: [] })).toThrow()
  })

  it('按名称、版本或许可证搜索', () => {
    const { components } = parseThirdPartyNotices(raw)
    expect(filterThirdPartyComponents(components, 'GPL').map((item) => item.name)).toEqual(['FFmpeg'])
    expect(filterThirdPartyComponents(components, ' apache ').map((item) => item.name)).toEqual(['serde'])
    expect(filterThirdPartyComponents(components, '18.3').map((item) => item.name)).toEqual(['react'])
    expect(filterThirdPartyComponents(components, '')).toHaveLength(3)
  })

  it('清单缺失或格式错误时拒绝，由界面展示不可用状态', async () => {
    await expect(loadThirdPartyNotices({})).rejects.toThrow(/gen:licenses/)
    await expect(loadThirdPartyNotices({ a: async () => ({}) })).rejects.toThrow()
    await expect(loadThirdPartyNotices({ a: async () => raw })).resolves.toMatchObject({ highlights: ['runtime:ffmpeg'] })
  })

  // 构建产物（npm run gen:licenses）存在时，验证默认加载路径与真实清单结构一致。
  it.skipIf(!existsSync(resolve(process.cwd(), 'resources/licenses/third-party-licenses.json')))('默认路径加载真实生成的清单', async () => {
    const notices = await loadThirdPartyNotices()
    expect(notices.highlights).toContain('runtime:electron')
    expect(notices.texts[notices.project.licenseTextId]).toMatch(/Apache License/)
    for (const id of notices.highlights) expect(notices.components.some((item) => item.id === id)).toBe(true)
    for (const component of notices.components) {
      for (const textId of component.textIds) expect(notices.texts[textId], component.id).toBeTypeOf('string')
    }
  })
})
