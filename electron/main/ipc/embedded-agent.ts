import { z } from 'zod'
import { embeddedAgentPromptSchema } from '../../../src/core/assistant/embeddedAgent'
import { EmbeddedAgentService } from '../services/embedded-agent/service'
import { listEmbeddedModels } from '../services/embedded-agent/models'
import { assertTrustedApplicationSender } from './mcp'
import { parseVoid, registerIpcHandler } from './registry'

const service = new EmbeddedAgentService()
export function registerEmbeddedAgentIpc(): void {
  const guard = assertTrustedApplicationSender
  registerIpcHandler('embedded-agent:snapshot', parseVoid, () => service.snapshot(), guard)
  registerIpcHandler('embedded-agent:models', parseVoid, listEmbeddedModels, guard)
  registerIpcHandler('embedded-agent:prompt', (value) => embeddedAgentPromptSchema.parse(value), (input) => service.prompt(input), guard)
  registerIpcHandler('embedded-agent:cancel', parseVoid, () => service.cancel(), guard)
  registerIpcHandler('embedded-agent:new', parseVoid, () => service.navigate({ action: 'new' }), guard)
  registerIpcHandler('embedded-agent:sessions', parseVoid, () => service.navigate({ action: 'sessions' }), guard)
  registerIpcHandler('embedded-agent:open', (value) => z.string().uuid().parse(value), (id) => service.navigate({ action: 'open', input: id }), guard)
}
export function disposeEmbeddedAgent(): void { service.dispose() }
