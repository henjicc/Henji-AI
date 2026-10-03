# 排版层级与登记制视觉数值

（`henji-ui-surface` 的参考文档。定字号、圆角、阴影、层级、间距时读这份。）

## 用排版建立层级，而不是用框

项目此前 72% 的字号决策都落在 `text-xs` 及更小，层级塌缩成"全是小字"，于是只能靠边框背景区分内容。
**先用排版令牌（`styleTokens.ts`）表达层级，再考虑容器：**（字体 Geist + 系统中文字体，正文基准 13px）

| 令牌 | 字号/字重 | 用途 |
|---|---|---|
| `UI_TEXT_TITLE_CLASS` | 20/600 | 页面/弹窗主标题 |
| `UI_TEXT_SECTION_CLASS` | 16/600 | 分区标题 |
| `UI_TEXT_PANEL_TITLE_CLASS` | 14/500 | 面板标题 |
| `UI_TEXT_BODY_CLASS` | 13/400 | 正文与控件 |
| `UI_TEXT_LABEL_CLASS` | 13/500 | 字段标签 |
| `UI_TEXT_SECONDARY_CLASS` | 12/400 | 次要信息 |
| `UI_TEXT_META_CLASS` | 11/500 | 辅助说明、元信息 |
| `UI_TEXT_NUMERIC_CLASS` / `UI_TEXT_TIMECODE_CLASS` | — | 等宽数字 / Geist Mono 时间码 |

### 登记制视觉数值（以下全部由 ESLint 硬性拦截，写了会报错）

| 维度 | 允许的写法 | 禁止 |
|---|---|---|
| 颜色 | 语义令牌类（类名颜色 = 主题 CSS 变量名去掉 `--`，见 `tailwind.config.js` 与 `color-and-material.md`）：表面 `bg-gap/window/canvas/panel/raised/control/hover/selected/media`；文字 `text-text1 > text-text2 > text-text3`；线 `border-line/line-strong`；强调与状态 `bg-accent`、`text-accent-text`、`text-on-accent`、`bg-danger-solid`、`text-danger-text`、`bg-*-tint`；压在媒体上 `text-on-media`、`bg-media-control`、`border-media-line` | 一切 `*-zinc-*` 等固定调色板、黑白类、rgba、命名色、旧别名类（`bg-app`、`text-text-muted`、`border-border-dark`、`brand-*`…），由 ESLint 与 `check:colors` 拦截 |
| 动效 | 时长 `duration-120/180/240/500`（对应 `UI_DURATION` 四档）；缓动走全局默认；过渡属性显式列举；内联过渡走 `uiTransition()` | 裸 `transition`、`transition-all`、`transition: all`、未登记时长、自造缓动 |
| 字号 | 优先排版令牌；`text-2xs`(11) `text-13` `text-14` `text-15` / `text-xs` `text-sm` `text-base`+；界面文字最小 11，`text-3xs`(10)/`text-4xs`(9) 只用于媒体叠层读数、标尺刻度 | `text-[Npx]` |
| 圆角 | `rounded-control`(6 控件) `rounded-field`(8 输入与菜单) `rounded-overlay`(12 浮层)，`rounded-md/lg/xl` 指向同一组变量，随「界面圆角」设置缩放；`rounded-2xl` `rounded-3xl` `rounded-full` `rounded-hairline`；画布节点 `rounded-[var(--node-radius)]` | 其他 `rounded-[...]` |
| 阴影 | `shadow-panel`(仅浮层) / `shadow-node-selected` `shadow-node-error` `shadow-thumb` `shadow-thumb-sm` `shadow-thumb-ring`(具名特效；`thumb-ring` = 内容色滑杆滑块的 1px 固定深色细线 + 投影，配白边形成双色轮廓，任何内容色上都可辨认) | `shadow-[...]`；颜色走主题 `shade` 令牌，浅色下自动变浅 |
| 白色半透明 | `veil` 六档是固定白纱（不随主题），只用于压在媒体/深色画布上：`bg-veil-faint` `border-veil-subtle` `border-veil-soft` `border-veil` `border-veil-strong` `from-veil-bright`；新代码优先 `media-*` / `on-media` | `border-[rgba(...)]` 等 rgba 字面量；在主题表面（面板、弹窗）上用 veil——纸白下不可见，用 `border-line` / `bg-hover` |
| 层级 | `z-base` `z-raised` `z-sticky` `z-dropdown` `z-panel` `z-modal` `z-viewer` `z-toast` `z-popover`(挂到 body 的下拉与面板触发器浮层) `z-tooltip` `z-drag` `z-titlebar` | `z-[9999]` 等任意值、`z-10/20/…` 数字类 |

**内层圆角不得大于外层。阴影只有浮层能用，内容区一律无阴影。**

必须内联 `style={{ zIndex }}` 时（如每帧改 transform 的拖拽层）用 `Z_LAYERS`（`src/core/theme/zLayers.ts`），它与 Tailwind 配置互为镜像，改一侧要同步另一侧。


画布内部（ReactFlow 节点 / minimap / Alt 拖拽副本）有自己独立的局部 z 刻度，见 `src/features/canvas/canvasUtils.ts`，不要和全局档位混用。

## 排版细节（避免"挤"和"散"）

- **间距档位 4/8/12/16/24/32**（`gap-1/2/3/4/6/8`、`p-2/3/4`）；不要出现 `p-[13px]` 这类随手值。分区之间用 `UI_SECTION_STACK_CLASS`（32）。
- **同级元素间距统一**：一个分区内所有行用同一个 `space-y-*`，不要一行 `mt-2` 一行 `mt-3`。
- **控件高度统一**：28 / 32 / 36 三档（`UI_CONTROL_HEIGHT_CLASS`，CSS 变量 `--size-control-*`）；图标按钮另有 20/24/28/32/40（`size` xs–xl，xl 只给全屏查看器与画面中央播放键）。按钮、字段、选项、标签、字段触发器、数值框都用组件的 `size` 枚举，不要在调用点写 `h-8` / `h-[38px]`（`check:surface` 规则 E 拦截）。
- **文字层级只用三档灰**：主要 `text-text1`、次要 `text-text2`、辅助 `text-text3`（禁用另有 `text-text-disabled`）；强调文字 `text-accent-text`。不要引入第四种灰，也不要用透明度调出新的灰（`text-text1/60` 对比度不受引擎保证）。
- **圆角跟随层级**：L1 用 `rounded-xl`，L2/L3 用 `rounded-lg`。内层圆角不得大于外层。
- **颜色只用语义类**：`bg-window` / `bg-panel` / `bg-raised` / `bg-hover` / `text-text2` / `border-line`。禁止十六进制与旧别名类（`npm run check:colors` 会拦）。
