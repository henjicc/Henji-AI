/* eslint-disable @typescript-eslint/no-var-requires -- 正式 Electron CommonJS 场景沿用统一巡检入口。 */
const assert = require('node:assert/strict')

/** 只替换隔离实例的 IPC 数据边界；正式设置组件、通知和导航均保持真实，不读取密钥。 */
function createMcpExpiryScene({ setupSettings, settlePage }) {
  return { id: 'mcp-connection-expiry', surface: '设置', name: '外部连接-到期与续期', writesUserData: true,
    // 截图不测试网络监听；其他 worktree/真实应用占用默认端口时隔离实例恢复失败是已知环境事实。
    expectedLogEvents: ['mcp.restore.failed'],
    setup: async (page, app, { capture }) => {
      // 根层提醒可能已在等待原服务启动；先让它完成，不能用合成 focus 事件绕过尚未返回的请求。
      await page.evaluate(() => window.henjiNative.mcp.status())
      await page.waitForTimeout(100)
      await app.evaluate(({ ipcMain }) => {
        const channels = ['mcp:status', 'mcp:renew', 'mcp:reminder:acknowledge']
        const now = Date.now()
        const day = 86400_000
        const connections = [
          { id: '00000000-0000-4000-8000-000000000001', name: '创作工作台', expiresAt: now + 30 * day },
          { id: '00000000-0000-4000-8000-000000000002', name: 'Codex · 即将到期', expiresAt: now + 3 * day - 1000 },
          { id: '00000000-0000-4000-8000-000000000003', name: 'Claude · 已到期', expiresAt: now - day },
        ]
        const fixture = { originals: channels.map(channel => [channel, ipcMain._invokeHandlers.get(channel)]), connections, acked: 0, renewed: 0 }
        globalThis.__henjiMcpExpiryFixture = fixture
        for (const channel of channels) ipcMain.removeHandler(channel)
        ipcMain.handle('mcp:status', () => ({ ok: true, data: { enabled: true, ready: true, port: 43821,
          connections } }))
        ipcMain.handle('mcp:renew', (_event, input) => {
          const connection = connections.find(item => item.id === input.id)
          connection.expiresAt = Date.now() + 30 * day
          delete connection.reminder
          fixture.renewed++
          return { ok: true, data: connection }
        })
        ipcMain.handle('mcp:reminder:acknowledge', (_event, input) => {
          const connection = connections.find(item => item.id === input.id)
          delete connection.reminder
          fixture.acked++
          return { ok: true, data: true }
        })
      })
      try {
        await setupSettings(page)
        await page.getByRole('button', { name: '外部智能体连接', exact: true }).click()
        const section = page.locator('#assistant-mcp')
        await section.getByText('Claude · 已到期', { exact: true }).waitFor()
        assert.equal(await section.getByRole('button', { name: '续期 30 天', exact: true }).count(), 2)
        await section.getByRole('button', { name: '续期 30 天', exact: true }).last().click()
        await page.waitForFunction(() => document.querySelectorAll('#assistant-mcp button').length > 0
          && [...document.querySelectorAll('#assistant-mcp button')].filter(item => item.textContent === '续期 30 天').length === 1)
        assert.equal(await app.evaluate(() => globalThis.__henjiMcpExpiryFixture.renewed), 1)
        await page.keyboard.press('Escape')
        await page.getByRole('dialog', { name: /设置|Settings/ }).waitFor({ state: 'hidden' })
        await app.evaluate(() => { globalThis.__henjiMcpExpiryFixture.connections[1].reminder = 'expiring' })
        await page.evaluate(() => window.dispatchEvent(new Event('focus')))
        const notice = page.getByRole('button', { name: '打开连接设置', exact: true })
        await notice.waitFor()
        await settlePage(page)
        if (capture) await capture('expiring-reminder')
        await notice.click()
        await section.getByText('Codex · 即将到期', { exact: true }).waitFor()
        assert.equal(await app.evaluate(() => globalThis.__henjiMcpExpiryFixture.acked), 1)
        await page.waitForFunction(() => !document.querySelector('[data-tone="warning"]'))
        await page.keyboard.press('Escape')
        await page.getByRole('dialog', { name: /设置|Settings/ }).waitFor({ state: 'hidden' })
        await app.evaluate(() => {
          const connection = globalThis.__henjiMcpExpiryFixture.connections[2]
          connection.expiresAt = Date.now() - 86400_000
          connection.reminder = 'expired'
        })
        await page.evaluate(() => window.dispatchEvent(new Event('focus')))
        await notice.waitFor()
        await settlePage(page)
        if (capture) await capture('expiry-reminder')
        await notice.click()
        await section.getByText('Claude · 已到期', { exact: true }).waitFor()
        await section.getByText(/已于 .* 到期/).waitFor()
        assert.equal(await app.evaluate(() => globalThis.__henjiMcpExpiryFixture.acked), 2)
        await page.waitForFunction(() => !document.querySelector('[data-tone="error"]'))
        await section.getByText('已授权的连接', { exact: true }).evaluate(element => element.scrollIntoView({ block: 'start' }))
        await settlePage(page)
      } finally {
        await app.evaluate(({ ipcMain }) => {
          for (const [channel, original] of globalThis.__henjiMcpExpiryFixture.originals) {
            ipcMain.removeHandler(channel)
            if (original) ipcMain.handle(channel, original)
          }
          delete globalThis.__henjiMcpExpiryFixture
        })
      }
    },
  }
}

module.exports = { createMcpExpiryScene }
