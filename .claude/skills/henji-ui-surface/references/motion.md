# 动效档位

（`henji-ui-surface` 的参考文档。写任何过渡、动画、JS 计时前读这份。）

## 动效：四档时长，一种缓动

收敛前实测：**8 种时长**（200/150/300/250/220/100/75/500）、两种缓动混用、
42 处裸 `transition`，且 JS 计时常量与 CSS 时长对不上。

档位定义在 `src/components/ui/motion.ts`：

| 档 | 值 | 用途 |
|---|---|---|
| `fast` | 120ms | hover、颜色、开关、小控件（设计稿“悬停 120”） |
| `base` | 180ms | 弹窗、浮层、下拉、面板开合 —— **默认档**（设计稿“展开 180”） |
| `slow` | 240ms | 大面积位移、通知 Toast、悬浮面板折叠、缩略图扇形展开（设计稿“面板 240”） |
| `viewer` | 500ms | 全屏媒体查看器的沉浸式淡入淡出 |

位移/覆盖面积越大，时长就该越长——`viewer` 不是随手加的档，是 7 处查看器实际在用的聚类。

**缓动不需要每处写。** `tailwind.config.js` 已把 `transitionTimingFunction.DEFAULT`
改成 `ease-out` 的值，所有 `transition-*` 工具类自动拿到正确缓动。
（Tailwind 原本的默认是 `ease-in-out`，起步和收尾都慢，小尺度 UI 上显得拖沓。）
不写 `duration-*` 时默认 **base 180ms**；Tailwind 时长刻度只提供 120/180/240/500。
连续进行中图标旋转可用 `linear`，其余交互默认统一缓出，不随手使用 `ease-in`。

`index.css` 的 `--ui-duration-fast/base/slow/viewer`、`--ui-ease` 镜像 JS 令牌，
CSS 动画/过渡必须引用这些变量。`motionCss.test.ts` 编译 Tailwind 产物，核对默认值、
四档、浮层 base、Tooltip slow 与 CSS 根变量，防止工具类被未分层的 CSS 静默覆盖。

`animate-scale-in/out`、`animate-fade-in/out`、`animate-pulse/spin` 与单选圆点动画
只在 `tailwind.config.js` 定义；不在 `index.css` 重写 `.animate-*`。
自定义关键帧用 `ui-` 前缀。提示词优化专属关键帧只在 `index.css` 定义。
Tailwind 可能在 `motion-safe:` 的媒体作用域重复输出同一关键帧，定义必须一致；
同一作用域不得重名，不得由第二份源码改变含义。

循环档 `UI_LOOP_MS.spin/pulse` 为 1000/2000ms，CSS 对应 `--ui-loop-spin/pulse`，
用于表达进行中，不用于进出场卸载。画布执行脉冲的 1500ms 仍在 storyboard.css，
尚未纳入共享循环档，不能把当前收敛范围说成全仓已统一。

唯一登记的例外缓动是 `UI_EASE_STACK`（缩略图扇形展开的弹性感），和具名阴影同一个逻辑：
有具体功能语义才登记。**不要为了"想要点不一样"再发明缓动。**

### JS 计时必须和 CSS 时长同档

进出场复用 `useDialogTransition(isOpen, durationMs, appear)`，默认 base、双 rAF 进场，
`appear=false` 只跳过首次进入。返回的 `onTransitionEnd` 或 `onAnimationEnd`
挂到执行退出动画的根元素，忽略子元素冒泡与重开后迟到的信号；计时器作为卸载兜底。
CSS 与 JS 两个数字对不上就会把过渡截断：

```tsx
// ❌ 卸载比过渡早 60ms，淡出收尾被硬切（不报错，只是"关起来有点生硬"）
useDialogTransition(isOpen, 120)          // JS
className="transition-opacity duration-180"  // CSS

// ✅ 两边同档
useDialogTransition(isOpen, UI_DIALOG_TRANSITION_MS)  // = UI_DURATION.base
className={`transition-opacity ${UI_DURATION_CLASS.base} ${UI_EASE_CLASS}`}
```

⚠️ 不能写 `` `duration-${UI_DURATION.base}` `` —— Tailwind 扫不到运行时拼接的类名，
不会生成任何 CSS。两边都写字面量，`motion.test.ts` 负责保证它们不漂移。

### 过渡什么、不过渡什么

