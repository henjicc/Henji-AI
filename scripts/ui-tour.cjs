/**
 * 真实 Electron 界面截图巡检。
 *
 * 这个命令只负责产出供人查看的截图与 Markdown 索引，不把像素差异作为 CI 门禁。
 * 可自动判定的 DOM 规则由 check:ui-visual 单独负责。
 */
const fs = require('node:fs')
const path = require('node:path')
const {
  UI_INSPECTION_SCENES,
  filterScenes,
  formatWindowSize,
  launchUiInspectionApp,
  parseUiInspectionArgs,
  resolveOutputDir,
  setInspectionWindowSize,
} = require('./lib/uiInspection.cjs')

const ROOT = path.resolve(__dirname, '..')
const MAIN_ENTRY = path.join(ROOT, 'out/main/index.cjs')

function printHelp() {
  console.log(`Henji-AI 真实界面截图巡检

用法：
  npm run ui:tour
  npm run ui:tour -- --size 1440x900
  npm run ui:tour -- --only 生成
  npm run ui:tour -- --out .ui-tour/my-run

参数：
  --size <宽x高>  指定窗口尺寸；可重复或用逗号分隔，默认 1440x900、960x640
  --only <关键词> 只运行 id、界面或场景名包含关键词的场景
  --out <目录>    输出目录，默认 .ui-tour
`)
}

function markdownEscape(value) {
  return String(value).replaceAll('|', '\\|').replaceAll('\n', ' ')
}

function createIndex(rows, failures) {
  const lines = [
    '# Henji-AI 界面巡检截图',
    '',
    `- 生成时间：${new Date().toISOString()}`,
    `- 截图数量：${rows.length}`,
    `- 失败数量：${failures.length}`,
    '',
    '| 界面 | 场景 | 窗口尺寸 | 截图 |',
    '|---|---|---:|---|',
  ]
  for (const row of rows) {
    lines.push(`| ${markdownEscape(row.surface)} | ${markdownEscape(row.name)} | ${row.size} | [打开截图](${row.file}) |`)
  }
  if (failures.length > 0) {
    lines.push('', '## 失败场景', '')
    for (const failure of failures) {
      lines.push(`- ${failure.size} / ${failure.name}：${markdownEscape(failure.message)}`)
    }
  }
  return `${lines.join('\n')}\n`
}

async function main() {
  const options = parseUiInspectionArgs(process.argv.slice(2), '.ui-tour')
  if (options.help) {
    printHelp()
    return
  }
  const scenes = filterScenes(UI_INSPECTION_SCENES, options.only)
  if (scenes.length === 0) {
    throw new Error(`--only 没有匹配到场景。可用界面：${[...new Set(UI_INSPECTION_SCENES.map((scene) => scene.surface))].join('、')}`)
  }

  const outDir = resolveOutputDir(ROOT, options.outDir)
  fs.mkdirSync(outDir, { recursive: true })
  const rows = []
  const failures = []
  const app = await launchUiInspectionApp({ root: ROOT, mainEntry: MAIN_ENTRY })

  try {
    for (const size of options.sizes) {
      await setInspectionWindowSize(app, size)
      const sizeLabel = formatWindowSize(size)
      for (const scene of scenes) {
        try {
          await scene.setup(app.page)
          const fileName = `${sizeLabel}-${scene.id}.png`
          await app.page.screenshot({
            path: path.join(outDir, fileName),
            animations: 'disabled',
          })
          rows.push({ ...scene, size: sizeLabel, file: fileName })
          console.log(`✓ ${sizeLabel} / ${scene.name}`)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          failures.push({ name: scene.name, size: sizeLabel, message })
          console.error(`✗ ${sizeLabel} / ${scene.name}：${message}`)
        }
      }
    }
  } finally {
    await app.close()
  }

  const index = createIndex(rows, failures)
  const indexPath = path.join(outDir, 'index.md')
  fs.writeFileSync(indexPath, index, 'utf8')
  console.log(`\n截图目录：${outDir}`)
  console.log(`索引文件：${indexPath}\n`)
  console.log(index)

  if (failures.length > 0) {
    throw new Error(`${failures.length} 个场景未能完成，已保留成功截图和失败索引`)
  }
}

main().catch((error) => {
  console.error(`FAILED: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
