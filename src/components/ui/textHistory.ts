export interface TextHistorySnapshot {
  value: string
  selectionStart: number
  selectionEnd: number
  scrollTop: number
  scrollLeft: number
}

export type TextEditKind = 'insert' | 'delete' | 'replace' | 'composition'

export interface TextHistoryState {
  current: TextHistorySnapshot
  undo: TextHistorySnapshot[]
  redo: TextHistorySnapshot[]
  lastEditKind: TextEditKind | null
  lastEditAt: number
}

const MAX_TEXT_HISTORY_STEPS = 100
const TEXT_EDIT_COALESCE_MS = 750

export function createTextHistoryState(initial: TextHistorySnapshot): TextHistoryState {
  return {
    current: initial,
    undo: [],
    redo: [],
    lastEditKind: null,
    lastEditAt: 0,
  }
}

function pushSnapshot(stack: TextHistorySnapshot[], snapshot: TextHistorySnapshot): TextHistorySnapshot[] {
  const next = [...stack, snapshot]
  return next.length > MAX_TEXT_HISTORY_STEPS ? next.slice(-MAX_TEXT_HISTORY_STEPS) : next
}

export function recordTextEdit(
  state: TextHistoryState,
  nextSnapshot: TextHistorySnapshot,
  kind: TextEditKind,
  timestamp: number
): TextHistoryState {
  if (nextSnapshot.value === state.current.value) {
    return { ...state, current: nextSnapshot }
  }

  const canCoalesce = (
    (kind === 'insert' || kind === 'delete')
    && state.lastEditKind === kind
    && timestamp - state.lastEditAt <= TEXT_EDIT_COALESCE_MS
  )

  return {
    current: nextSnapshot,
    undo: canCoalesce ? state.undo : pushSnapshot(state.undo, state.current),
    redo: [],
    lastEditKind: kind,
    lastEditAt: timestamp,
  }
}

export function breakTextEditCoalescing(state: TextHistoryState): TextHistoryState {
  if (state.lastEditKind === null) return state
  return { ...state, lastEditKind: null, lastEditAt: 0 }
}

export function undoTextEdit(state: TextHistoryState): TextHistoryState {
  const target = state.undo[state.undo.length - 1]
  if (!target) return breakTextEditCoalescing(state)
  return {
    current: target,
    undo: state.undo.slice(0, -1),
    redo: pushSnapshot(state.redo, state.current),
    lastEditKind: null,
    lastEditAt: 0,
  }
}

export function redoTextEdit(state: TextHistoryState): TextHistoryState {
  const target = state.redo[state.redo.length - 1]
  if (!target) return breakTextEditCoalescing(state)
  return {
    current: target,
    undo: pushSnapshot(state.undo, state.current),
    redo: state.redo.slice(0, -1),
    lastEditKind: null,
    lastEditAt: 0,
  }
}
