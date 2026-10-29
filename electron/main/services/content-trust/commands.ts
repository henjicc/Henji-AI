import type { ContentTrustCommand, ContentTrustCheck } from '../../../../src/core/contentTrust'
import { contentTrust } from './runtime'

export async function prepareForeignContent(sourceType: 'web_recording' | 'skill', id: string) {
  if (sourceType === 'web_recording') {
    const { resolveWebRecordingDirectory } = await import('../web-replay/locations')
    const { WebRecordingStore } = await import('../web-replay/store')
    const manifest = await new WebRecordingStore(await resolveWebRecordingDirectory(id)).readManifest()
    return manifest.foreign ? [manifest.foreign] : []
  }
  const { listAssistantSkills } = await import('../assistant/skills/registry')
  return (await listAssistantSkills()).skills.filter(skill => skill.name === id).flatMap(skill => skill.foreign ? [skill.foreign] : [])
}
export async function executeContentTrust(command: ContentTrustCommand): Promise<ContentTrustCheck> {
  const service = contentTrust()
  switch (command.action) {
    case 'prepare': return service.check({ contents: await prepareForeignContent(command.sourceType, command.id) })
    case 'check': return service.check(command.query)
    case 'policy': return { records: [], state: 'allowed', allowExternalContentCode: service.policy() }
    case 'set-policy': return service.setPolicy(command.allow)
    case 'decide': return service.decide(command.challenge, command.decision)
    case 'retry': return service.retry(command.records)
  }
}
