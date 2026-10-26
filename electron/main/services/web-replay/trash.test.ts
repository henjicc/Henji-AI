import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { markWebRecordingTrashed, purgeExpiredWebRecordingTrash, WEB_RECORDING_TRASH_RETENTION_MS } from './trash'

const exists = (file: string): Promise<boolean> => fs.access(file).then(() => true, () => false)

it('回收区按删除时刻清理：满 30 天的连同原位置记录删掉，未满的、没有删除时刻的旧录制都留下', async () => {
  const trash = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-web-trash-'))
  try {
    const now = Date.parse('2026-10-27T00:00:00Z')
    for (const id of ['old', 'fresh', 'legacy']) {
      await fs.mkdir(path.join(trash, id))
      await fs.writeFile(path.join(trash, id, 'manifest.json'), '{}')
    }
    await fs.writeFile(path.join(trash, 'old.origin.json'), '{"directory":"x"}')
    await markWebRecordingTrashed(trash, 'old', new Date(now - WEB_RECORDING_TRASH_RETENTION_MS))
    await markWebRecordingTrashed(trash, 'fresh', new Date(now - WEB_RECORDING_TRASH_RETENTION_MS + 60_000))
    await fs.writeFile(path.join(trash, 'gone.origin.json'), '{}')

    const result = await purgeExpiredWebRecordingTrash(trash, now)

    expect(result).toEqual({ purged: ['old'], failed: [] })
    expect(await exists(path.join(trash, 'old'))).toBe(false)
    expect(await exists(path.join(trash, 'old.origin.json'))).toBe(false)
    expect(await exists(path.join(trash, 'old.deleted-at'))).toBe(false)
    expect(await exists(path.join(trash, 'fresh', 'manifest.json'))).toBe(true)
    expect(await exists(path.join(trash, 'gone.origin.json'))).toBe(false)
    // 这项功能之前删的录制从本次启动起算，满期后才清。
    expect(await fs.readFile(path.join(trash, 'legacy.deleted-at'), 'utf8')).toBe(new Date(now).toISOString())
    expect((await purgeExpiredWebRecordingTrash(trash, now + WEB_RECORDING_TRASH_RETENTION_MS)).purged.sort()).toEqual(['fresh', 'legacy'])
  } finally { await fs.rm(trash, { recursive: true, force: true }) }
})

it('回收区还没建过时什么都不做', async () => {
  expect(await purgeExpiredWebRecordingTrash(path.join(os.tmpdir(), 'henji-web-trash-missing-dir'))).toEqual({ purged: [], failed: [] })
})
