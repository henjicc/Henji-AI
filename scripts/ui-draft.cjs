#!/usr/bin/env node
/**
 * 界面设计草稿的内联与渲染（skill henji-ui-surface 的 references/sample-screen.md）。
 *
 * 草稿是一个自包含的 HTML：用项目真实的令牌值、随包字体和 lucide 图标画出整屏，先给用户确认再实现。
 * 这个脚本做两件事：把草稿里用到的 lucide 图标内联进 `/*ICONS_START*​/…/*ICONS_END*​/` 标记之间
 * （草稿不依赖网络与构建），再把每一屏渲染成图，放到草稿旁边的“预览”目录。
 *
 * 用法：
 *   node scripts/ui-draft.cjs docs/task/界面样板屏/剪辑/剪辑样板屏草稿.html
 *   node scripts/ui-draft.cjs <草稿.html> --only 1,3     只渲染这几屏
 *   node scripts/ui-draft.cjs <草稿.html> --no-render    只内联图标
 *
 * 草稿页面的约定（从剪辑样板屏草稿复制即可得到）：每一屏是 `.block[data-id]`，其中 `.shot:not(.before)` 是草稿画面，
 * `.before-side` 是现状截图；地址带 `?s=<编号>` 只显示这一屏，`&v=pair` 现状与草稿并排。
 */
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const ROOT = path.resolve(__dirname, '..')
const ICON_DIR = path.join(ROOT, 'node_modules/lucide-react/dist/esm/icons')

function inlineIcons(file) {
  let html = fs.readFileSync(file, 'utf8')
  if (!/\/\*ICONS_START\*\/[\s\S]*?\/\*ICONS_END\*\//.test(html)) return 0
  const names = new Set([...html.matchAll(/'([a-z][a-z0-9-]*)'/g)].map((match) => match[1]).filter((name) => fs.existsSync(path.join(ICON_DIR, `${name}.js`))))
  const icons = {}
  for (const name of names) {
    const source = fs.readFileSync(path.join(ICON_DIR, `${name}.js`), 'utf8')
    const node = source.match(/const __iconNode = (\[[\s\S]*?\]);\r?\n/)
    // 别名文件只转出另一个图标，没有自己的路径
    if (!node) continue
    // 路径数据来自本仓库安装的图标库
    const shapes = Function(`return ${node[1]}`)()
    icons[name] = shapes.map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).filter(([key]) => key !== 'key').map(([key, value]) => `${key}="${value}"`).join(' ')}/>`).join('')
  }
  html = html.replace(/\/\*ICONS_START\*\/[\s\S]*?\/\*ICONS_END\*\//, `/*ICONS_START*/${JSON.stringify(icons)}/*ICONS_END*/`)
  fs.writeFileSync(file, html)
  return Object.keys(icons).length
}

async function render(file, only) {
  const { chromium } = require(path.join(ROOT, 'node_modules/playwright-core'))
  const browser = await chromium.launch({ channel: 'msedge' })
  const outDir = path.join(path.dirname(file), '预览')
  fs.mkdirSync(outDir, { recursive: true })
  const url = pathToFileURL(file).href
  try {
    const index = await browser.newPage()
    await index.goto(url)
    const screens = await index.$$eval('.block[data-id]', (blocks) => blocks.map((block) => ({
      id: block.dataset.id,
      title: (block.querySelector('h2')?.textContent ?? '').replace(/[\\/:*?"<>|]/g, ' ').trim().slice(0, 24),
      pair: Boolean(block.querySelector('.before-side')),
    })))
    await index.close()
    for (const screen of screens) {
      if (only.length && !only.includes(screen.id)) continue
      const name = `${screen.id}-${screen.title || '草稿'}`
      const shoot = async (viewport, scale, query, selector, suffix) => {
        const context = await browser.newContext({ viewport, deviceScaleFactor: scale })
        const page = await context.newPage()
        page.on('pageerror', (error) => console.error(`[ui-draft] 页面脚本出错：${error.message}`))
        await page.goto(`${url}?s=${screen.id}${query}`)
        await page.evaluate(() => document.fonts.ready)
        await page.waitForTimeout(300)
        await (await page.$(selector)).screenshot({ path: path.join(outDir, `${name}-${suffix}.png`) })
        await context.close()
      }
      await shoot({ width: 1440, height: 900 }, 2, '', '.block.show .shot:not(.before)', '草稿')
      if (screen.pair) await shoot({ width: 2960, height: 1000 }, 1, '&v=pair', '.block.show .pair', '对比')
      console.log(`[ui-draft] ${name}`)
    }
  } finally {
    await browser.close()
  }
  return outDir
}

async function main() {
  const args = process.argv.slice(2)
  const target = args.find((arg) => !arg.startsWith('--'))
  if (!target) {
    console.error('用法：node scripts/ui-draft.cjs <草稿.html> [--only 1,3] [--no-render]')
    process.exitCode = 1
    return
  }
  const file = path.resolve(target)
  const onlyIndex = args.indexOf('--only')
  const only = onlyIndex >= 0 ? String(args[onlyIndex + 1] ?? '').split(',').filter(Boolean) : []
  console.log(`[ui-draft] 内联图标 ${inlineIcons(file)} 个`)
  if (!args.includes('--no-render')) console.log(`[ui-draft] 预览图在 ${await render(file, only)}`)
}

main().catch((error) => {
  console.error(`[ui-draft] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
