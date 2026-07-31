# 前端 UI 令牌与硬约束

> 读取时机：写任何 `.tsx` 界面代码、调颜色/圆角/阴影/层级/动效、排查"改了样式却没生效"时。
>
> 与 skill `henji-ui-surface` 的分工：**本文件是写代码时随时对照的令牌清单与已知坑**（大多由 ESLint 硬拦）；**skill 是动手前的设计决策流程**（用什么容器、几条横向条带、卡片准入、按钮层级、分隔线准入）。新建或改造界面/面板/弹窗/设置分区前先读 skill，写具体样式时查本文件。

## 统一入口

- 业务组件（`components/`、`features/`、`workspaces/`）只消费 `@/components/ui` 导出的 `Ui*` 组件
- 原生 `<button>/<input>/<select>/<textarea>` 只允许在 `src/components/ui/primitives.tsx` 中实现；禁止在业务组件重新引入原生控件并单独写样式
- 能复用现有 `Ui*`、`Dropdown`、`PanelTrigger` 时优先复用
- **新增通用组件的门槛**：只有现有组件确实覆盖不了时才新增；动手前先告诉用户原因和替代方案，等用户确认后再创建
- 新增交互控件优先扩展 `Ui*`（`UiButton`/`UiInput`/`UiOptionButton`），再由业务层复用
- 状态展示统一用 `UiEmpty`/`UiLoading`/`UiError`，禁止页面内联手写状态块
- 弹窗统一走 `UiModal` 或 `AlertDialog`，禁止手写 `fixed inset-0` + 遮罩 + 卡片外壳（全屏媒体查看器是已确认的例外）

## 界面文案

只呈现用户需要理解的目标、状态、结果与可执行动作。禁止把实现机制、协议名、风险分级、内部缩写、调试信息或面向开发者的解释写进正式界面；不要为了说明代码如何工作而增加辅助文案。确需帮助用户决策时，改写成用户能理解的影响与后果；仅供排查的信息进入日志、开发模式或调试界面。

## 令牌硬约束（ESLint 拦截）

| 类别 | 只允许 | 禁止 |
|---|---|---|
| 颜色 | 语义类 `bg-app/panel/surface-dark/layer`、`text-text-dark/soft/muted/faint`、`border-border-dark`、`veil` 六档 | 一切 `*-zinc-*`、`#hex`、`rgba(数字…)` |
| 字号 | `text-4xs/3xs/2xs/13/14/15`、`text-xs/sm/base+` | `text-[Npx]` |
| 圆角 | `rounded-lg/xl/2xl/3xl/full/hairline`（画布节点用 `rounded-[var(--node-radius)]`） | 其它 `rounded-[..]` |
| 阴影 | `shadow-panel`（仅浮层）、`shadow-node-selected/node-error/thumb/thumb-sm` | `shadow-[..]` |
| 层级 | `z-raised/sticky/dropdown/panel/modal/viewer/toast/tooltip/drag/titlebar`；内联用 `Z_LAYERS`（`src/core/theme/zLayers.ts`） | `z-[..]` |
| 毛玻璃 | `ui-glass` 类、遮罩 `ui-glass-scrim` | 一切 `backdrop-blur-*` |
| 动效时长 | `duration-150/200/300/500`（= `UI_DURATION.fast/base/slow/viewer`） | 其它时长、`transition: all` |
| 控件高度 | `UI_FIELD_CONTROL_HEIGHT_CLASS`(42px) / `UI_FIELD_CONTROL_HEIGHT_SM_CLASS`(38px) | 手写 `h-[38px]` |

补充：

- 文字四档中间两档由 `runtimeTheme.applyTextScale` 派生
- `veil` 六档用于叠在图片/视频/画布上的边框与底色
- 排版层级先用 `styleTokens.ts` 的 `UI_TEXT_TITLE/SECTION/BODY/LABEL/META_CLASS` 建立，再考虑容器装饰
- 通用视觉 token 在 `src/components/ui/styleTokens.ts` 维护，业务组件不直接复制 token 字符串

