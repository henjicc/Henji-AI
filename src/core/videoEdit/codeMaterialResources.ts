import type { CodeMaterialInstance } from './codeMaterialPersistence'
import { isCodeImageReference, isCodeAudioReference } from './codeMaterial/contract'
import type { CodeAuthorProgram } from './codeAuthorProgram'

export function codeMaterialUsesAudio(program: CodeAuthorProgram): boolean {
  return program.parameters.some(parameter => parameter.type === 'audio')
}
/** Reference identities only: author code never receives media paths or assets. */
export function codeMaterialImageIds(instance?: CodeMaterialInstance): Set<string> {
  return new Set(Object.values(instance?.parameters ?? {}).flatMap(value => isCodeImageReference(value) && value.kind !== 'sequence' ? [value.mediaId] : []))
}

export function codeMaterialMediaIds(instance?: CodeMaterialInstance): Set<string> {
  return new Set([...codeMaterialImageIds(instance), ...Object.values(instance?.parameters ?? {}).flatMap(value => isCodeAudioReference(value) ? [value.mediaId] : [])])
}
