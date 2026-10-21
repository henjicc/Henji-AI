import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { BUILTIN_APPLICATION_CAPABILITY_REGISTRY } from '../../builtinApplicationCapabilityRegistry'
import { COLOR_GRADE_STYLES } from '../../../imaging/adjustments/colorGradeStyles'
import { COLOR_GRADE_PARAMS } from '../../../imaging/adjustments/colorGrade'
import { normalizeVideoEditBuiltinParams } from '../../../videoEdit/builtinEffects'
import { imageColorGradeParamsSchema } from '../../../imaging/adjustments/schema'

const directory = path.resolve('resources/assistant-skills/color-grading')
const skill = fs.readFileSync(path.join(directory, 'SKILL.md'), 'utf8')
const styles = fs.readFileSync(path.join(directory, 'references/styles.md'), 'utf8')

describe('调色技能只引用真实契约', () => {
  it('提到的工具都在正式能力目录里，参数名都在全能调色参数里', () => {
    const ids = new Set(BUILTIN_APPLICATION_CAPABILITY_REGISTRY.list().map(definition => definition.id))
    const tools = [...skill.matchAll(/`((?:observe|analyze)_[a-z_]+)`/g)].map(match => match[1])
    expect(tools.length).toBeGreaterThan(3)
    expect(tools.filter(tool => !ids.has(tool))).toEqual([])
    const keys = new Set(COLOR_GRADE_PARAMS.map(param => param.key))
    const mentioned = [...skill.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)].map(match => match[1]).filter(name => !ids.has(name) && !name.includes('application') && !/^(video_edit|image_edit|definition_id|frame_curves|stage|key|matchMethod)/.test(name))
    expect(mentioned.filter(name => !name.endsWith('_') && !keys.has(name) && !/^(before_grade|after_grade|hue_offset)/.test(name) && !name.endsWith('_percent'))).toEqual([])
  })
  it('风格词典与代码数据一致，每个配方在剪辑与图片参数校验中都合法', () => {
    const recipes = [...styles.matchAll(/```json\r?\n(.+?)\r?\n```/g)].map(match => JSON.parse(match[1]) as { id: string; params: Record<string, number> })
    expect(recipes).toEqual(COLOR_GRADE_STYLES.map(style => ({ id: style.id, params: style.params })))
    for (const style of COLOR_GRADE_STYLES) {
      expect(() => normalizeVideoEditBuiltinParams('color_grade', style.params), style.id).not.toThrow()
      expect(imageColorGradeParamsSchema.safeParse(style.params).success, style.id).toBe(true)
      expect(Object.keys(style.params).filter(key => ['temperature_kelvin', 'tint', 'exposure'].includes(key)), style.id).toEqual([])
    }
  })
})
