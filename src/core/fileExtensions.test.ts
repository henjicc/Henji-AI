import { describe, expect, it } from 'vitest'

import {
  HENJI_FILE_TYPES, henjiDialogExtensions, matchHenjiExtension, stripHenjiExtension, usesLegacyHenjiExtension, type HenjiFileType,
} from './fileExtensions'

/** 常见软件已在用的后缀：自有后缀不得与之重复，避免系统按后缀打开或显示图标时混淆。 */
const FOREIGN_EXTENSIONS = [
  '.a', '.v', '.c', '.h', '.rec', '.vid', '.aud', '.img', '.pak', '.sty', '.tpl', '.fx', '.sub', '.mdl', '.prj', '.lyr', '.pre', '.web',
  '.hjson', '.hjs', '.hjm', '.hj',
]

const types = Object.entries(HENJI_FILE_TYPES) as Array<[string, HenjiFileType]>

describe('自有文件后缀登记表', () => {
  it('当前后缀统一为 .hj + 2～4 个小写字母', () => {
    for (const [id, type] of types) expect(type.extension, id).toMatch(/^\.hj[a-z]{2,4}$/)
  })

  it('当前后缀与旧后缀全表不重复', () => {
    const seen = new Map<string, string>()
    for (const [id, type] of types) {
      for (const extension of [type.extension, ...type.legacyExtensions]) {
        expect(extension, id).toBe(extension.toLowerCase())
        expect(seen.get(extension), `${id} 与 ${seen.get(extension)} 重复 ${extension}`).toBeUndefined()
        seen.set(extension, id)
      }
    }
  })

  it('不与常见软件的后缀冲突', () => {
    for (const [id, type] of types) expect(FOREIGN_EXTENSIONS, id).not.toContain(type.extension)
  })

  it('当前与旧后缀都能识别，不分大小写', () => {
    expect(matchHenjiExtension('video_edit', '成片.HJVID')).toBe('.hjvid')
    expect(matchHenjiExtension('video_edit', '成片.henji-video')).toBe('.henji-video')
    expect(matchHenjiExtension('video_edit', '.hjvid')).toBeNull()
    expect(matchHenjiExtension('video_edit', '成片.hjaud')).toBeNull()
    expect(stripHenjiExtension('canvas', '分镜.henji-canvas')).toBe('分镜')
    expect(usesLegacyHenjiExtension('canvas', '分镜.henji-canvas')).toBe(true)
    expect(usesLegacyHenjiExtension('canvas', '分镜.hjcvs')).toBe(false)
    expect(henjiDialogExtensions('style_package')).toEqual(['hjsty', 'henjistyle'])
  })
})
