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

/** 帧号读数（时间码显示切到“帧”时用）。 */
export function videoEditFrameCount(frame: number): string {
  return String(Math.max(0, Math.round(frame)))
}

/**
 * 解析用户在时间码上输入的跳转位置（Premiere 习惯），返回目标帧；输入无效时为 null。
 * - 纯数字按“从右往左两位一组”填进 时:分:秒:帧：`1230` = 12 秒 30 帧，`123000` = 12 分 30 秒 00 帧，`5` = 5 帧；
 * - 也可以带分隔符（: ; . ,）逐段写，空段按 0；
 * - 帧或秒超出进位自动换算：60 帧项目里 `1299` = 12 秒 99 帧 = 13 秒 39 帧；
 * - 开头带 + / − 为相对当前位置移动；
 * - `frames` 模式（时间码显示切到帧号时）下纯数字就是帧号。
 * 时间码按名义整数帧率计数（与 videoEditFrameTimecode 一致）。
 */
export function parseVideoEditTimecodeInput(text: string, fps: number, current: number, mode: 'timecode' | 'frames' = 'timecode'): number | null {
  const value = text.trim().replace(/[：；。，]/g, (char) => ({ '：': ':', '；': ';', '。': '.', '，': ',' })[char] ?? char)
  const match = /^([+-]?)\s*([\d:;.,]+)$/.exec(value)
  if (!match) return null
  const [, sign, body] = match
  if (!/\d/.test(body)) return null
  const nominal = Math.max(1, Math.round(fps))
  let frames: number
  if (mode === 'frames' && /^\d+$/.test(body)) frames = Number(body)
  else {
    const fields = /[:;.,]/.test(body)
      ? body.split(/[:;.,]/).map(part => (part === '' ? 0 : Number(part)))
      : body.padStart(body.length + (body.length % 2), '0').match(/\d{2}/g)!.map(Number)
    if (fields.length > 4 || fields.some(part => !Number.isFinite(part))) return null
    // 右对齐到 时、分、秒、帧
    const [hours, minutes, seconds, frame] = [0, 0, 0, 0, ...fields].slice(-4)
    frames = ((hours * 60 + minutes) * 60 + seconds) * nominal + frame
  }
  const target = sign === '+' ? current + frames : sign === '-' ? current - frames : frames
  return Math.max(0, Math.round(target))
}