## 毛玻璃是材质不是 blur 值

`ui-glass`（定义在 `src/index.css`）含 blur + saturate + 受光边 + 噪点四层；只写 blur 会得到"模糊+降不透明度"的廉价观感。只用于压在图片/视频/画布上的浮层，压在纯色 UI 上一律用不透明底色。质感调整只改 `--ui-glass-*` 变量。「设置→界面→毛玻璃效果」关掉时整套材质退化成不透明底色。

## 动效

缓动已由 `tailwind.config.js` 的 `transitionTimingFunction.DEFAULT` 全局设为 ease-out，不用每处写；唯一登记的例外是 `UI_EASE_STACK`。内联 `style={{ transition }}` 走 `uiTransition()`。用 `setTimeout` 卸载动画组件时，那个 ms 必须与 className 里的 `duration-*` 同档，否则过渡收尾被硬切。过渡布局属性前先确认无法用 transform 替代。

## 图标是视觉令牌

- 业务组件禁止手写 inline `<svg>`，图标一律走 `lucide-react`
- 跨界面复用的业务概念图标（资产库、工作区、工具、媒体类型）必须引用 `src/core/theme/icons.ts` 的登记常量
- 通用动作图标（`X`/`Plus`/`Check`/`Trash2`）直接从 lucide 引入即可
- 禁止建"本目录自己的图标模块"
- 波形、缓动曲线、连线预览这类**路径由数据算出**的 `<svg>` 不是图标，在 `scripts/check-icon-tokens.cjs` 豁免名单里

## 已知静默失效坑

这些不会报错、不会被类型系统发现，只会"看起来没生效"：

1. **透明度修饰符只能用 Tailwind 刻度值（步进 5）**：`bg-black/72`、`border-white/42` 这类非刻度值**不生成任何 CSS**。需要精确值用 `bg-black/[0.72]` 或登记具名色。
2. **同属性叠类胜负看 Tailwind 产物顺序**，不是 className 顺序。优先写成互斥三元；确需叠加先生成 CSS 确认谁在后面。
3. **`index.html` 写死 `class="dark"`**，`dark:` 变体的基础值是死代码。
4. **全局主题变量只能放 `src/index.css`**：放在 `storyboard.css` 这类被工作区懒加载的样式表里，会导致设置项在用户打开对应工作区之前完全不生效。
5. **布局定位不得藏在外观样式表**：`scrollbar.css` 等具名样式表只能承担文件名承诺的外观或行为；`position`、`top/right/bottom/left`、`z-index` 必须直接写在组件 className。已知两次事故——`scrollbar.css` 藏 `position: fixed` 导致工作区逃逸助手插入量；懒加载的 `storyboard.css` 藏全局主题变量导致设置延迟生效。只 grep JSX 或按文件名查 CSS 都很难发现，确需 CSS 例外时必须就地注释原因。
6. **`accent` 不能作文字色**（对比度 2.82:1），用 `UI_COLOR_ACCENT_TEXT_CLASS`；白字压实心蓝用 `UI_COLOR_ACCENT_FILL_TEXT_CLASS`（`bg-accent` 只有 3.68:1）。

## 颜色查改入口

调色只允许改 `src/index.css`、`tailwind.config.js`、`src/components/ui/styleTokens.ts` 三处。`npm run check:colors` 会扫 `.ts/.tsx/.css`，纯 CSS 里只能写 `rgb(var(--xxx-rgb) / a)`。图像处理/画布像素算法可例外，但优先复用 token。

`Z_LAYERS` 与 `tailwind.config.js` 互为镜像，需同步修改。

## 界面改动后的检查

见 [docs/rules/testing.md](../../docs/rules/testing.md) 的「界面改动」一节。改颜色令牌的派生比例后必须复跑 `npm run check:ui-visual`。