| 结论 | 说明 |
|---|---|
| ✅ `opacity` / `transform` | 只走合成器，不触发布局与绘制 |
| ✅ `transition-colors` | 颜色变化，代价可接受 |
| ❌ 裸 `transition` | 它会把 `backdrop-filter` 也纳入过渡——每帧重算模糊，是最贵的一种 |
| ❌ `transition-all` | 已归零，别再引入 |
| ❌ 布局属性（`width`/`height`/`padding`/`margin`/`top`/`left`） | 过渡期间每帧重排。要位移用 `transform: translate`，要伸缩优先 `scale` |

确需过渡多个属性时**显式列举**：`transition-[opacity,transform]`。

### 内联 `style={{ transition }}` 走 `uiTransition()`

内联过渡绕过 Tailwind 类，也就绕过了档位约束——收敛前这里散落 9 种时长与 5 种缓动。
时长来自运行时数据（如进度学习给出的时长）或属性没有对应 Tailwind 类时，用这个出口：

```tsx
import { uiTransition, UI_DURATION } from '@/components/ui/motion'

style={{ transition: uiTransition(['opacity', 'transform'], UI_DURATION.slow) }}
// 带延迟：uiTransition(['opacity'], UI_DURATION.slow, UI_DURATION.fast)
```

**绝不要传 `['all']`** —— 那会把 `background-color`、`backdrop-filter` 一起拖进过渡。

### 无法用 transform 替代的布局过渡（已登记，不要"顺手优化"）

这几处过渡的是布局属性，但**改不动**——容器宽度会驱动兄弟元素布局，transform 不参与布局：

| 位置 | 属性 | 为什么改不了 |
|---|---|---|
| `src/components/ui/fileUploader/StackedMediaUploader.tsx` / `src/workspaces/GenerationWorkspace/components/TaskInputPreview.tsx` | `width` | 容器宽度变化要带动兄弟重排，这正是需要的效果 |
| `src/components/TabContainer.tsx` | `padding` | 助手停靠的 inset，工作区必须真的收缩；resize 期间已用 `--assistant-layout-transition-duration: 0ms` 关掉过渡 |
| `src/components/ui/layout.tsx` 的 `UiDisclosurePanel` | `grid-template-rows` | `0fr → 1fr` 是 auto-height 动画的推荐做法，替代方案（max-height / JS 测高）更差 |
| `src/workspaces/GenerationWorkspace/components/FloatingInputPanel.tsx` | `max-height` | 同上，折叠展开的高度动画 |
| `src/workspaces/GenerationWorkspace/components/TaskInputPreview.tsx` | `margin` | 缩略图堆叠的重叠间距，margin 影响兄弟位置 |

**已经改掉的**：`FloatingInputPanel` 的 `top` 与 `StackedMediaUploader` 的 `left`/`top`
都已合并进 `transform`（绝对定位元素的位移没有理由走布局属性）。
合并时注意 **`translate` 必须写在 `rotate`/`scale` 之前**，否则旋转缩放会一起作用到位移量上。

## 减少动效

系统 `prefers-reduced-motion: reduce` 由 `index.css` 统一接管元素与伪元素：
transition/animation 时长压到 0.01ms，延迟清零，循环只播一次，平滑滚动关闭。
保留近零时长以便已有结束事件能够触发，而不是用 `animation: none` 吞掉结束信号。
已有 `motion-safe:` 可保留；新调用不依赖每处写前缀才能尊重系统偏好。

只允许对必要的进行中反馈在**动画元素本身**写 `data-motion-essential`；
标记不放行整个子树，不能加到页面/弹窗外壳上，也不能用于装饰或进出场。
普通 spin/pulse 默认停止，静止图标与文字继续表达任务状态。

公共 `useDialogTransition` 读取并订阅系统偏好：减少动效时直接显示/立即卸载，
运行中改变偏好会取消当前 rAF/退出计时，并在卸载时清理订阅。
尚未迁移的手写状态机可能仍保留原卸载计时，调用方迁移后才能统一生命周期。
中心页“模拟减少动态”只影响本栏回放；验证正式组件必须切换系统偏好。

## 高频交互与逐字预览

数值拖动、滑杆、画布平移需要跟手，不用动画延迟数据更新。
提示词逐字 span 保持 `display: inline` 与正常换行，只播放 opacity 淡入；
非替换 inline 盒不支持 transform，不能以无效位移掩盖问题。
不要在批量生成元素的静态类上永久设置 `will-change`；确需提升合成层时
仅在交互期间添加并及时清理（performance.md 的复用规则由任务 4.7 维护）。
