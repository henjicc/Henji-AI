const { test } = require('node:test')
const assert = require('node:assert/strict')
const { auditUiDom } = require('./uiAuditDom.cjs')
const { UI_VISUAL_RULE_SAMPLES, reconcileSampleIssues } = require('./uiVisualRuleSamples.cjs')

async function audit(html, context = {}) {
  const { JSDOM } = await import('jsdom')
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true })
  const w = dom.window
  const nativeStyle = w.getComputedStyle.bind(w)
  w.getComputedStyle = element => nativeStyle(element)
  const nativeMatches = w.Element.prototype.matches
  w.Element.prototype.matches = function (selector) {
    return selector === ':hover' ? this.hasAttribute('data-hover') : nativeMatches.call(this, selector)
  }
  w.document.elementsFromPoint = () => [...w.document.querySelectorAll('*')]
  w.HTMLElement.prototype.getBoundingClientRect = function () {
    const [x, y, width, height] = (this.dataset.rect || '0,0,200,32').split(',').map(Number)
    return { x, y, left: x, top: y, width, height, right: x + width, bottom: y + height }
  }
  for (const e of w.document.querySelectorAll('[data-scroll]')) {
    const [clientHeight, scrollHeight] = e.dataset.scroll.split(',').map(Number)
    Object.defineProperties(e, { clientHeight: { value: clientHeight }, scrollHeight: { value: scrollHeight } })
  }
  for (const e of w.document.querySelectorAll('[data-text-width]')) {
    const [clientWidth, scrollWidth] = e.dataset.textWidth.split(',').map(Number)
    Object.defineProperties(e, { clientWidth: { value: clientWidth }, scrollWidth: { value: scrollWidth } })
  }
  // 文字排版框：data-ink="左,宽"（相对视口），挂在文字的父元素上
  w.Range.prototype.getClientRects = function () {
    const ink = this.startContainer?.parentElement?.dataset?.ink
    if (!ink) return []
    const [left, width] = ink.split(',').map(Number)
    return [{ left, right: left + width, top: 0, bottom: 16, width, height: 16 }]
  }
  try { return w.eval(`(${auditUiDom.toString()})(${JSON.stringify(context)})`) } finally { w.close() }
}

test('5.2 DOM 断牙夹具同时具备反例命中和正例放行', async () => {
  for (const sample of UI_VISUAL_RULE_SAMPLES.filter(sample => sample.id.startsWith('contract-'))) {
    const result = await audit(sample.html)
    assert.equal(reconcileSampleIssues(result, [sample])[0].passed, true, sample.id)
  }
})

test('shortTextTruncated 已覆盖 radio 内短标签，菜单和用户内容继续豁免', async () => {
  const label = '<span style="overflow-x:hidden;text-overflow:ellipsis" data-text-width="20,80">浏览历史</span>'
  assert.equal((await audit(`<div role="radiogroup"><button role="radio">${label}</button></div>`)).shortTextTruncated.length, 1)
  assert.equal((await audit(`<button role="radio">${label.replace('20,80', '80,80')}</button>`)).shortTextTruncated.length, 0)
  assert.equal((await audit(`<div data-user-content>${label}</div>`)).shortTextTruncated.length, 0)
  assert.equal((await audit(`<div role="option">${label}</div>`)).shortTextTruncated.length, 0)
})

test('同行检查真实外框（含分段壳、读数），排除内部按钮、xl与竖向工具条', async () => {
  const run = (h, y = 0) => audit(`<div role="toolbar"><button data-rect="0,0,32,32"></button><div><button data-rect="40,${y},32,${h}"></button></div></div>`)
  assert.equal((await run(28)).rowHeightMismatch.length, 1)
  assert.equal((await run(32, 2)).rowHeightMismatch.length, 1)
  assert.equal((await run(32)).rowHeightMismatch.length, 0)
  assert.equal((await audit('<div role="toolbar"><button data-rect="0,0,32,32"></button><div data-ui-segmented data-rect="40,0,80,36"><button data-rect="42,2,32,32"></button></div></div>')).rowHeightMismatch.length, 1)
  assert.equal((await audit('<div role="toolbar" aria-orientation="vertical"><button data-rect="0,0,32,32"></button><button data-size="xl" data-rect="0,40,40,40"></button></div>')).rowHeightMismatch.length, 0)
})

