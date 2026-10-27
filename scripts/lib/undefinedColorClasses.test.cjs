const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')
const { createTailwindClassProbe, extractColorClassCandidates } = require('./undefinedColorClasses.cjs')

const ROOT = path.resolve(__dirname, '..', '..')
let probePromise = null
const probe = () => (probePromise ??= createTailwindClassProbe(ROOT, ['canvas-video-progress']))

const undefinedIn = async (source) => {
  const isGenerated = await probe()
  return extractColorClassCandidates(source, isGenerated).filter(({ token }) => !isGenerated(token)).map(({ token }) => token)
}

test('按 Tailwind 实际配置判定：语义令牌类有效，配置里没有的颜色名无效', async () => {
  const isGenerated = await probe()
  for (const token of ['bg-panel', 'bg-panel/60', 'hover:bg-control-hover', 'text-text2', 'border-line-strong', 'ring-accent/40',
    'text-xs', 'border-t', 'border-dashed', 'bg-[var(--x)]', '!bg-transparent', 'border-inherit', 'shadow-panel', 'canvas-video-progress',
    // 浮层令牌 overlay / overlay-hover 自 ea6e21199 起是正式语义令牌（原先作为未定义样本使用）
    'bg-overlay', 'hover:bg-overlay-hover']) {
    assert.equal(isGenerated(token), true, token)
  }
  // 颜色名不存在（bg-popover 是常见设计系统名，本项目浮层令牌叫 overlay）；自带透明度的令牌（cssVar）不能再加 /透明度；currentColor 不能加透明度
  for (const token of ['bg-popover', 'text-error', 'bg-selected-accent/50', 'border-current/15', 'text-danger']) {
    assert.equal(isGenerated(token), false, token)
  }
})

test('断牙：className 里的未定义颜色类被抓到，有效类与非类名字符串不误报', async () => {
  assert.deepEqual(await undefinedIn('<div className="flex bg-popover text-error px-2" />'), ['bg-popover', 'text-error'])
  assert.deepEqual(await undefinedIn('<div className={`rounded-md border ${tone} bg-selected-accent/50`} />'), ['bg-selected-accent/50'])
  assert.deepEqual(await undefinedIn("export const ROW_CLASS = 'bg-popover'"), ['bg-popover'])
  assert.deepEqual(await undefinedIn('<div className="flex bg-panel text-text2 hover:bg-control-hover" />'), [])
  // 不是类名语境、也不像类名列表：CSS 属性名、业务键名、日志事件名
  assert.deepEqual(await undefinedIn("el.style.setProperty('border-color', value)"), [])
  assert.deepEqual(await undefinedIn("const nodeType = 'text-processing'"), [])
  assert.deepEqual(await undefinedIn("logger.info('text-render failed border-fallback')"), [])
  // 注释行不算
  assert.deepEqual(await undefinedIn('// 以前写过 className="bg-popover"'), [])
})

test('类名列表启发式：多数词是有效类时，即使不在 className 语境也检查', async () => {
  assert.deepEqual(await undefinedIn("const tones = ['flex items-center gap-2 bg-popover']"), ['bg-popover'])
})
