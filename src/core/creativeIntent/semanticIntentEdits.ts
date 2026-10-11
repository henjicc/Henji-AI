import { z } from 'zod'
import type { ApplicationRef } from '../application-control/identifiers'
import type { ApplicationExecutionContext } from '../application-control/execution/types'
import { explanationSessionSchema, type ExplanationSession } from './schema'

export const explanationTextEditsSchema = z.array(z.object({ eventId: z.string().min(1), text: z.string() }).strict())
export const explanationBindingsSchema = explanationSessionSchema.shape.bindings
export function sameExplanationBinding(left: ExplanationSession['bindings'][number], right: ExplanationSession['bindings'][number]): boolean {
  return JSON.stringify(explanationBindingsSchema.element.parse(left)) === JSON.stringify(explanationBindingsSchema.element.parse(right))
}
export type ExplanationBodyChanges = { text?: z.infer<typeof explanationTextEditsSchema>; bindings?: ExplanationSession['bindings'] }
export interface ExplanationBodyEditor {
  apply(changes: ExplanationBodyChanges, context?: ApplicationExecutionContext): Promise<void>
  restore(session: ExplanationSession, context?: ApplicationExecutionContext): Promise<void>
}
const editors = new Map<string, ExplanationBodyEditor>()
const erasedListeners = new Set<(ref: ApplicationRef) => void>()
const key = (ref: ApplicationRef) => `${ref.kind}:${ref.id}`
export function explanationBodyRef(document: ApplicationRef, sessionId: string): ApplicationRef {
  return { kind: `${document.kind.split('.')[0]}.explanation_body`, id: `${document.id}:${encodeURIComponent(sessionId)}` }
}
export function registerExplanationBodyEditor(ref: ApplicationRef, editor: ExplanationBodyEditor): () => void {
  editors.set(key(ref), editor)
  return () => { if (editors.get(key(ref)) === editor) editors.delete(key(ref)) }
}
export function explanationBodyEditor(ref: ApplicationRef): ExplanationBodyEditor {
  const editor = editors.get(key(ref))
  if (!editor) throw new Error('请先在原作品打开这段讲解。')
  return editor
}
export function hasExplanationBodyEditor(ref: ApplicationRef): boolean { return editors.has(key(ref)) }
export function onExplanationBodyErased(listener: (ref: ApplicationRef) => void): void { erasedListeners.add(listener) }
export function eraseExplanationBody(ref: ApplicationRef): void {
  editors.delete(key(ref))
  for (const listener of erasedListeners) listener(ref)
}
type WriteBody = (ref: ApplicationRef, changes: ExplanationBodyChanges) => Promise<void>
let writeBody: WriteBody | undefined
export function registerExplanationBodyWriter(write: WriteBody): void { writeBody = write }
/** UI and assistants both use the registered generic transaction. */
export function writeExplanationBody(ref: ApplicationRef, changes: ExplanationBodyChanges): Promise<void> {
  if (!writeBody) throw new Error('讲解编辑尚未就绪，请稍后重试。')
  return writeBody(ref, changes)
}
