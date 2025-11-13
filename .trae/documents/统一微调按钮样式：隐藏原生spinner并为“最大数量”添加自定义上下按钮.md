## 目标
- 隐藏浏览器原生数字输入的上下微调按钮（不符合整体风格）
- 为“最大数量”输入框添加自定义上下按钮，样式与当前深色主题与强调色统一

## 修改
- 全局样式：隐藏原生数字输入spinner
  - 在 `src/index.css` 添加：
    - `input[type="number"]::-webkit-outer-spin-button, input[type="number"]::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }`
    - `input[type="number"] { -moz-appearance: textfield; }`
- 自定义“最大数量”微调按钮：`src/components/MediaGenerator.tsx`
  - 将输入框包裹在 `relative` 容器中
  - 输入框增加 `pr-8` 为右侧按钮留空间
  - 在输入框右侧添加上下两个小按钮（强调色 `#007eff` 悬停，边框统一 `rgba(46,46,46,0.8)`，圆角 `rounded-lg`）
  - 点击上下按钮分别在 `1–15` 范围内增减

## 验证
- 原生spinner不再显示
- “最大数量”右侧出现定制上下按钮，交互与样式统一