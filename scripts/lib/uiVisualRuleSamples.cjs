/**
 * check:ui-visual 5.8 新规则的断牙样例：每条规则一对“未修复（必须命中）/ 已修复（不得命中）”的最小 DOM。
 * scripts/ui-visual-rule-samples.cjs 把它们注入真实 Electron 窗口，跑同一个 auditUiDom，按样例 id 对账。
 *
 * 样例只用内联样式与原生元素：要验证的是规则判据本身，与应用的组件和令牌无关（应用里的真实界面由
 * check:ui-visual 的场景负责不误报）。颜色写在这里不进 src，不受 check:colors 约束。
 */

const BUTTON = 'height:28px;padding:0 8px;border:0;border-radius:6px;background:#e5e7eb;color:#111827;font:13px sans-serif'

function band(id, text) {
  return `<div id="${id}" style="display:flex;align-items:center;gap:8px;height:40px;padding:0 10px;border-bottom:1px solid #9ca3af;background:#f9fafb">`
    + `<button style="${BUTTON}">${text}</button></div>`
}

function toolbarButtons(count, width) {
  return Array.from({ length: count }, (_, index) => `<button style="${BUTTON};width:${width}px;flex:none">项${index + 1}</button>`).join('')
}

function tabs(groupId, selectedStyle, restStyle) {
  return `<div id="${groupId}" style="display:flex;gap:4px">`
    + `<button role="tab" aria-selected="true" id="${groupId}-selected" style="${BUTTON};${selectedStyle}">图片</button>`
    + `<button role="tab" aria-selected="false" style="${BUTTON};${restStyle}">视频</button>`
    + `<button role="tab" aria-selected="false" style="${BUTTON};${restStyle}">音频</button></div>`
}

const ELLIPSIS = 'display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'

