# 排版层级与登记制视觉数值

（`henji-ui-surface` 的参考文档。定字号、圆角、阴影、层级、间距时读这份。）

## 用排版建立层级，而不是用框

项目此前 72% 的字号决策都落在 `text-xs` 及更小，层级塌缩成"全是小字"，于是只能靠边框背景区分内容。
**先用这五档排版令牌（`styleTokens.ts`）表达层级，再考虑容器：**

| 令牌 | 用途 |
|---|---|
| `UI_TEXT_TITLE_CLASS` | 页面/弹窗主标题 |
| `UI_TEXT_SECTION_CLASS` | 分区标题 |
| `UI_TEXT_BODY_CLASS` | 正文 |
| `UI_TEXT_LABEL_CLASS` | 字段标签 |
| `UI_TEXT_META_CLASS` | 辅助说明、元信息 |

### 登记制视觉数值（以下全部由 ESLint 硬性拦截，写了会报错）

| 维度 | 允许的写法 | 禁止 |
|---|---|---|
| 颜色 | 语义色：底面 `bg-app/panel/surface-dark/layer`；文字四档 `text-text-dark > text-text-soft > text-text-muted > text-text-faint`；边框 `border-border-dark`；媒体与玻璃质感边框用 `veil` 档位 | 一切 `*-zinc-*` 等固定调色板 |
| 动效 | 时长 `duration-150/200/300/500`（对应 `UI_DURATION` 四档）；缓动走全局默认；过渡属性显式列举；内联过渡走 `uiTransition()` | 裸 `transition`、`transition-all`、`transition: all`、未登记时长、自造缓动 |
| 字号 | `text-4xs`(9) `text-3xs`(10) `text-2xs`(11) `text-13` `text-14` `text-15` / `text-xs` `text-sm` `text-base`+ | `text-[Npx]` |
| 圆角 | `rounded-lg`(控件/内嵌) `rounded-xl`(浮层) `rounded-2xl` `rounded-3xl` `rounded-full` `rounded-hairline`；画布节点 `rounded-[var(--node-radius)]` | 其他 `rounded-[...]` |
| 阴影 | `shadow-panel`(仅浮层) / `shadow-node-selected` `shadow-node-error` `shadow-thumb` `shadow-thumb-sm`(具名特效) | `shadow-[...]` |
| 白色半透明 | `veil` 六档：`bg-veil-faint` `border-veil-subtle` `border-veil-soft` `border-veil` `border-veil-strong` `from-veil-bright` | `border-[rgba(...)]` 等 rgba 字面量 |
| 层级 | `z-raised` `z-sticky` `z-dropdown` `z-panel` `z-modal` `z-viewer` `z-toast` `z-tooltip` `z-drag` `z-titlebar` | `z-[9999]` 等任意值 |

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
