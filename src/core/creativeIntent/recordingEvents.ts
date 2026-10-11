import { commandEventSchema } from './schema'
import type { z } from 'zod'
type CommandEvent = z.infer<typeof commandEventSchema>
type Base = Pick<CommandEvent, 'eventId'|'seq'|'monoUs'|'timeline'|'clockSegmentRef'|'unavailableReason'>
/** A recorded command fact is data, distinct from an executable application command. */
export function recordingCommandEvent(base: Base, fact: Omit<CommandEvent, keyof Base|'kind'>): CommandEvent {
  return commandEventSchema.parse({ ...base, kind: commandEventSchema.shape.kind.value, ...fact })
}