/** @type {{ id: string, rule: string, expect: 'hit' | 'clean', note: string, html: string }[]} */
const UI_VISUAL_RULE_SAMPLES = Object.freeze([
  {
    id: 'bands-bad', rule: 'stackedBands', expect: 'hit', note: '命令带下又摞了两条带（图片编辑旧版的 4 刀）',
    html: `<div style="width:800px;display:flex;flex-direction:column">${band('bands-bad-a', '返回')}${band('bands-bad-b', '打开图片')}${band('bands-bad-c', '画笔')}</div>`,
  },
  {
    id: 'bands-good', rule: 'stackedBands', expect: 'clean', note: '命令带 + 从属参数带两条',
    html: `<div style="width:800px;display:flex;flex-direction:column">${band('bands-good-a', '返回')}${band('bands-good-b', '画笔')}</div>`,
  },
  {
    id: 'wrap-bad', rule: 'toolbarWrap', expect: 'hit', note: '工具条放不下，按钮折到第二行',
    html: `<div role="toolbar" id="wrap-bad" style="display:flex;flex-wrap:wrap;gap:4px;width:220px">${toolbarButtons(5, 60)}</div>`,
  },
  {
    id: 'wrap-good', rule: 'toolbarWrap', expect: 'clean', note: '同样 5 个按钮，宽度足够单行',
    html: `<div role="toolbar" id="wrap-good" style="display:flex;flex-wrap:wrap;gap:4px;width:400px">${toolbarButtons(5, 60)}</div>`,
  },
  {
    id: 'wrap-vertical-good', rule: 'toolbarWrap', expect: 'clean', note: '竖排工具栏（工具竖条）子项上下排是设计',
    html: `<div role="toolbar" aria-orientation="vertical" id="wrap-vertical-good" style="display:flex;flex-direction:column;gap:4px;width:56px">${toolbarButtons(4, 48)}</div>`,
  },
  {
    id: 'wrap-label-bad', rule: 'toolbarWrap', expect: 'hit', note: '底栏按钮文字折成两行',
    html: `<div role="toolbar" id="wrap-label-bad" style="display:flex;align-items:center;width:400px"><button style="${BUTTON};width:44px;height:auto">导出全部图片</button></div>`,
  },
  {
    id: 'wrap-label-good', rule: 'toolbarWrap', expect: 'clean', note: '按钮宽度够，文字单行',
    html: `<div role="toolbar" id="wrap-label-good" style="display:flex;align-items:center;width:400px"><button style="${BUTTON};white-space:nowrap">导出全部图片</button></div>`,
  },
  {
    id: 'trunc-bad', rule: 'shortTextTruncated', expect: 'hit', note: '四个字的按钮文案被省略号截断',
    html: `<button style="${BUTTON};width:44px"><span id="trunc-bad" style="${ELLIPSIS}">保存全部</span></button>`,
  },
  {
    id: 'trunc-fit', rule: 'shortTextTruncated', expect: 'clean', note: '同样的文案放得下',
    html: `<button style="${BUTTON};width:96px"><span id="trunc-fit" style="${ELLIPSIS}">保存全部</span></button>`,
  },
  {
    id: 'trunc-user', rule: 'shortTextTruncated', expect: 'clean', note: '用户内容（项目名）截断是设计',
    html: `<div style="width:60px"><span id="trunc-user" data-observation-sensitive style="${ELLIPSIS}">我的项目</span></div>`,
  },
  {
    id: 'sel-bad', rule: 'selectedStateWeak', expect: 'hit', note: '选中与未选中长得一样',
    html: tabs('sel-bad', 'background:#e5e7eb;color:#111827', 'background:#e5e7eb;color:#111827'),
  },
  {
    id: 'sel-good', rule: 'selectedStateWeak', expect: 'clean', note: '选中用淡强调底 + 强调文字',
    html: tabs('sel-good', 'background:#dbeafe;color:#1d4ed8', 'background:#e5e7eb;color:#111827'),
  },
  {
    id: 'sel-pressed-bad', rule: 'selectedStateWeak', expect: 'hit', note: '同一组的按下开关（多选一）按下与未按下一样',
    html: '<div role="group" style="display:flex;gap:4px">'
      + `<button aria-pressed="true" id="sel-pressed-bad-on" style="${BUTTON}">画笔</button>`
      + `<button aria-pressed="false" style="${BUTTON}">橡皮</button></div>`,
  },
  {
    id: 'sel-toggles-good', rule: 'selectedStateWeak', expect: 'clean', note: '一行里各管各的独立开关（显示 / 锁定）不是多选一',
    html: '<div style="display:flex;gap:4px">'
      + `<button aria-pressed="true" id="sel-toggles-good-on" style="${BUTTON}">显示</button>`
      + `<button aria-pressed="false" style="${BUTTON}">锁定</button></div>`,
  },
  {
    id: 'sel-inner-good', rule: 'selectedStateWeak', expect: 'clean', note: '选中态画在行内的选项按钮上（图层面板行）',
    html: '<div role="tree" style="display:flex;flex-direction:column;width:220px">'
      + `<div role="treeitem" aria-selected="true" id="sel-inner-good-row" style="display:flex;height:40px"><button style="${BUTTON};flex:1;background:#dbeafe;color:#1d4ed8">背景</button></div>`
      + `<div role="treeitem" aria-selected="false" style="display:flex;height:40px"><button style="${BUTTON};flex:1">前景</button></div></div>`,
  },
  {
    id: 'clip-bad', rule: 'overlayClipped', expect: 'hit', note: '下拉面板挂在 overflow:hidden 的父容器里，下半截被裁',
    html: '<div style="position:relative;overflow:hidden;width:200px;height:60px;background:#f3f4f6">'
      + '<div role="menu" id="clip-bad" style="position:absolute;top:30px;left:0;width:180px;height:120px;z-index:30;background:#e5e7eb"></div></div>',
  },
  {
    id: 'clip-good', rule: 'overlayClipped', expect: 'clean', note: '同一面板，父容器不裁切',
    html: '<div style="position:relative;width:200px;height:60px;background:#f3f4f6">'
      + '<div role="menu" id="clip-good" style="position:absolute;top:30px;left:0;width:180px;height:120px;z-index:30;background:#e5e7eb"></div></div>',
  },
  {
    id: 'clip-rounded-good', rule: 'overlayClipped', expect: 'clean', note: '大圆角浮层的四个角外不算被裁',
    html: '<div style="position:relative;width:200px;height:60px">'
      + '<div role="menu" id="clip-rounded-good" style="position:absolute;top:0;left:0;width:180px;height:120px;z-index:30;border-radius:16px;background:#e5e7eb"></div></div>',
  },
  {
    id: 'clip-viewport-bad', rule: 'overlayClipped', expect: 'hit', note: '浮层一半伸出窗口右缘',
    html: '<div role="dialog" id="clip-viewport-bad" style="position:fixed;right:-80px;bottom:40px;width:160px;height:60px;z-index:40;background:#e5e7eb"></div>',
  },
])

/** 宿主：盖住整个窗口的不透明白底层（固定定位、满屏，不进浮层判定），样例按流式排布。 */
function buildSampleHostHtml(samples = UI_VISUAL_RULE_SAMPLES) {
  return samples.map((sample) => `<section data-ui-rule-sample="${sample.id}" style="flex:none">${sample.html}</section>`).join('')
}

/** 命中按样例 id 对账：规则输出里出现该样例的 id 即算命中这个样例。 */
function reconcileSampleIssues(result, samples = UI_VISUAL_RULE_SAMPLES) {
  return samples.map((sample) => {
    const issues = (result[sample.rule] ?? []).filter((issue) => new RegExp(`#${sample.id}(?![\\w-])|#${sample.id}-`).test(JSON.stringify(issue)))
    const hit = issues.length > 0
    return { ...sample, hit, passed: sample.expect === 'hit' ? hit : !hit, issues }
  })
}

module.exports = {
  UI_VISUAL_RULE_SAMPLES,
  buildSampleHostHtml,
  reconcileSampleIssues,
}
