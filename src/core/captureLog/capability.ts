import { applicationRefSchema } from '../application-control/identifiers'
import type { ApplicationCapabilityDefinition } from '../application-control/applicationCapabilities'
import type { CapabilityCapture } from './events'

export function capabilityCaptureTargets(definition: ApplicationCapabilityDefinition, input: unknown): CapabilityCapture['targets'] {
  const refs: CapabilityCapture['targets'] = []
  const visit = (value: unknown, referenceField = false): void => {
    if (Array.isArray(value)) { value.forEach(item => visit(item, referenceField)); return }
    if (!value || typeof value !== 'object') return
    const parsed = referenceField ? applicationRefSchema.safeParse(value) : undefined
    if (parsed?.success) { refs.push({ kind: parsed.data.kind, id: parsed.data.id }); return }
    for (const [key, child] of Object.entries(value)) {
      // Free-form content can happen to look like an ApplicationRef; it is never a capture target.
      if (['value', 'properties', 'parameters', 'content', 'source', 'files'].includes(key)) continue
      visit(child, /^(ref|refs|parent|target)$|Refs?$/.test(key))
    }
  }
  visit(input)
  return (definition.resolveOperationTargets?.(input) ?? refs).map(({ kind, id }) => ({ kind, id }))
}

let sink: ((fact: CapabilityCapture) => void) | undefined
/** Host injection only; callback closes over one recording session, so late completions cannot enter another. */
export function bindCaptureCapabilitySink(listener: (fact: CapabilityCapture) => void): () => void {
  sink = listener
  return () => { if (sink === listener) sink = undefined }
}
export function beginHostCapabilityCapture(definition: ApplicationCapabilityDefinition, input: unknown, id: () => string): (phase: CapabilityCapture['phase']) => void {
  const captured = sink
  if (!captured) return () => undefined
  const fact = { callId: id(), capability: definition.id, targets: capabilityCaptureTargets(definition, input) }
  captured({ ...fact, phase: 'started' })
  return phase => captured({ ...fact, phase })
}
