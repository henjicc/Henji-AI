/* eslint-disable @typescript-eslint/no-var-requires -- Node 精确测试加载正式巡检场景。 */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const { createGenerationSettingsScenes } = require('./uiInspectionSceneCatalogGeneration.cjs')

test('生成空态清理隔离场景遗留历史，并拒绝清理真实资料', async () => {
  let rows = ['previous-voice-failure'], clears = 0, navigations = 0
  const scene = createGenerationSettingsScenes({ setupGeneration: async () => { navigations++ } }).find(item => item.id === 'generation-empty')
  const window = { henjiNative: { generationHistory: {
    clear: async () => { rows = []; clears++ }, count: async () => rows.length,
  } } }
  const page = {
    evaluate: callback => vm.runInNewContext(`(${callback.toString()})()`, { window }), reload: async () => {},
    locator: () => ({ count: async () => rows.length }),
    getByText: pattern => ({ first: () => ({ waitFor: async () => { assert.match('暂无历史记录', pattern) } }) }),
  }
  const app = userData => ({ evaluate: callback => callback({ app: { getPath: () => userData } }) })
  assert.equal(scene.writesUserData, true)
  await scene.setup(page, app('C:/Temp/henji-electron-test-fixture'))
  assert.equal(clears, 1); assert.equal(navigations, 1); assert.deepEqual(rows, [])
  await assert.rejects(() => scene.setup(page, app('C:/Users/user/AppData/Roaming/Henji-AI')), /隔离夹具历史/)
  assert.equal(clears, 1)
})
