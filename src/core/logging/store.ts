import type { LogEvent } from './types'
import { getLogConfig } from './config'

type Listener = (events: LogEvent[]) => void

const listeners = new Set<Listener>()
let events: LogEvent[] = []

function emit(): void {
  const snapshot = events.slice()
  listeners.forEach((listener) => {
    listener(snapshot)
  })
}

export function appendLogEvent(event: LogEvent): void {
  const { bufferSize } = getLogConfig()
  events = [...events, event]

  if (events.length > bufferSize) {
    events = events.slice(events.length - bufferSize)
  }

  emit()
}

export function getLogEvents(): LogEvent[] {
  return events.slice()
}

export function clearLogEvents(): void {
  events = []
  emit()
}

export function subscribeLogEvents(listener: Listener): () => void {
  listeners.add(listener)
  listener(getLogEvents())
  return () => {
    listeners.delete(listener)
  }
}
