import { TIMING_DROPPED, TIMING_FRESH } from './native-timing'

/** 按 README 的版本 1 布局写一份时刻表：64 字节头 + 每帧 16 字节。 */
export function timingBytes(origin: number, records: Array<[sourceUs: number, cell: number, flags: number]>, fps = 30, tail = 0): Buffer {
  const header = Buffer.alloc(64)
  header.write('HJFT', 0, 'latin1'); header.writeUInt32LE(1, 4); header.writeUInt32LE(64, 8); header.writeUInt32LE(16, 12)
  header.writeUInt32LE(fps, 16); header.writeUInt32LE(1, 20); header.writeBigInt64LE(BigInt(origin), 24); header.writeUInt32LE(1, 32)
  const body = Buffer.alloc(records.length * 16 + tail)
  records.forEach(([sourceUs, cell, flags], index) => { body.writeBigInt64LE(BigInt(sourceUs), index * 16); body.writeUInt32LE(cell, index * 16 + 8); body.writeUInt16LE(flags, index * 16 + 12) })
  return Buffer.concat([header, body])
}
export const CELL = 1e6 / 30
/** 30 帧：录 0–89 格，暂停 60 格，再录 150–239 格；每帧画面比所在格晚 5 毫秒上屏，第 10 帧是被丢弃的格子。 */
export function pausedRecording(origin = 10_000_000): Buffer {
  const records: Array<[number, number, number]> = []
  for (const cell of [...Array.from({ length: 90 }, (_, i) => i), ...Array.from({ length: 90 }, (_, i) => 150 + i)]) {
    records.push([Math.round(origin + cell * CELL + 5000), cell, cell === 10 ? TIMING_DROPPED : TIMING_FRESH])
  }
  return timingBytes(origin, records)
}
