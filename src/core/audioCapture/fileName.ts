export function audioCaptureFileName(date: Date, ordinal = 0): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `录音 ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}${ordinal ? ` (${ordinal})` : ''}.wav`
}
