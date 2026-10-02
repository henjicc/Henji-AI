/**
 * Source read failures in user language. The raw reader error (protocol URL, HTTP status) stays in `cause`
 * for logs; the program panel shows what the user can do about it.
 */
export function videoEditSourceReadError(name: string, error: unknown): Error {
  const raw = error instanceof Error ? error.message : String(error)
  // Chromium reports a missing file as 404; the native decoder service passes on the operating-system error.
  const missing = /\b404\b|not found|ENOENT|no such file/i.test(raw)
  return new Error(missing
    ? `找不到素材「${name}」的源文件，请在项目素材中右键该素材，选择“重新定位源文件”。`
    : `素材「${name}」无法读取，请确认文件可用，或在项目素材中重新定位源文件。`, { cause: error })
}