test('样张预期命中只扣除对应规则，断牙失败和正例回归仍能查出', async () => {
  const fixture = (attributes, buttons = '<button data-variant="primary"></button><button data-variant="primary"></button>') => `<section id="sample" data-gallery-rule-sample="multiplePrimary" ${attributes}><div data-ui-toolbar>${buttons}</div></section>`
  const bad = await audit(fixture('data-gallery-expect-hit="multiplePrimary"'))
  assert.equal(bad.gallerySamples[0].passed, true)
  assert.equal(bad.multiplePrimary.length, 0)
  assert.equal((await audit(fixture('data-gallery-expect-hit="multiplePrimary"'), { includeGallerySamples: true })).multiplePrimary.length, 1)
  assert.equal((await audit(fixture('data-gallery-expect-hit="multiplePrimary"', '<button data-variant="primary"></button>'))).gallerySamples[0].passed, false)
  const goodRegressed = await audit(fixture('data-gallery-expect-clean="multiplePrimary"'))
  assert.equal(goodRegressed.gallerySamples[0].passed, false)
  assert.equal(goodRegressed.multiplePrimary.length, 1)
  const partial = await audit(fixture('data-gallery-expect-hit="multiplePrimary" data-rect="0,-8,200,32"'))
  assert.equal(partial.gallerySamples.length, 0)
  assert.equal(partial.multiplePrimary.length, 0, '半露出的已登记反例仍不混入生产问题')
})

test('条带样张以样本作为工作面边界，外面的目录滚动不隐藏反例', async () => {
  const bands = Array.from({length: 3}, (_, i) => `<div data-command-bar data-rect="0,${i * 32},400,32"><button data-rect="0,${i * 32},32,32"></button></div>`).join('')
  const result = await audit(`<div style="overflow-y:auto" data-rect="0,0,400,600"><section id="bands" data-gallery-rule-sample="stackedBands" data-gallery-expect-hit="stackedBands" data-rect="0,0,400,96"><div data-rect="0,0,400,96">${bands}</div></section></div>`)
  assert.equal(result.gallerySamples[0].passed, true)
  // 样张上半截压在目录滚动区上沿下面：不对账（滚动造成的裁切不是样张失效）
  const hidden = await audit(`<div style="overflow-y:auto" data-rect="0,50,400,600"><section id="bands" data-gallery-rule-sample="stackedBands" data-gallery-expect-hit="stackedBands" data-rect="0,0,400,96"><div data-rect="0,0,400,96">${bands}</div></section></div>`)
  assert.equal(hidden.gallerySamples.length, 0)
})

test('主动作只统计可见且最近表面拥有的按钮', async () => {
  assert.equal((await audit('<div role="dialog"><button data-variant="primary"></button><button data-tone="accent"></button></div>')).multiplePrimary.length, 1)
  assert.equal((await audit('<div role="dialog"><button data-variant="primary"></button><div role="dialog"><button data-variant="primary"></button></div><button style="display:none" data-variant="primary"></button></div>')).multiplePrimary.length, 0)
})

