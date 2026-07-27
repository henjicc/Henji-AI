# 动效档位

（`henji-ui-surface` 的参考文档。写任何过渡、动画、JS 计时前读这份。）

## 动效：三档时长，一种缓动

收敛前实测：**8 种时长**（200/150/300/250/220/100/75/500）、两种缓动混用、
42 处裸 `transition`，且 JS 计时常量与 CSS 时长对不上。

档位定义在 `src/components/ui/motion.ts`：

| 档 | 值 | 用途 |
|---|---|---|
| `fast` | 150ms | hover、颜色、开关、小控件 |
| `base` | 200ms | 弹窗、浮层、下拉、面板开合 —— **默认档** |
| `slow` | 300ms | 大面积位移、通知 Toast、悬浮面板折叠、缩略图扇形展开 |
| `viewer` | 500ms | 全屏媒体查看器的沉浸式淡入淡出 |

位移/覆盖面积越大，时长就该越长——`viewer` 不是随手加的档，是 7 处查看器实际在用的聚类。

**缓动不需要每处写。** `tailwind.config.js` 已把 `transitionTimingFunction.DEFAULT`
改成 `ease-out` 的值，所有 `transition-*` 工具类自动拿到正确缓动。
（Tailwind 原本的默认是 `ease-in-out`，起步和收尾都慢，小尺度 UI 上显得拖沓。）
需要别的缓动时才显式写 `ease-linear` / `ease-in`。

唯一登记的例外缓动是 `UI_EASE_STACK`（缩略图扇形展开的弹性感），和具名阴影同一个逻辑：
有具体功能语义才登记。**不要为了"想要点不一样"再发明缓动。**

### JS 计时必须和 CSS 时长同档

组件常见写法是"先播淡出、再用 `setTimeout` 卸载"。两个数字对不上就会把过渡截断：

```tsx
// ❌ 卸载比过渡早 20ms，淡出收尾被硬切（不报错，只是"关起来有点生硬"）
useDialogTransition(isOpen, 180)          // JS
className="transition-opacity duration-200"  // CSS

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
| `StackedMediaUploader` / `TaskInputPreview` / `AssetLibrarySurface` | `width` | 容器宽度变化要带动兄弟重排，这正是需要的效果 |
| `TabContainer` | `padding` | 助手停靠的 inset，工作区必须真的收缩；resize 期间已用 `--assistant-layout-transition-duration: 0ms` 关掉过渡 |
| `LlmSettingsSection` | `grid-template-rows` | `0fr → 1fr` 是 auto-height 动画的推荐做法，替代方案（max-height / JS 测高）更差 |
| `FloatingInputPanel` | `max-height` | 同上，折叠展开的高度动画 |
| `TaskInputPreview` | `margin` | 缩略图堆叠的重叠间距，margin 影响兄弟位置 |

**已经改掉的**：`FloatingInputPanel` 的 `top` 与 `StackedMediaUploader` 的 `left`/`top`
都已合并进 `transform`（绝对定位元素的位移没有理由走布局属性）。
合并时注意 **`translate` 必须写在 `rotate`/`scale` 之前**，否则旋转缩放会一起作用到位移量上。
