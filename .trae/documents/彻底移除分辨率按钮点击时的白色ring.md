## 目标
- 解决分辨率按钮在点击瞬间出现的白色 ring 问题，确保无任何焦点/可视 ring 效果

## 修改方案
- 在分辨率按钮类名中显式禁用所有 ring 与 outline：
  - 添加 `ring-0 focus:ring-0 focus-visible:ring-0 outline-none focus:outline-none focus-visible:outline-none active:outline-none`
- 保留现有布局与交互逻辑不变

## 位置
- `src/components/MediaGenerator.tsx:730` 分辨率按钮的 `className`

## 验证
- 点击按钮不再出现白色 ring；面板开合正常，布局稳定