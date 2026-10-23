const fs = require('node:fs')
const { loadTypeScript } = require('../check-persistence-compat.cjs')

/** 两个可改文字的最小模板，继续覆盖参数卡片、人名条和长短文案，不依赖作者机器上的文件。 */
function templateSource(kind) {
  const parameter = kind === 'value' ? 'value' : 'name'
  const title = kind === 'value' ? '参数卡片' : '人名条'
  return `export default {
  name: ${JSON.stringify(title)}, kind: "generator", mode: "static", width: 1920, height: 1080, durationSeconds: 5,
  params: [
    { key: ${JSON.stringify(parameter)}, type: "text", title: ${JSON.stringify(title)}, default: ${JSON.stringify(kind === 'value' ? '2.5K' : '林一')}, maxLength: 80 },
    { key: "role", type: "text", title: "职务", default: "摄影指导", maxLength: 80 },
    { key: "label", type: "text", title: "说明", default: "DIRECTOR OF PHOTOGRAPHY", maxLength: 80 }
  ],
  draw(ctx, time, params, width, height) {
    const text = params.${parameter}
    if (!text) return
    const x = width * .08, y = height * .68, available = width * .76
    ctx.save()
    ctx.fillStyle = "rgba(18, 22, 27, .92)"; ctx.fillRect(x, y, width * .84, height * .24)
    ctx.fillStyle = "#ffffff"; ctx.textBaseline = "top"; ctx.font = "64px sans-serif"
    const font = Math.min(64, 64 * available / Math.max(1, ctx.measureText(text).width))
    ctx.font = font + "px sans-serif"; ctx.fillText(text, x + 32, y + 24)
    ctx.font = "26px sans-serif"; ctx.fillText(params.role + " · " + params.label, x + 32, y + 116, available)
    ctx.restore()
  }
}`
}

/** 先走应用导出，再用正式格式入口生成独立 ID，避免导入覆盖内置风格。 */
async function prepareStylePackage(filename, exportBuiltin) {
  await exportBuiltin(filename)
  const { PERSISTENCE_FORMATS } = loadTypeScript('src/core/persistence/formats.ts')
  const { decodeVideoEditStylePackage, encodeVideoEditStylePackage } = loadTypeScript('src/core/videoEdit/styles/stylePackageFile.ts')
  const { videoEditTemplateContentHash } = loadTypeScript('src/core/videoEdit/styles/styleSchemas.ts')
  const contract = PERSISTENCE_FORMATS.find(format => format.id === 'video-style-package')
  const { value, media } = decodeVideoEditStylePackage(contract, fs.readFileSync(filename, 'utf8'))
  const style = { ...value.style, id: 'reality-style-package', name: '风格包验收' }
  const templates = await Promise.all(['value', 'name'].map(async kind => {
    const body = { kind: 'code', code: { entry: 'index.js', files: { 'index.js': templateSource(kind) } }, durationSeconds: 5 }
    return { id: `reality-style-${kind}`, name: kind === 'value' ? '参数卡片' : '人名条', description: '风格包往返与参数编辑验收',
      version: 1, contentHash: await videoEditTemplateContentHash(body), updatedAt: style.updatedAt,
      style: { id: style.id, version: style.version }, body }
  }))
  fs.writeFileSync(filename, encodeVideoEditStylePackage(contract, style, templates, media))
  return { builtin: value.style.id, styleId: style.id, templates: templates.map(template => template.id), bytes: fs.statSync(filename).size }
}

module.exports = { prepareStylePackage, templateSource }
