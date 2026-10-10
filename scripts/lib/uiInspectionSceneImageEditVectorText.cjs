/* eslint-disable @typescript-eslint/no-var-requires -- 正式 Electron 场景工厂。 */
const assert = require('node:assert/strict')
const { loadTypeScript } = require('../check-persistence-compat.cjs')
const { blockPaidGeneration } = require('./uiReviewPaidGuard.cjs')
const { openCanvasImageEditorV3Fixture } = require('./uiInspectionCanvasImageEditorV3.cjs')

function createImageEditVectorTextScene(context) {
  return {
    id: 'image-edit-vector-text', surface: '图片编辑', name: '共享文字片段、曲线、路径布尔、矢量蒙版和快速标记', writesUserData: true,
    setup: async (page, app, { capture }) => {
      const restorePaid = await blockPaidGeneration(app)
      const factory = loadTypeScript('src/core/imageEdit/v3/documentFactory.ts')
      const vector = loadTypeScript('src/core/imaging/vectorContent/index.ts')
      const colors = loadTypeScript('src/core/theme/colorTokens.ts')
      const style = { ...vector.defaultTextStyle(720), fontSize: 48, align: 'left', verticalAlign: 'top', background: { ...vector.defaultTextStyle(720).background, enabled: true, padding: 12 } }
      const title = factory.createImageEditTextLayerV3('vector-title', '中文与多字形标题', {
        box: { x: 60, y: 45, width: 660, height: 0 },
        paragraphs: [
          { runs: [{ text: '痕迹 AI · ', style }, { text: '同一个创作内核', style: { ...style, fontWeight: 700 } }], align: 'left', direction: 'auto', spaceBefore: 0, spaceAfter: 16 },
          { runs: [{ text: '标题、字幕、图形与快速标记\n保留字形片段和段落', style: { ...style, fontSize: 28 } }], align: 'left', direction: 'auto', spaceBefore: 0, spaceAfter: 0 },
        ],
      })
      const shape = factory.createImageEditPathLayerV3('vector-shape', '带孔的布尔形状', 'shape', {
        operands: [{ operation: 'replace', path: vector.rectanglePath(80, 280, 320, 230) }, { operation: 'subtract', path: vector.ellipsePath(165, 330, 140, 130) }],
        paint: { fill: { enabled: true, color: colors.WHITE_HEX }, strokes: [{ enabled: true, color: colors.ANNOTATION_DEFAULT_STROKE_HEX, width: 8, position: 'outside' }], shadows: [{ enabled: true, color: colors.BLACK_HEX, opacity: .6, distance: 8, size: 3, blur: 12, angle: 45 }] },
      })
      const curve = factory.createImageEditPathLayerV3('vector-curve', '可编辑贝塞尔路径', 'path', {
        operands: [{ operation: 'replace', path: vector.arrowPath({ x:450, y:360 }, { x:710, y:480 }, 10, { x:640, y:220 }) }],
        paint: { fill: { enabled:false, color:colors.WHITE_HEX }, strokes:[{ enabled:true, color:colors.WHITE_HEX, width:10, position:'center' }], shadows:[] },
      })
      const target = factory.createImageEditPathLayerV3('vector-target', '蒙版目标图形', 'shape', { operands:[{operation:'replace',path:vector.rectanglePath(55,255,380,290)}], paint:{fill:{enabled:true,color:colors.ANNOTATION_DEFAULT_STROKE_HEX},strokes:[],shadows:[]} })
      target.opacity = .5
      const missing = factory.createImageEditTextLayerV3('vector-missing', '缺字体仍保留原文')
      missing.visible = false; missing.content.paragraphs[0].runs[0].style.fontFamily = 'Henji-Missing-Font-Inspection'
      const empty = factory.createImageEditTextLayerV3('vector-empty', '待填写的文字', {box:{x:0,y:0,width:0,height:0},paragraphs:[]})
      let editor, fixture, projectId
      const tab = async id => { await editor.locator(`[data-dock-tab="${id}"] > span`).first().click(); await context.settlePage(page, 150) }
      const select = async id => { await tab('layers'); await editor.locator(`[data-layer-id="${id}"] [data-layer-select]`).click(); await editor.locator('[data-tool-id="move"]').click(); await tab('properties') }
      const shoot = async name => {
        await context.settlePage(page, 2500)
        assert.equal(await editor.locator('[data-command-bar]').count(), 1)
        assert.ok(await editor.locator('[data-context-bar]').count() <= 1)
        const bar = await editor.locator('[data-command-bar]').boundingBox()
        assert.ok(bar && bar.y >= 0 && bar.y + bar.height <= await page.evaluate(() => innerHeight), '命令带在窗口内')
        await capture(name)
      }
      try {
        const opened = await openCanvasImageEditorV3Fixture({ page, context, width:800, height:600, label:'文字与矢量内容验收', vectorLayers:[target, shape, curve, title, missing, empty] })
        ;({ editor, fixture, projectId } = opened)
        await select(title.id); await shoot('rich-text-runs-and-paragraphs')
        await editor.getByRole('textbox',{name:'图层文字内容'}).scrollIntoViewIfNeeded(); await shoot('rich-text-controls')
        await editor.getByRole('button',{name:'文字字体',exact:true}).click(); await shoot('shared-font-picker'); await page.keyboard.press('Escape')
        const input = editor.getByRole('textbox',{name:'图层文字内容'})
        await input.dispatchEvent('compositionstart')
        await input.fill('中文输入法确认标题')
        await input.dispatchEvent('compositionend')
        await input.press('Control+Enter'); await shoot('ime-confirmed-text')
        await select(curve.id)
        await editor.getByRole('button',{name:'编辑锚点',exact:true}).click()
        await page.getByRole('option',{name:'锚点 2 · 曲线',exact:true}).click()
        await editor.getByRole('spinbutton',{name:'控制柄横向',exact:true}).fill('620')
        await editor.getByRole('spinbutton',{name:'控制柄横向',exact:true}).press('Enter')
        await editor.getByRole('spinbutton',{name:'控制柄纵向',exact:true}).scrollIntoViewIfNeeded()
        await shoot('bezier-control-point')
        await select(shape.id); await editor.getByRole('checkbox',{name:'启用填充',exact:true}).scrollIntoViewIfNeeded(); await shoot('boolean-path-fill-and-appearance')
        await editor.getByRole('button',{name:'蒙版目标图层',exact:true}).click()
        await page.getByRole('option',{name:'蒙版目标图形',exact:true}).click()
        await editor.getByRole('button',{name:'用路径作为蒙版',exact:true}).click()
        await select(target.id)
        await editor.getByRole('button',{name:'蒙版',exact:true}).click()
        await editor.getByRole('button',{name:'编辑路径',exact:true}).scrollIntoViewIfNeeded()
        await shoot('editable-vector-mask')
        await select(missing.id); await editor.getByRole('alert').filter({hasText:'Henji-Missing-Font-Inspection'}).scrollIntoViewIfNeeded()
        await shoot('missing-font-retains-content')
        await select(empty.id); await editor.getByText('还没有文字',{exact:true}).scrollIntoViewIfNeeded(); await shoot('empty-text-content')
        await editor.getByRole('button',{name:'关闭属性面板',exact:true}).click(); await shoot('properties-closed')
        await editor.getByRole('button',{name:'面板',exact:true}).click()
        await page.getByRole('menuitem',{name:'显示属性面板',exact:true}).click(); await tab('properties'); await shoot('properties-reopened')
        await opened.dialog.getByRole('button',{name:/关闭编辑器|Close editor/i}).click()
        await page.locator(`[data-layer-stack-node-id="${fixture.nodeId}"]`).getByRole('button',{name:/^(编辑|Edit)$/i}).click()
        editor = page.locator('[data-image-editor-v3]:visible').last(); await select(title.id); await shoot('saved-document-reopened')
        const persisted = await page.evaluate(ref => window.henjiNative.imageEditorV3.loadDocument({requestId:crypto.randomUUID(),documentRef:ref}),fixture.documentRef)
        assert.equal(persisted.document.layers.find(layer=>layer.id===title.id).content.paragraphs[0].runs[0].text,'中文输入法确认标题')
        assert.ok(persisted.document.layers.find(layer=>layer.id===target.id).mask.vectorPaths.length)
        await page.getByRole('dialog',{name:/多图层图片编辑器|Multi-layer image editor/i}).getByRole('button',{name:/关闭编辑器|Close editor/i}).click()
        // Upload-node image viewer is the real quick host, with its normal save/materialization path.
        await context.selectGenerationModel(page, 'Nano Banana 2', 'kie-nano-banana-2', 'kie')
        const previousReferences = await page.locator('img[alt^="参考 "]').count()
        await page.locator('input[type="file"][accept*="image"]').first().setInputFiles('tests/fixtures/image-inpainting/face-scratch-source.png')
        const reference = page.locator(`img[alt="参考 ${previousReferences+1}"]`)
        await reference.waitFor({state:'visible',timeout:30000});await reference.evaluate(image=>image.decode());await reference.click()
        const viewer = page.locator('[data-image-viewer="true"]:visible').last(); await viewer.waitFor()
        await viewer.getByRole('button',{name:'编辑',exact:true}).click()
        editor = viewer.locator('[data-image-editor-v3]'); await editor.waitFor({timeout:60000})
        await editor.getByRole('button',{name:'文字与图形',exact:true}).click(); await page.getByRole('menuitem',{name:'箭头',exact:true}).click()
        const overlay = editor.locator('[data-vector-overlay]'), box = await overlay.boundingBox(); assert.ok(box)
        await page.mouse.move(box.x+box.width*.2,box.y+box.height*.3); await page.mouse.down(); await page.mouse.move(box.x+box.width*.65,box.y+box.height*.6,{steps:8}); await page.mouse.up()
        await editor.locator('[data-layer-type="shape"]').waitFor(); await shoot('quick-host-formal-arrow')
        await editor.getByRole('button',{name:'保存',exact:true}).click(); await editor.waitFor({state:'hidden',timeout:60000})
        await context.settlePage(page,700); await capture('quick-host-exported-result')
        await viewer.getByRole('button',{name:'编辑',exact:true}).click()
        editor = viewer.locator('[data-image-editor-v3]'); await editor.waitFor({timeout:60000}); await editor.locator('[data-layer-type="shape"]').waitFor()
        await shoot('quick-host-reopened-editable-content')
        void projectId
      } finally { await restorePaid() }
    },
  }
}
module.exports = { createImageEditVectorTextScene }
