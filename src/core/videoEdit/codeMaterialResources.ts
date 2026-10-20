import type { CodeMaterialInstance } from './codeMaterialPersistence'
import { isCodeImageReference, isCodeAudioReference } from './codeMaterial/contract'
import type { CodeExpression, CodeMaterialProgram } from './codeMaterial/contract'
import { codeExpressionChildren } from './codeMaterial/filterFrameExpressions'
import type { CodeAuthorProgram } from './codeAuthorProgram'

export function codeMaterialUsesAudio(program: CodeMaterialProgram | CodeAuthorProgram): boolean {
  if ('bundle' in program) return program.parameters.some(parameter => parameter.type === 'audio')
  const uses = (value: CodeExpression): boolean => value.kind === 'v3call' && value.op.startsWith('audio.') || codeExpressionChildren(value).some(uses)
  return uses(program.result) || program.bindings.some(binding => uses(binding.expression))
}

/** Reference identities only: author code never receives media paths or assets. */
export function codeMaterialImageIds(instance?: CodeMaterialInstance): Set<string> {
  return new Set(Object.values(instance?.parameters ?? {}).flatMap(value => isCodeImageReference(value) && value.kind !== 'sequence' ? [value.mediaId] : []))
}

export function codeMaterialMediaIds(instance?: CodeMaterialInstance): Set<string> {
  return new Set([...codeMaterialImageIds(instance), ...Object.values(instance?.parameters ?? {}).flatMap(value => isCodeAudioReference(value) ? [value.mediaId] : [])])
}
