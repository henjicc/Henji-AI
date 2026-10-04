/**
 * 设置表夹具（任务 5.8 第二块）：把若干 `settings` 行临时写成给定 JSON，清掉对应的渲染层本地缓存后重载，
 * 场景结束按原值恢复（原来没有的行删除）。用于“音色库里有一条可试听的克隆音色”这类只存在于设置表里的数据。
 *
 * 值里的 "{{file:image}}" / "{{file:audio}}" / "{{file:video}}" 换成写进应用数据目录的仓库夹具媒体路径
 * （应用只允许读数据目录或已授权目录里的本地媒体）。
 */
const fs = require('node:fs/promises')
const path = require('node:path')
const { createWaveFixture } = require('./uiReviewHistoryFixture.cjs')

const ROOT = path.resolve(__dirname, '..', '..')
const FILE_PLACEHOLDER = /\{\{file:(image|audio|video)\}\}/g

function normalizeSeedSettings(value) {
  const values = value?.values
  if (!values || typeof values !== 'object' || Array.isArray(values) || Object.keys(values).length === 0) {
    throw new Error('seedSettings 需要非空 values（设置键 → JSON 值）')
  }
  for (const key of Object.keys(values)) {
    if (!/^[a-z][\w.-]*$/i.test(key)) throw new Error(`seedSettings 键名不合法：${key}`)
  }
  const clearLocalStorage = value.clearLocalStorage ?? []
  if (!Array.isArray(clearLocalStorage) || clearLocalStorage.some((key) => typeof key !== 'string')) {
    throw new Error('seedSettings.clearLocalStorage 需要字符串数组')
  }
  return { values, clearLocalStorage }
}

async function materializeFiles(page) {
  const imageBytes = [...await fs.readFile(path.join(ROOT, 'resources/icons/icon.png'))]
  const videoBytes = [...await fs.readFile(path.join(ROOT, 'scripts/fixtures/plain_video.mp4'))]
  const waveBytes = [...createWaveFixture()]
  return page.evaluate(async ({ imageBytes, videoBytes, waveBytes }) => {
    const image = await window.henjiNative.image.persistImageBinary(new Uint8Array(imageBytes), 'png')
    const video = image.replace(/\.[^.]+$/, '-settings-review.mp4')
    const audio = image.replace(/\.[^.]+$/, '-settings-review.wav')
    await window.henjiNative.fs.writeFile(video, new Uint8Array(videoBytes))
    await window.henjiNative.fs.writeFile(audio, new Uint8Array(waveBytes))
    return { image, video, audio }
  }, { imageBytes, videoBytes, waveBytes })
}

function expand(value, files) {
  if (typeof value === 'string') return value.replace(FILE_PLACEHOLDER, (_match, kind) => files[kind])
  if (Array.isArray(value)) return value.map((item) => expand(item, files))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, expand(item, files)]))
  return value
}

async function reload(page, context) {
  const url = new URL(page.url())
  for (const key of ['henjiDevSurface', 'henjiDevMedia', 'henjiDevUpdatePreview']) url.searchParams.delete(key)
  await page.goto(url.toString(), { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => Boolean(window.henjiNative), null, { timeout: 30000 })
  await context.settlePage(page)
}

async function seedSettingsFixture(page, context, { values, clearLocalStorage }) {
  const needsFiles = JSON.stringify(values).includes('{{file:')
  const files = needsFiles ? await materializeFiles(page) : null
  const rows = Object.entries(files ? expand(values, files) : values).map(([key, value]) => [key, JSON.stringify(value)])
  const previous = await page.evaluate(async ({ rows, clearLocalStorage }) => {
    const before = []
    for (const [key, value] of rows) {
      const found = await window.henjiNative.db.select('SELECT value, type FROM settings WHERE key = ?', [key])
      before.push([key, found?.[0] ?? null])
      await window.henjiNative.db.execute(
        'INSERT INTO settings (key, value, type) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = ?, type = ?',
        [key, value, 'json', value, 'json'],
      )
    }
    for (const key of clearLocalStorage) window.localStorage.removeItem(key)
    return before
  }, { rows, clearLocalStorage })
  await reload(page, context)
  return {
    cleanup: async () => {
      await page.evaluate(async ({ previous, clearLocalStorage, files }) => {
        for (const [key, row] of previous) {
          if (row) {
            await window.henjiNative.db.execute('UPDATE settings SET value = ?, type = ? WHERE key = ?', [row.value, row.type, key])
          } else {
            await window.henjiNative.db.execute('DELETE FROM settings WHERE key = ?', [key])
          }
        }
        for (const key of clearLocalStorage) window.localStorage.removeItem(key)
        if (files) for (const file of [files.video, files.audio]) await window.henjiNative.fs.remove(file).catch(() => undefined)
      }, { previous, clearLocalStorage, files }).catch(() => undefined)
    },
  }
}

module.exports = { normalizeSeedSettings, seedSettingsFixture }
