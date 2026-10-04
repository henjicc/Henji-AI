const { createWindowStartupScene } = require('./uiInspectionSceneWindowStartup.cjs')
const { createClipboardImageScene } = require('./uiInspectionSceneClipboardImage.cjs')
const { createAssetsFloatingVideoCoverScene, createLogsWindowThemeScene } = require('./uiInspectionSceneAssetsAndLogsTheme.cjs')
const { createGenerationVideoViewerTrimScene } = require('./uiInspectionSceneGenerationVideoViewer.cjs')

function createSupportScenes(context) {
  const {
    settlePage,
    clickNamedButton,
    setupAssets,
    setupAssistant,
  } = context

  return [
    createWindowStartupScene(),
    createClipboardImageScene(context),
    { id: 'assets-home', surface: '资产库', name: '资产库-首页', setup: setupAssets },
    createAssetsFloatingVideoCoverScene(context),
    createLogsWindowThemeScene(context),
    createGenerationVideoViewerTrimScene(context),
    {
      id: 'assets-search-focus',
      surface: '资产库',
      name: '资产库-搜索聚焦',
      setup: async (page) => {
        await setupAssets(page)
        await page.locator('input[placeholder*="资产"], input[placeholder*="asset" i]').first().focus()
        await settlePage(page)
      },
    },
    {
      id: 'assets-type-menu',
      surface: '资产库',
      name: '资产库-类型下拉',
      setup: async (page) => {
        await setupAssets(page)
        await clickNamedButton(page, /^(全部类型|All types)$/i)
        await settlePage(page)
      },
    },
    { id: 'assistant-home', surface: '助手', name: '助手-对话空态', setup: setupAssistant },
    {
      id: 'assistant-history',
      surface: '助手',
      name: '助手-运行历史',
      setup: async (page) => {
        await setupAssistant(page)
        // 侧栏在同一次启动里不卸载，上一尺寸留下的历史视图会让按钮名变成“返回当前对话”：已在历史视图就不再切换
        if (!(await page.locator('[aria-label="返回当前对话"]:visible').count())) {
          await page.locator('[aria-label="对话历史"]').click()
        }
        /*
         * 等列表真正读完再结束：读取会让主进程进入“切换中”，场景提前结束会把这段切换留给下一个场景，
         * 下一个场景里的新建对话或发送就会撞上（5.6 转交的 assistant-focus 偶发报错）。
         */
        await page.getByText('正在读取对话', { exact: true }).waitFor({ state: 'hidden', timeout: 15000 })
        const deadline = Date.now() + 15000
        while ((await page.evaluate(() => window.henjiNative.embeddedAgent.snapshot())).switching) {
          if (Date.now() > deadline) throw new Error('对话历史读取未在时限内结束')
          await page.waitForTimeout(50)
        }
        await settlePage(page)
      },
    },
    {
      id: 'assistant-focus',
      surface: '助手',
      name: '助手-输入聚焦',
      setup: async (page) => {
        await setupAssistant(page)
        // 上一场景可能停在历史视图（侧栏同次启动不卸载）：先回到对话，再聚焦输入框
        const back = page.locator('[aria-label="返回当前对话"]:visible')
        if (await back.count()) await back.first().click()
        await page.locator('[aria-label="向智能助手描述任务"]').focus()
        await settlePage(page)
      },
    },
    {
      id: 'assistant-memory',
      surface: '助手',
      name: '助手-记忆',
      setup: async (page) => {
        await setupAssistant(page)
        await page.locator('[aria-label="助手记忆"]').click()
        await settlePage(page)
      },
    },
  ]
}

module.exports = { createSupportScenes }