test('展示豁免只接受中心页分区内的逐区域逐规则声明和理由', async () => {
  const controls = '<div data-ui-toolbar><button data-variant="primary" data-rect="0,0,16,16"></button><button data-variant="primary" data-rect="32,0,16,16"></button></div>'
  const wrap = (attributes, inner = controls, surface = 'dev.ui_gallery') => `<main data-application-surface-id="${surface}"><section data-gallery-section="buttons"><div ${attributes}>${inner}</div></section></main>`
  const declaration = 'data-gallery-ignore-rules="multiplePrimary" data-gallery-ignore-reason="主按钮状态矩阵需要并排展示"'
  const valid = await audit(wrap(declaration))
  assert.equal(valid.multiplePrimary.length, 0)
  assert.equal(JSON.stringify(valid.galleryExemptions.map(entry => entry.rules).flat()), '["multiplePrimary"]')
  assert.ok(valid.smallTargets.length > 0, '没有声明的规则仍检查')
  assert.equal((await audit(wrap(declaration.replace('multiplePrimary', 'multiplePrimary smallTargets')))).smallTargets.length, 0)
  assert.equal((await audit(wrap('data-gallery-ignore-rules="multiplePrimary"'))).multiplePrimary.length, 1)
  assert.equal((await audit(wrap(declaration.replace('multiplePrimary', '*')))).multiplePrimary.length, 1)
  assert.equal((await audit(wrap(declaration, controls, 'production'))).multiplePrimary.length, 1)
  assert.equal((await audit(`<main data-application-surface-id="dev.ui_gallery" ${declaration}><section data-gallery-section="buttons">${controls}</section></main>`)).multiplePrimary.length, 1)
  assert.equal((await audit(`<main data-application-surface-id="dev.ui_gallery"><section data-gallery-section="buttons" ${declaration}>${controls}</section></main>`)).multiplePrimary.length, 1)
  assert.equal((await audit(wrap(declaration, controls) + '<div data-ui-toolbar><button data-variant="primary"></button><button data-variant="primary"></button></div>')).multiplePrimary.length, 1, '区域外问题保留')
})

test('搜索框按完整外框比较，清除按钮不与同行动作混算', async () => {
  const fixture = height => `<div role="toolbar"><div data-ui-search-input data-rect="0,0,200,${height}"><input data-rect="0,0,200,${height}"><button data-rect="170,4,24,24"></button></div><button data-rect="220,0,64,32"></button></div>`
  assert.equal((await audit(fixture(32))).rowHeightMismatch.length, 0)
  assert.equal((await audit(fixture(28))).rowHeightMismatch.length, 1)
})

test('面板列对齐、动作不得从标签列起头，独立嵌套组不混算', async () => {
  const html = '<div data-ui-group><div data-ui-form-row="panel"><div data-ui-form-control data-rect="96,0,100,32"><button data-rect="96,0,32,32"></button></div></div>'
  assert.equal((await audit(`${html}<button data-rect="0,40,32,32"></button></div>`)).actionStartsAtLabelColumn.length, 1)
  assert.equal((await audit(`${html}<button data-rect="96,40,32,32"></button></div>`)).actionStartsAtLabelColumn.length, 0)
  assert.equal((await audit(`${html}<div data-ui-form-row="panel"><div data-ui-form-control data-rect="120,40,100,32"></div></div></div>`)).formControlMisaligned.length, 1)
  assert.equal((await audit(`${html}<div data-ui-group><div data-ui-form-row="panel"><div data-ui-form-control data-rect="120,40,100,32"></div></div></div></div>`)).formControlMisaligned.length, 0)
  assert.equal((await audit(`${html}<div data-ui-form-row="auto"><input data-rect="0,40,100,32"><button data-ui-compact-stepper-button data-rect="0,40,16,16"></button><button data-rect="0,40,32,32"></button></div></div>`)).actionStartsAtLabelColumn.length, 0, 'auto 行是独立排布，不按面板动作检查')
  assert.equal((await audit(`${html}<div data-ui-field-control><input data-rect="0,40,100,32"><button data-ui-compact-stepper-button data-rect="0,40,16,16"></button></div><button data-rect="0,80,32,32"></button></div>`)).actionStartsAtLabelColumn.length, 1, '字段和步进附属按钮不是行外动作，真正的动作仍报错')
})

test('同色控件只检查有交互悬停或选中态的容器，不把 hover 祖先页壳当作选项', async () => {
  const fixture = attributes => `<div ${attributes} style="background:rgb(50,50,50)"><button style="background:rgb(50,50,50)"></button></div>`
  assert.equal((await audit(fixture('data-hover'))).nestedSameBackground.length, 0)
  assert.equal((await audit(fixture('data-hover role="option"'))).nestedSameBackground.length, 1)
  assert.equal((await audit(fixture('data-hover class="hover:bg-hover"'))).nestedSameBackground.length, 1)
  assert.equal((await audit(fixture('aria-selected="true"'))).nestedSameBackground.length, 1)
  assert.equal((await audit(fixture('role="option"'))).nestedSameBackground.length, 0)
})

