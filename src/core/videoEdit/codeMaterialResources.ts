import type { CodeMaterialInstance } from './codeMaterialPersistence'
import { isCodeImageReference } from './codeMaterial/contract'

/** Reference identities only: author code never receives media paths or assets. */
export function codeMaterialImageIds(instance?: CodeMaterialInstance): Set<string> {
  return new Set(Object.values(instance?.parameters ?? {}).flatMap(value => isCodeImageReference(value) ? [value.mediaId] : []))
}
