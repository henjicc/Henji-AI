const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')
const { loadTypeScript } = require('../check-persistence-compat.cjs')
const { prepareStylePackage } = require('./uiInspectionStylePackage.cjs')

test('风格场景从内置资源导出生成包，正式解码后内容和两种模板有效', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'henji-style-scene-'))
  try {
    const { PERSISTENCE_FORMATS } = loadTypeScript('src/core/persistence/formats.ts')
    const { encodeVideoEditStylePackage, decodeVideoEditStylePackage } = loadTypeScript('src/core/videoEdit/styles/stylePackageFile.ts')
    const { videoEditStyleContentHash, videoEditTemplateContentHash } = loadTypeScript('src/core/videoEdit/styles/styleSchemas.ts')
    const contract = PERSISTENCE_FORMATS.find(format => format.id === 'video-style-package')
    const resource = path.resolve('resources/video-edit-styles/restrained')
    const builtin = JSON.parse(fs.readFileSync(path.join(resource, 'style.json'), 'utf8')).content
    const media = { preview: fs.readFileSync(path.join(resource, 'preview.mp4')),
      thumbnail: fs.readFileSync(path.join(resource, 'thumbnail.jpg')),
      anchors: fs.readdirSync(path.join(resource, 'anchors')).sort().map(file => fs.readFileSync(path.join(resource, 'anchors', file))) }
    const filename = path.join(root, 'generated.henjistyle')
    let exported = false
    const evidence = await prepareStylePackage(filename, async output => {
      exported = true
      assert.equal(fs.existsSync(output), false)
      fs.writeFileSync(output, encodeVideoEditStylePackage(contract, builtin, [], media))
    })
    assert.equal(exported, true)
    const decoded = decodeVideoEditStylePackage(contract, fs.readFileSync(filename, 'utf8'))
    assert.equal(evidence.builtin, 'restrained')
    assert.equal(decoded.value.style.contentHash, await videoEditStyleContentHash(decoded.value.style))
    assert.deepEqual(decoded.value.style.sample, builtin.sample)
    assert.deepEqual(Buffer.from(decoded.media.preview), media.preview)
    assert.deepEqual(decoded.value.templates.map(template => template.name), ['参数卡片', '人名条'])
    for (const template of decoded.value.templates) {
      assert.equal(template.style.id, decoded.value.style.id)
      assert.equal(template.contentHash, await videoEditTemplateContentHash(template.body))
      const source = template.body.code.files['index.js']
      const { default: author } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
      assert.equal(typeof author.draw, 'function')
      assert.equal(author.params[0].key, template.id.endsWith('value') ? 'value' : 'name')
    }
  } finally {
    // root 是本测试刚创建的唯一临时目录，不接收外部输入。
    fs.rmSync(root, { recursive: true, force: true })
  }
})
