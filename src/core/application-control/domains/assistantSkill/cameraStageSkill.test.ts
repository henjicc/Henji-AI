import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { BUILTIN_APPLICATION_CAPABILITY_REGISTRY } from '../../builtinApplicationCapabilityRegistry'
import { cameraStageSetLayoutSchema } from '../cameraStage/cameraStageSetSchemas'

const skill = fs.readFileSync(path.resolve('resources/assistant-skills/三维镜头构图/SKILL.md'), 'utf8')

// 这份技能曾在能力删除后继续教 run_henji_script；提到的每个工具和布景参数都必须真实存在。
describe('三维镜头构图技能只引用真实契约', () => {
  it('提到的能力都在正式目录里', () => {
    const ids = new Set(BUILTIN_APPLICATION_CAPABILITY_REGISTRY.list().map(definition => definition.id))
    const generic = new Set(['list_documents', 'change_application_entities', 'list_application_entities'])
    const tools = [...skill.matchAll(/`([a-z]+(?:_[a-z]+){2,})`/g)].map(match => match[1])
      .filter(name => !name.startsWith('camera_stage'))
    expect(tools).toContain('generate_camera_stage_set')
    expect(tools.filter(tool => !ids.has(tool) && !generic.has(tool))).toEqual([])
  })

  it('布景参数表里的预设与字段都是 layout 的合法字段', () => {
    const rows = [...skill.matchAll(/^\| `([a-z]+)` [^|]+\| (.+) \|$/gm)]
    expect(rows.map(row => row[1])).toEqual(cameraStageSetLayoutSchema.options.map(option => option.shape.preset.value))
    for (const row of rows) {
      const [, preset, fields] = row
      const option = cameraStageSetLayoutSchema.options.find(candidate => candidate.shape.preset.value === preset)
      expect(option, preset).toBeDefined()
      for (const [, field] of fields.matchAll(/`([a-zA-Z]+)`/g)) {
        expect(Object.keys(option!.shape), `${preset}.${field}`).toContain(field)
      }
    }
  })
})
