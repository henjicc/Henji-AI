const fs = require('node:fs')
const path = require('node:path')
const { compareGalleryImages, expectedGalleryCaptures, validateGalleryRun, GALLERY_DIFF_RATIO } = require('./lib/uiGalleryDiff.cjs')

async function main(argv) {
  const inputIndex = argv.indexOf('--input')
  const reasonIndex = argv.indexOf('--reason')
  const update = argv.includes('--update-baseline')
  if (process.platform !== 'win32') throw new Error('像素基线仅在固定 Windows 环境运行，CI 只运行规则自测')
  if (inputIndex < 0 || !argv[inputIndex + 1]) throw new Error('需要 --input <正式 ui:tour 四预设输出目录>')
  if (update && (reasonIndex < 0 || (argv[reasonIndex + 1] || '').trim().length < 8)) throw new Error('更新基线需要 --reason <至少8字的有意改动原因>，并写入提交正文')
  const input = path.resolve(argv[inputIndex + 1])
  const baseline = path.resolve('scripts/ui-review/baselines/ui-gallery')
  const config = JSON.parse(fs.readFileSync('scripts/ui-review/ui-gallery.json', 'utf8'))
  const expected = expectedGalleryCaptures(config)
  // 先核全量清单，再写基线；缺一个分区、中段或预设都不能变成成功。
  for (const file of expected) if (!fs.existsSync(path.join(input, file))) throw new Error(`缺少正式捕获：${file}`)
  const manifestPath = path.join(baseline, 'manifest.json')
  const windows = {}
  for (const preset of ['graphite', 'ocean', 'film', 'paper']) {
    const read = name => JSON.parse(fs.readFileSync(path.join(input, preset, name), 'utf8'))
    const suffixes = expected.filter(file => file.startsWith(`${preset}/`)).map(file => file.replace(/^.*1440x900-review-ui-gallery-/, '').replace(/\.png$/, ''))
    windows[preset] = validateGalleryRun(read('audit.json'), read('evidence.json'), preset, suffixes)
  }
  const environment = { platform: process.platform, windows, captures: expected, ratio: GALLERY_DIFF_RATIO }
  if (!update) {
    if (!fs.existsSync(manifestPath)) throw new Error('尚未建立 Windows 基线；由总管理者先目视截图再 --update-baseline')
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    if (JSON.stringify(manifest.captures) !== JSON.stringify(expected)) throw new Error('捕获配置已变化，必须重新审查完整基线')
    if (JSON.stringify(manifest.windows) !== JSON.stringify(windows)) throw new Error('窗口内容区、DPI 或缩放与基线不同；恢复固定捕获环境后再比较')
  }
  // 解码检查全部输入后才开始更新，损坏的后半段图片不会留下半套新基线。
  if (update) for (const file of expected) { const current = fs.readFileSync(path.join(input, file)); await compareGalleryImages(current, current) }
  let failed = 0
  for (const file of expected) {
    const current = fs.readFileSync(path.join(input, file))
    const target = path.join(baseline, file)
    if (update) {
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, current)
    } else {
      if (!fs.existsSync(target)) throw new Error(`缺少基线：${file}`)
      const result = await compareGalleryImages(fs.readFileSync(target), current)
      if (!result.passed) {
        failed++
        const output = path.join(input, 'diff', file)
        fs.mkdirSync(path.dirname(output), { recursive: true })
        fs.writeFileSync(output, result.diff)
        console.error(`${file}: 差异 ${result.changedPixels}/${result.pixelCount}`)
      }
    }
  }
  if (update) fs.writeFileSync(manifestPath, JSON.stringify({ ...environment, reason: argv[reasonIndex + 1] }, null, 2) + '\n')
  console.log(`样张基线 ${expected.length} 张，失败 ${failed}`)
  if (failed) process.exitCode = 1
}
main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1 })
