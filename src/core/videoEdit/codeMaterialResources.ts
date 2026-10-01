import type { CodeMaterialInstance } from './codeMaterialPersistence'

/** Reference identities only: author code never receives media paths or assets. */
export function codeMaterialImageIds(instance?: CodeMaterialInstance): Set<string> {
  return new Set(Object.values(instance?.parameters ?? {}).flatMap(value => value !== null && typeof value === 'object' && !Array.isArray(value) && value.kind === 'image' ? [value.mediaId] : []))
}
