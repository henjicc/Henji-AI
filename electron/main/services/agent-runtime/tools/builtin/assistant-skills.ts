import {
  loadAssistantSkillCapability,
} from '../../../../../../src/core/assistant/capabilities/assistantSkillApplicationCapabilities'
import { wrapSkillContent } from '../../../assistant/skills/content'
import { loadAssistantSkill } from '../../../assistant/skills/registry'
import { createBackendCapabilityTool } from '../backend-capability-tool'
import type { AgentToolDefinition } from '../types'

export function createAssistantSkillTools(): AgentToolDefinition[] {
  return [
    createBackendCapabilityTool(loadAssistantSkillCapability, {
      execute: async (input) => {
        const loaded = await loadAssistantSkill(input.name, input.path)
        return {
          name: loaded.name,
          source: loaded.source,
          path: loaded.path,
          // bytes 始终是技能原始内容的字节数，不含信任标记，便于模型判断内容规模。
          bytes: loaded.bytes,
          content: wrapSkillContent(loaded.name, loaded.source, loaded.path, loaded.content),
          referencePaths: loaded.referencePaths,
        }
      },
    }),
  ] as AgentToolDefinition[]
}
