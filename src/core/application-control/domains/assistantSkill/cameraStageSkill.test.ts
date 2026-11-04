import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { BUILTIN_APPLICATION_CAPABILITY_REGISTRY } from '../../builtinApplicationCapabilityRegistry'
import { cameraStageSetLayoutSchema } from '../cameraStage/cameraStageSetSchemas'
import { CAMERA_STAGE_EDIT_RULES } from '../cameraStage/cameraStageCoverageSchemas'

const skillDirectory = path.resolve('resources/assistant-skills/三维镜头构图')
const skill = fs.readFileSync(path.join(skillDirectory, 'SKILL.md'), 'utf8')
const referencePaths = fs.readdirSync(path.join(skillDirectory, 'references')).map((name) => `references/${name}`).sort()
const references = referencePaths.map((relativePath) => ({ relativePath, content: fs.readFileSync(path.join(skillDirectory, relativePath), 'utf8').replace(/\r\n/g, '\n') }))
const all = [skill, ...references.map((file) => file.content)].join('\n')

// 这份技能曾在能力删除后继续教 run_henji_script；提到的每个工具和布景参数都必须真实存在。
describe('三维镜头构图技能只引用真实契约', () => {
  it('提到的能力都在正式目录里', () => {
    const ids = new Set(BUILTIN_APPLICATION_CAPABILITY_REGISTRY.list().map(definition => definition.id))
    const generic = new Set(['list_documents', 'change_application_entities', 'list_application_entities', 'load_assistant_skill', 'create_items', 'remove_items', ...CAMERA_STAGE_EDIT_RULES])
    const tools = [...all.matchAll(/`([a-z]+(?:_[a-z]+){2,})`/g)].map(match => match[1])
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

  // 导演思维参考里的调用样例是助手照抄的模板，参数名写错会直接变成失败的调用。
  it('每份 JSON 调用样例都过对应能力的正式输入 schema，参考文件都从主文件链出', () => {
    const examples = references.flatMap((file) => [...file.content.matchAll(/```json\n([\s\S]*?)```/g)].map((match) => ({ file: file.relativePath, raw: match[1] })))
    expect(examples.length).toBeGreaterThan(4)
    for (const example of examples) {
      const call = JSON.parse(example.raw) as { tool: string; input: unknown }
      expect(Object.keys(call).sort(), example.file).toEqual(['input', 'tool'])
      const definition = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get(call.tool)
      expect(definition, `${example.file}: ${call.tool}`).toBeDefined()
      const result = definition!.inputSchema.safeParse(call.input)
      expect(result.success, `${example.file}: ${JSON.stringify(result.success ? null : result.error.issues)}`).toBe(true)
    }
    expect([...skill.matchAll(/\]\((references\/[^)]+)\)/g)].map((match) => match[1]).sort()).toEqual(referencePaths)
    for (const file of references) expect(file.content, file.relativePath).toMatch(/^# .+\n\n> 何时读：/)
  })
})
