const { test } = require('node:test')
const assert = require('node:assert/strict')
const { findIconSizingViolations, findControlRowViolations } = require('./check-icon-tokens.cjs')

test('图标门禁识别导入别名、奇数尺寸、尺寸类与非标准描边', () => {
  const source = `import { Plus as Add } from 'lucide-react';
    const View = () => <><Add size={15}/><Add className="h-[18px] w-[18px]"/><Add strokeWidth={1.75}/></>`
  assert.equal(findIconSizingViolations(source, 'View.tsx').length, 3)
})
test('按钮子图标尺寸由按钮控制，包含条件渲染与嵌套图标', () => {
  const source = `import { Plus } from 'lucide-react';
    const View = () => <UiIconButton>{busy ? <Plus size={16}/> : <span><Plus className="h-4 w-4"/></span>}</UiIconButton>`
  assert.equal(findIconSizingViolations(source, 'View.tsx').length, 2)
})
test('登记尺寸、默认描边与无尺寸的按钮子图标通过；数据 SVG 不受影响', () => {
  const source = `import { Plus } from 'lucide-react';
    const View = () => <><Plus size={UI_ICON_SIZE.sm}/><Plus className={UI_ICON_SIZE_CLASS.lg}/><UiButton><Plus/></UiButton><svg width={91} strokeWidth={7}/></>`
  assert.deepEqual(findIconSizingViolations(source, 'View.tsx'), [])
})
test('条件表达式中的非法尺寸也不能绕过门禁，标准独立图标尺寸可用', () => {
  assert.equal(findIconSizingViolations(`import { Plus } from 'lucide-react'; const A = () => <Plus size={on ? 16 : 13}/>`, 'A.tsx').length, 1)
  assert.deepEqual(findIconSizingViolations(`import { Plus } from 'lucide-react'; const A = () => <Plus size={16}/>`, 'A.tsx'), [])
})

test('同行尺寸检查：可静态解析的单行控件必须同高，纵向/折行和动态布局留给 DOM 审计', () => {
  assert.equal(findControlRowViolations('<div className="flex items-center"><UiInput size="sm"/><UiIconButton/></div>', 'Row.tsx').length, 1)
  assert.deepEqual(findControlRowViolations('<UiToolbar><UiButton/><UiIconButton/><UiReadout>100%</UiReadout></UiToolbar>', 'Row.tsx'), [])
  assert.deepEqual(findControlRowViolations('<div className="flex flex-col"><UiInput size="sm"/><UiIconButton/></div>', 'Row.tsx'), [])
})

test('尺寸常量和按钮别名不能绕过尺寸门禁', () => {
  const source = `import { Plus } from 'lucide-react'; import { UiButton as Action } from '@/components/ui/primitives'; const odd = 15; const A = () => <><Plus size={odd}/><Action><Plus className={UI_ICON_SIZE_CLASS.md}/></Action></>`
  assert.equal(findIconSizingViolations(source, 'Alias.tsx').length, 2)
})
