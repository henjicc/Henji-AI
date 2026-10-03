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
| 颜色 | 语义令牌类（类名颜色 = 主题 CSS 变量名去掉 `--`，见 `tailwind.config.js`）：表面 `bg-window/panel/raised/control/hover/selected/gap/media`；文字 `text-text1 > text-text2 > text-text3`；线 `border-line/line-strong`；强调与状态 `bg-accent`、`text-accent-text`、`text-on-accent`、`bg-danger-solid`、`text-danger-text`、`bg-*-tint`；压在媒体上 `text-on-media`、`bg-media-control`、`border-media-line`。旧类名（`bg-app`、`text-text-muted`…）是过渡别名 | 一切 `*-zinc-*` 等固定调色板；新增调色板类、黑白类、rgba、命名色由 `check:colors` 拦截 |
| 动效 | 时长 `duration-120/180/240/500`（对应 `UI_DURATION` 四档）；缓动走全局默认；过渡属性显式列举；内联过渡走 `uiTransition()` | 裸 `transition`、`transition-all`、`transition: all`、未登记时长、自造缓动 |
| 字号 | 优先排版令牌；`text-2xs`(11) `text-13` `text-14` `text-15` / `text-xs` `text-sm` `text-base`+；界面文字最小 11，`text-3xs`(10)/`text-4xs`(9) 只用于媒体叠层读数、标尺刻度 | `text-[Npx]` |
| 圆角 | `rounded-control`(6 控件) `rounded-field`(8 输入与菜单) `rounded-overlay`(12 浮层)，`rounded-md/lg/xl` 指向同一组变量，随「界面圆角」设置缩放；`rounded-2xl` `rounded-3xl` `rounded-full` `rounded-hairline`；画布节点 `rounded-[var(--node-radius)]` | 其他 `rounded-[...]` |
| 阴影 | `shadow-panel`(仅浮层) / `shadow-node-selected` `shadow-node-error` `shadow-thumb` `shadow-thumb-sm`(具名特效) | `shadow-[...]` |
| 白色半透明 | `veil` 六档：`bg-veil-faint` `border-veil-subtle` `border-veil-soft` `border-veil` `border-veil-strong` `from-veil-bright` | `border-[rgba(...)]` 等 rgba 字面量 |
| 层级 | `z-base` `z-raised` `z-sticky` `z-dropdown` `z-panel` `z-modal` `z-viewer` `z-toast` `z-tooltip` `z-drag` `z-titlebar` | `z-[9999]` 等任意值、`z-10/20/…` 数字类 |

**内层圆角不得大于外层。阴影只有浮层能用，内容区一律无阴影。**

必须内联 `style={{ zIndex }}` 时（如每帧改 transform 的拖拽层）用 `Z_LAYERS`（`src/core/theme/zLayers.ts`），它与 Tailwind 配置互为镜像，改一侧要同步另一侧。


画布内部（ReactFlow 节点 / minimap / Alt 拖拽副本）有自己独立的局部 z 刻度，见 `src/features/canvas/canvasUtils.ts`，不要和全局档位混用。

## 排版细节（避免"挤"和"散"）

- **间距用 4 的倍数**：`gap-2 / gap-3 / gap-4`、`p-3 / p-4`；不要出现 `p-[13px]` 这类随手值。
- **同级元素间距统一**：一个分区内所有行用同一个 `space-y-*`，不要一行 `mt-2` 一行 `mt-3`。
- **控件高度统一**：两档具名令牌 —— `UI_FIELD_CONTROL_HEIGHT_CLASS`（42px，独立表单字段）与 `UI_FIELD_CONTROL_HEIGHT_SM_CLASS`（38px，参数面板/逐行控件/面板触发器）。两个值都不是 Tailwind 刻度，所以不要每处手写 `h-[38px]` / `h-[42px]`。
- **文字层级只用三档**：主文本 `text-text-dark`、次要 `text-text-muted`、强调 `text-accent`。不要引入第四种灰。
- **圆角跟随层级**：L1 用 `rounded-xl`，L2/L3 用 `rounded-lg`。内层圆角不得大于外层。
- **颜色只用语义类**：`bg-app` / `bg-panel` / `bg-surface-dark` / `bg-layer` / `text-text-muted` / `border-border-dark`。禁止十六进制（`npm run check:colors` 会拦）。
