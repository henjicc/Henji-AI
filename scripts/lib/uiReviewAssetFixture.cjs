/**
 * 资产库夹具（任务 5.8）：把仓库图片复制进应用数据目录、经正式接口登记成资产；`missing: true` 时登记后删掉源文件，
 * 用来截“资产预览加载失败”这类没有不联网入口的状态。场景结束删除资产与文件（需 writesUserData: true）。
 */
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')

const ROOT = path.resolve(__dirname, '..', '..')
const IMAGE_FIXTURE = path.join(ROOT, 'resources/icons/128x128@2x.png')

function normalizeSeedAsset(value) {
  if (!value || typeof value !== 'object') throw new Error('seedAsset 需要 { name, missing? }')
  const name = String(value.name ?? '').trim()
  if (!name) throw new Error('seedAsset.name 不能为空')
  return { name, missing: value.missing === true }
}

async function seedAssetFixture(page, step) {
  if (!fs.existsSync(IMAGE_FIXTURE)) throw new Error(`资产夹具图片不存在：${IMAGE_FIXTURE}`)
  const dataRoot = await page.evaluate(() => window.henjiNative.paths.appLocalDataDir())
  const filePath = path.join(dataRoot, 'Uploads', `ui-review-asset-${randomUUID()}.png`)
  await fsp.mkdir(path.dirname(filePath), { recursive: true })
  await fsp.copyFile(IMAGE_FIXTURE, filePath)
  const asset = await page.evaluate(({ source, displayName }) => window.henjiNative.assetLibrary.createAsset({
    filePath: source, mediaType: 'image', displayName, source: 'imported',
  }), { source: filePath, displayName: step.name })
  if (step.missing) await fsp.rm(filePath, { force: true })
  console.log(`  资产夹具：${step.name}${step.missing ? '（源文件已删除）' : ''}`)
  return {
    cleanup: async () => {
      try {
        await page.evaluate((id) => window.henjiNative.assetLibrary.deleteAsset(id), asset.id)
      } finally {
        await fsp.rm(filePath, { force: true })
      }
    },
  }
}

module.exports = { normalizeSeedAsset, seedAssetFixture }
