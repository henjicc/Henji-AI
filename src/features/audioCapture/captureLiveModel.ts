export function isCaptureShortcut(event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'altKey' | 'repeat'>): boolean {
  return !event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey && (event.key === ' ' && event.shiftKey || event.key.toLowerCase() === 'r')
}

export function captureTimecode(seconds: number): string {
  const milliseconds = Math.max(0, Math.floor(seconds * 1000))
  return `${String(Math.floor(milliseconds / 3600000)).padStart(2, '0')}:${String(Math.floor(milliseconds / 60000) % 60).padStart(2, '0')}:${String(Math.floor(milliseconds / 1000) % 60).padStart(2, '0')}.${String(milliseconds % 1000).padStart(3, '0')}`
}
export const captureLevelRatio = (amplitude: number): number => Math.max(0, Math.min(1, (20 * Math.log10(Math.max(1e-9, amplitude)) + 60) / 60))

