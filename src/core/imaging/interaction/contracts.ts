/** Host-neutral samples. Coordinates are supplied by the host, never read from DOM/Store. */
export interface InteractionPoint {
  x: number
  y: number
}

export type InteractionTime =
  | { kind: 'static'; sourceVersion: string }
  | { kind: 'sample'; sourceVersion: string; ticks: number; ticksPerSecond: number }

export interface InteractionSample {
  pointerId: number
  pointerType: string
  client: InteractionPoint
  /** Host reference grid, before the tool's object-space mapping. */
  point: InteractionPoint
  pressure: number
  tiltX: number
  tiltY: number
  twist: number
  timestamp: number
}

export interface InteractionPointerInput {
  phase: 'down' | 'move' | 'up'
  sample: InteractionSample
  /** Ordered coalesced samples plus the final dispatched sample. */
  samples: readonly InteractionSample[]
  time: InteractionTime
}

export type InteractionCancelReason =
  | 'escape' | 'pointercancel' | 'lostcapture' | 'blur'
  | 'tool-change' | 'temporary-tool' | 'target-change' | 'unmount' | 'failed'

export interface InteractionGesture {
  begin: (input: InteractionPointerInput) => void
  preview: (input: InteractionPointerInput) => void
  /** The final point is delivered here even when no move was dispatched. No-op preserves redo. */
  commit: (input: InteractionPointerInput) => void | Promise<void>
  cancel: (reason: InteractionCancelReason) => void
}

export interface InteractionKeyboardInput {
  code: string
  repeat: boolean
  composing: boolean
  editable: boolean
  modal: boolean
  ctrl: boolean
  meta: boolean
  alt: boolean
}

export function acceptsToolKeyboard(input: InteractionKeyboardInput): boolean {
  return !input.composing && !input.editable && !input.modal && !input.repeat
    && !input.ctrl && !input.meta && !input.alt
}
