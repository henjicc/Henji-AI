/** Opt-in Chromium user-timing scopes. No retained entries or production logging. */
let enabled = false
export function enableVideoEditFrameTrace(value: boolean): void { enabled = value }
export function traceVideoEditFrame(stage: string, frame: number, start: number, end = performance.now()): void {
  if (!enabled) return
  const name = `henji.frame.${stage}:${frame}`
  performance.measure(name, { start, end })
  performance.clearMeasures(name)
}
