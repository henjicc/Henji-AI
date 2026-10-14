import { execFile } from 'node:child_process'

/** The arrow inside Windows' cursor cell: the cell is CursorBaseSize pixels, the drawn arrow about 0.62 of it. */
const ARROW_OF_CELL = 0.62

function readDword(key: string, name: string): Promise<number | null> {
  return new Promise(resolve => {
    execFile('reg', ['query', key, '/v', name], { windowsHide: true, timeout: 2000 }, (error, stdout) => {
      const match = !error && /REG_DWORD\s+0x([0-9a-f]+)/i.exec(stdout)
      resolve(match ? parseInt(match[1], 16) : null)
    })
  })
}

/**
 * How the person's own pointer looks, so the redrawn one starts out the same: its height as a share of the
 * captured picture's height, and whether it is the black variant. Windows only; elsewhere the effect defaults stay.
 * `pictureHeightPx` is the captured area's height in physical pixels, `scaleFactor` the display scaling there.
 */
export async function systemCursorLook(pictureHeightPx: number, scaleFactor: number, platform: NodeJS.Platform = process.platform): Promise<{ size: number; style: 'light' | 'dark' } | undefined> {
  if (platform !== 'win32' || !(pictureHeightPx > 0) || !(scaleFactor > 0)) return undefined
  const [base, type] = await Promise.all([readDword('HKCU\\Control Panel\\Cursors', 'CursorBaseSize'), readDword('HKCU\\Software\\Microsoft\\Accessibility', 'CursorType')])
  const cellPx = (base && base >= 16 && base <= 512 ? base : 32) * scaleFactor
  // The effect accepts 0.5–10 % of the picture height.
  return { size: Math.min(10, Math.max(0.5, Math.round(cellPx * ARROW_OF_CELL / pictureHeightPx * 1000) / 10)), style: type === 1 ? 'dark' : 'light' }
}
