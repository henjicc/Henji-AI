import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { BUILTIN_APPLICATION_CAPABILITY_REGISTRY } from '../../builtinApplicationCapabilityRegistry'
import { createAudioEditReflectionRegistrations } from '../../../../features/audioEdit/application/audioEditReflection'
import { PROTOCOL_TOOL_SPECS } from '../../../../../electron/main/services/application-runtime/toolCatalog'
import { AGENT_SKILL_NAMES } from '../../../../../electron/main/services/assistant/skills/agentSkills'

const content = fs.readFileSync(path.resolve('resources/assistant-skills/audio-edit-workbench/SKILL.md'), 'utf8')
const registrations = createAudioEditReflectionRegistrations()
const knownNames = new Set([...BUILTIN_APPLICATION_CAPABILITY_REGISTRY.list().map((definition) => definition.id), ...PROTOCOL_TOOL_SPECS.map((spec) => spec.name)])
const entityIds = new Set(registrations.map((registration) => registration.entity.id))
const propertyIds = new Set(registrations.flatMap((registration) => registration.properties.map((property) => property.id)))

describe('口播剪辑技能与正式目录一致', () => {
  it('已准入智能体，正文提到的工具、实体与属性都来自正式目录', () => {
    expect(AGENT_SKILL_NAMES.has('audio-edit-workbench')).toBe(true)
    const names = [...new Set([...content.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)].map((match) => match[1]))]
    expect(names.filter((name) => !knownNames.has(name))).toEqual([])
    const ids = [...new Set([...content.matchAll(/\baudio_edit\.[a-z_]+(?:\.[a-z_]+)?/g)].map((match) => match[0]))]
    expect(ids.filter((id) => !entityIds.has(id) && !propertyIds.has(id))).toEqual([])
  })

  it('全自动流程按顺序覆盖导入、转写、去重念、停顿与字幕', () => {
    const order = ['create_document', 'import_audio_edit_source', 'transcribe_audio_edit', 'clean_audio_edit_retakes', 'compress_audio_edit_silence', 'format_audio_edit_subtitles']
    const positions = order.map((name) => content.indexOf(`\`${name}\``))
    expect(positions.every((position) => position >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })
})