test('缩略浮层与独立滚动的展示声明不会放过区域外同类缺陷', async () => {
  const fixture = declarations => `<main data-application-surface-id="dev.ui_gallery"><section data-gallery-section="sample"><div style="overflow-y:auto" data-scroll="100,800"><div ${declarations} data-gallery-ignore-reason="样本展示独立滚动及缩略浮层"><div style="overflow-y:auto" data-scroll="100,400"><div role="dialog" style="position:absolute;z-index:40" class="absolute" data-rect="0,-50,200,200"></div></div></div></div></section></main>`
  const raw = await audit(fixture(''))
  assert.equal(raw.nestedScroll.length, 1)
  assert.equal(raw.overlayClipped.length, 1)
  const marked = await audit(fixture('data-gallery-ignore-rules="nestedScroll overlayClipped"'))
  assert.equal(marked.nestedScroll.length, 0)
  assert.equal(marked.overlayClipped.length, 0)
  assert.equal(marked.scrollRegions.length, raw.scrollRegions.length, '声明不影响完整滚动覆盖证据')
})

test('阴影令牌和缩放布局豁免不改变原始阴影及溢出判据', async () => {
  const fixture = rules => `<main data-application-surface-id="dev.ui_gallery"><section data-gallery-section="tokens"><div data-gallery-ignore-rules="${rules}" data-gallery-ignore-reason="阴影令牌与缩放布局的静态展示"><div style="box-shadow:rgb(0,0,0) 0px 3px 8px" data-rect="1000,0,100,32"></div></div></section></main>`
  const raw = await audit(fixture(''))
  assert.ok(raw.shadowOutsideOverlay.length > 0)
  assert.equal(raw.horizontalOverflow.length, 1)
  const marked = await audit(fixture('shadowOutsideOverlay horizontalOverflow'))
  assert.equal(marked.horizontalOverflow.length, 0)
  assert.ok(marked.shadowOutsideOverlay.length < raw.shadowOutsideOverlay.length)
})

test('2xs 仅正式图标按钮 20px 例外，缩小与伪造标记仍失败；滚动尺寸不因子项不可见消失', async () => {
  assert.equal((await audit('<button class="ui-btn" data-tone="default" data-size="2xs" data-rect="0,0,20,20"></button>')).smallTargets.length, 0)
  assert.equal((await audit('<button data-size="2xs" data-rect="0,0,20,20"></button>')).smallTargets.length, 1)
  assert.equal((await audit('<button class="ui-btn" data-tone="default" data-size="2xs" data-rect="0,0,18,18"></button>')).smallTargets.length, 1)
  assert.equal((await audit('<div id="scroll" style="overflow-y:auto" data-scroll="200,800" data-rect="0,0,200,200"></div>')).scrollRegions[0].scrollHeight, 800)
})

