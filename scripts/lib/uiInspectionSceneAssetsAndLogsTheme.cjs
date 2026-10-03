const assert = require('node:assert/strict')
const fsp = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { captureInspectionPage } = require('./uiInspectionCapture.cjs')

const VIDEO_FIXTURE = path.resolve('scripts/fixtures/plain_video.mp4')

/**
 * 资产浮动面板（3.7 第 1、5 项）：
 * - 标题栏“资产”在浮动面板打开时是开关（aria-pressed），aria-current 只给当前工作区；
 * - 刚登记的视频资产在面板打开后等到后台检查完成，原位换上封面与尺寸，不必重开面板。
 */
function createAssetsFloatingVideoCoverScene({ openWorkspace, settlePage }) {
  let fixture = null
  return {
    id: 'assets-floating-video-cover', surface: '资产库', name: '资产库-浮动面板视频封面', writesUserData: true,
    cleanup: async (page) => {
      const current = fixture
      fixture = null
      if (!current) return
      await page.keyboard.press('Escape').catch(() => undefined)
      try {
        if (current.assetId) await page.evaluate((id) => window.henjiNative.assetLibrary.deleteAsset(id), current.assetId)
      } finally {
        await fsp.rm(current.filePath, { force: true })
      }
    },
    setup: async (page) => {
      await openWorkspace(page, 'generation')
      const dataRoot = await page.evaluate(() => window.henjiNative.paths.appLocalDataDir())
      const filePath = path.join(dataRoot, 'Uploads', `ui-asset-cover-${randomUUID()}.mp4`)
      await fsp.mkdir(path.dirname(filePath), { recursive: true })
      await fsp.copyFile(VIDEO_FIXTURE, filePath)
      fixture = { filePath, assetId: null }
      // 登记后立刻打开面板：查询时视频大概率仍在后台检查，正是修复前一直没有封面的时机。
      fixture.assetId = (await page.evaluate((source) => window.henjiNative.assetLibrary.createAsset({
        filePath: source, mediaType: 'video', displayName: '视频封面验收', source: 'imported',
      }), filePath)).id
      await openWorkspace(page, 'assets')
      await page.locator('[data-asset-floating-panel]:visible').waitFor({ state: 'visible', timeout: 8000 })

      const nav = page.getByRole('navigation', { name: '工作区' })
      const assets = nav.getByRole('button', { name: '资产', exact: true })
      assert.equal(await assets.getAttribute('aria-pressed'), 'true', '浮动面板打开时“资产”应为开关开启')
      assert.equal(await assets.getAttribute('aria-current'), null, '浮动面板不是当前页')
      assert.equal(await nav.getByRole('button', { name: '生成', exact: true }).getAttribute('aria-current'), 'page')
      assert.equal(await nav.locator('[aria-current="page"]').count(), 1, '只能有一个当前工作区')

      const card = page.locator(`[data-asset-floating-panel] [data-asset-id="${fixture.assetId}"]`)
      await card.waitFor({ state: 'visible', timeout: 8000 })
      await card.locator('img').first().waitFor({ state: 'visible', timeout: 20000 })
      await card.getByText(/^\d+×\d+$/).waitFor({ state: 'visible', timeout: 5000 })
      await page.mouse.move(4, 400)
      await settlePage(page, 400)
    },
  }
}

/**
 * 日志窗口主题（3.7 第 2 项）：日志壳与主窗口同源应用主题，开发预设 `--dev-theme-preset` 也要生效。
 * 判据是两个窗口的实际背景与配色方案一致；日志窗口截图写到 `.ui-tour/logs-window-theme.png` 供目视。
 */
function createLogsWindowThemeScene({ openWorkspace, settlePage }) {
  let logPage = null
  return {
    id: 'logs-window-theme', surface: '窗口', name: '日志窗口-主题与主窗口一致', writesUserData: false,
    cleanup: async () => {
      const current = logPage
      logPage = null
      if (current && !current.isClosed()) await current.close().catch(() => undefined)
    },
    setup: async (page, app) => {
      await openWorkspace(page, 'generation')
      const opened = app.waitForEvent('window', {
        predicate: (candidate) => candidate.url().includes('view=logs'), timeout: 15000,
      })
      await page.evaluate(() => window.henjiNative.logging.openLogWindow())
      logPage = await opened
      await logPage.waitForLoadState('domcontentloaded')
      await logPage.locator('header').first().waitFor({ state: 'visible', timeout: 15000 })
      await logPage.waitForTimeout(800)
      const readTheme = (target) => target.evaluate(() => ({
        background: getComputedStyle(document.body).backgroundColor,
        colorScheme: getComputedStyle(document.documentElement).colorScheme,
        windowToken: getComputedStyle(document.documentElement).getPropertyValue('--window-rgb').trim(),
      }))
      const [main, logs] = await Promise.all([readTheme(page), readTheme(logPage)])
      assert.deepEqual(logs, main, `日志窗口主题与主窗口不一致：${JSON.stringify({ main, logs })}`)
      const bytes = await captureInspectionPage(app, logPage)
      await fsp.mkdir(path.resolve('.ui-tour'), { recursive: true })
      await fsp.writeFile(path.resolve('.ui-tour', 'logs-window-theme.png'), bytes)
      await settlePage(page, 200)
    },
  }
}

module.exports = { createAssetsFloatingVideoCoverScene, createLogsWindowThemeScene }
