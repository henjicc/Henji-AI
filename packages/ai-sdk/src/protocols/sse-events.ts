// Dispatch only complete SSE events; an EOF does not imply a blank line.
export function drainSseEvents(input: string): { events: string[]; remaining: string } {
  const events: string[] = []
  let remaining = input
  let hasSeparator = true
  while (hasSeparator) {
    const separator = findNextSeparator(remaining)
    if (!separator) {
      hasSeparator = false
      continue
    }
    if (separator) {
      events.push(remaining.slice(0, separator.index))
      remaining = remaining.slice(separator.index + separator.length)
    }
  }
  return { events, remaining }
}

function findNextSeparator(input: string): { index: number; length: number } | undefined {
  // CRLF is one line ending, including when it crosses transport chunks.
  const endings = /\r\n|\r|\n/g
  let previous: RegExpExecArray | null = null
  let current: RegExpExecArray | null
  while ((current = endings.exec(input)) !== null) {
    if (previous && previous.index + previous[0].length === current.index) {
      return { index: previous.index, length: previous[0].length + current[0].length }
    }
    previous = current
  }
  return undefined
}