test('重要记录 020 的判据收窄：圆形与胶囊、滑杆高度、子分组开关、限高输入框、平移视口、时间轴件截断', async () => {
  // 圆形播放键（圆角 ≥ 半高）是形状，不按同心圆角判；方角子块仍判
  const radius = (style) => audit(`<div style="border-top-left-radius: 8px; overflow: hidden" data-rect="0,0,200,200"><button style="border-top-left-radius: ${style}" data-rect="80,80,40,40"></button></div>`)
  assert.equal((await radius('9999px')).oversizedRadius.length, 0)
  assert.equal((await radius('12px')).oversizedRadius.length, 1)
  // 滑杆 24 高与 28 高的数值框同行：只比中心线
  const slider = (y) => audit(`<div data-ui-form-control data-rect="0,0,200,28"><input type="range" data-rect="0,${y},120,24"><div data-ui-field-control data-rect="128,0,56,28"><input data-rect="128,0,56,28"></div></div>`)
  assert.equal((await slider(2)).rowHeightMismatch.length, 0)
  assert.equal((await slider(6)).rowHeightMismatch.length, 1, '中心线错开仍报')
  // 展开子分组的开关是分组标题；弹菜单的触发器仍是动作
  const html = '<div data-ui-group><div data-ui-form-row="panel"><div data-ui-form-control data-rect="96,0,100,32"><button data-rect="96,0,32,32"></button></div></div>'
  assert.equal((await audit(`${html}<button aria-expanded="false" data-rect="0,40,200,28"></button></div>`)).actionStartsAtLabelColumn.length, 0)
  assert.equal((await audit(`${html}<button aria-expanded="false" aria-haspopup="menu" data-rect="0,40,200,28"></button></div>`)).actionStartsAtLabelColumn.length, 1)
  // 限高的富文本编辑器在框内滚动不算双层滚动；普通面板套滚动仍算
  const nested = (inner) => audit(`<div style="overflow-y: auto" data-scroll="400,900" data-rect="0,0,400,400">${inner}</div>`)
  assert.equal((await nested('<div contenteditable="true" style="overflow-y: auto" data-scroll="200,600" data-rect="0,0,300,200"></div>')).nestedScroll.length, 0)
  assert.equal((await nested('<div style="overflow-y: auto" data-scroll="200,600" data-rect="0,0,300,200"></div>')).nestedScroll.length, 1)
  // 平移缩放视口放大后内容伸出不算横向溢出
  const pan = (attr) => audit(`<div style="overflow-x: hidden" ${attr} data-text-width="1000,2320" data-rect="0,0,1000,800"><img data-rect="-400,0,2320,800"></div>`)
  assert.equal((await pan('data-layout-scroll-region')).horizontalOverflow.length, 0)
  assert.equal((await pan('')).horizontalOverflow.length, 1)
  // 时间轴片段名随缩放截断是常态
  const clip = (attr) => audit(`<div ${attr}><span style="overflow-x: hidden; text-overflow: ellipsis; white-space: nowrap" data-text-width="7,121">大家好，这是第一条字幕</span></div>`)
  assert.equal((await clip('data-ui-timeline-item')).shortTextTruncated.length, 0)
  assert.equal((await clip('')).shortTextTruncated.length, 1)
  // 文字包在一层提示元素里的截断容器（属性行名称）也要查到
  const wrapped = await audit('<div style="overflow-x: hidden; text-overflow: ellipsis; white-space: nowrap" data-text-width="10,26"><span>位置</span></div>')
  assert.equal(wrapped.shortTextTruncated.length, 1)
  // 数值框读数放不下算硬裁切；文本框里的长内容横向滚动不算
  const number = await audit('<input type="number" value="1024" data-text-width="24,31" data-rect="0,0,60,32">')
  assert.equal(number.hardTextClip.length, 1)
  const text = await audit('<input type="text" value="很长很长的一段文字" data-text-width="24,90" data-rect="0,0,60,32">')
  assert.equal(text.hardTextClip.length, 0)
  // 正文里的行内链接不按 24px 判；按钮形态的小链接仍判
  const inlineLink = await audit('<p>见<a href="#x" style="display: inline" data-rect="0,0,52,17">说明</a>。</p>')
  assert.equal(inlineLink.smallTargets.length, 0)
  const blockLink = await audit('<a href="#x" style="display: inline-flex" data-rect="0,0,52,17">说明</a>')
  assert.equal(blockLink.smallTargets.length, 1)
  // 尾部渐隐遮罩的标题不算硬裁
  const faded = await audit('<span style="overflow-x: hidden; white-space: nowrap; mask-image: linear-gradient(to right, black 80%, transparent)" data-text-width="100,168">把输入整理成一句画面描述</span>')
  assert.equal(faded.hardTextClip.length, 0)
})

test('文字跑出自己的按钮（分段在窄面板里叠字）算硬裁切；内层截断容器裁住的文字和放得下的不算', async () => {
  const spills = async (html) => (await audit(html)).hardTextClip.filter(item => item.reason === 'spill')
  const hit = await spills('<div role="radiogroup"><button role="radio" data-rect="0,0,22,28" data-text-width="22,40" data-ink="-9,40">标准</button></div>')
  assert.equal(hit.length, 1)
  assert.equal(hit[0].spill, 9)
  assert.equal((await spills('<button data-rect="0,0,22,28" data-text-width="22,40"><span style="overflow-x:hidden" data-ink="0,40">长文字</span></button>')).length, 0)
  assert.equal((await spills('<button data-rect="0,0,60,28" data-text-width="60,60" data-ink="8,40">标准</button>')).length, 0)
})
