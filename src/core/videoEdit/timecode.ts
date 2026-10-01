/** Non-drop frame numbering; fractional-rate sequences retain their actual integer frame. */
export function videoEditFrameTimecode(frame: number, fps: number): string {
  const nominal = Math.round(fps); const seconds = Math.floor(frame / nominal)
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60, frame % nominal].map(value => String(value).padStart(2, '0')).join(':')
}
/** Source PTS is not inferred from nominal frame rate, including VFR material. */
export function videoEditSourceTimecode(timeUs: number): string {
  const seconds = Math.floor(timeUs / 1e6)
  return `${[Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(value => String(value).padStart(2, '0')).join(':')}.${String(timeUs % 1e6).padStart(6, '0')}`
}
