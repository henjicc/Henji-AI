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

### 登记制视觉数值（颜色与控件外观已进门禁；间距与 unusedToken 由任务 5.2 接入局部严格门禁）

| 维度 | 允许的写法 | 禁止 |
|---|---|---|
| 颜色 | 语义令牌类（类名颜色 = 主题 CSS 变量名去掉 `--`，见 `tailwind.config.js` 与 `color-and-material.md`）：表面 `bg-gap/window/canvas/panel/raised/control/hover/selected/media`；文字 `text-text1 > text-text2 > text-text3`；线 `border-line/line-strong`；强调与状态 `bg-accent`、`text-accent-text`、`text-on-accent`、`bg-danger-solid`、`text-danger-text`、`bg-*-tint`；压在媒体上 `text-on-media`、`bg-media-control`、`border-media-line` | 一切 `*-zinc-*` 等固定调色板、黑白类、rgba、命名色、旧别名类（`bg-app`、`text-text-muted`、`border-border-dark`、`brand-*`…），由 ESLint 与 `check:colors` 拦截 |
| 动效 | 时长 `duration-120/180/240/500`（对应 `UI_DURATION` 四档）；缓动走全局默认；过渡属性显式列举；内联过渡走 `uiTransition()` | 裸 `transition`、`transition-all`、`transition: all`、未登记时长、自造缓动 |
| 字号 | 优先排版令牌；`text-2xs`(11) `text-13` `text-15` / `text-xs` `text-sm` `text-base` / `text-xl`；界面文字最小 11，`text-3xs`(10) 只用于媒体叠层读数、标尺刻度 | `text-[Npx]` |
| 圆角 | `rounded-control`(6 控件) `rounded-field`(8 输入与菜单) `rounded-overlay`(12 浮层)，`rounded-md/lg/xl` 指向同一组变量，随「界面圆角」设置缩放；`rounded-none` `rounded-full` `rounded-hairline`；画布节点 `rounded-[var(--node-radius)]` | 其他 `rounded-[...]` |
| 阴影 | `shadow-panel`(仅浮层) / `shadow-node-selected` `shadow-node-error` `shadow-thumb` `shadow-thumb-sm` `shadow-thumb-ring`(具名特效；`thumb-ring` = 内容色滑杆滑块的 1px 固定深色细线 + 投影，配白边形成双色轮廓，任何内容色上都可辨认) | `shadow-[...]`；颜色走主题 `shade` 令牌，浅色下自动变浅 |
| 层级 | `z-base` `z-raised` `z-sticky` `z-dropdown` `z-panel` `z-modal` `z-viewer` `z-toast` `z-popover`(挂到 body 的下拉与面板触发器浮层) `z-tooltip` `z-drag` `z-titlebar` | `z-[9999]` 等任意值、`z-10/20/…` 数字类 |

**内层圆角不得大于外层。阴影只有浮层能用，内容区一律无阴影。**

必须内联 `style={{ zIndex }}` 时（如每帧改 transform 的拖拽层）用 `Z_LAYERS`（`src/core/theme/zLayers.ts`），它与 Tailwind 配置互为镜像，改一侧要同步另一侧。


画布内部（ReactFlow 节点 / minimap / Alt 拖拽副本）有自己独立的局部 z 刻度，见 `src/features/canvas/canvasUtils.ts`，不要和全局档位混用。

## 排版细节（避免"挤"和"散"）

- **纵横共用间距 2/4/6/8/12/16/20/24/32**（Tailwind `0.5/1/1.5/2/3/4/5/6/8`，零值可用）；不要出现 `p-[13px]` 这类随手值。分区之间用 `UI_SECTION_STACK_CLASS`（32）。
- **同级元素间距统一**：一个分区内所有行用同一个 `space-y-*`，不要一行 `mt-2` 一行 `mt-3`。
- **控件高度统一**：28 / 32 / 36 三档（`UI_CONTROL_HEIGHT_CLASS`，CSS 变量 `--size-control-*`）；所有行控件共用 `UiControlSize`；图标按钮为 20/24/28/32/36/40（`size` 2xs/xs/sm/md/lg/xl，xl 只给全屏查看器与画面中央播放键）。按钮、字段、选项、标签、字段触发器、数值框都用组件的 `size` 枚举，只读数值用 `UiReadout`；不要在调用点写 `h-8` / `h-[38px]`（`check:surface` 规则 E 拦截）。
- **文字层级只用三档灰**：主要 `text-text1`、次要 `text-text2`、辅助 `text-text3`（禁用另有 `text-text-disabled`）；强调文字 `text-accent-text`。不要引入第四种灰，也不要用透明度调出新的灰（`text-text1/60` 对比度不受引擎保证）。
- **圆角跟随层级**：L1 用 `rounded-xl`，L2/L3 用 `rounded-lg`。内层圆角不得大于外层。
- **颜色只用语义类**：`bg-window` / `bg-panel` / `bg-raised` / `bg-hover` / `text-text2` / `border-line`。禁止十六进制与旧别名类（`npm run check:colors` 会拦）。

## 行高、条带与面板

字号/行高固定配对：3xs 10/14、2xs 11/16、xs 12/16、13 13/20、sm 14/20、15 15/22、base 16/24、xl 20/28。`text-14` 已并入 `text-sm`；默认字号、阴影、圆角由 Tailwind 覆盖式登记，未登记档不生成 CSS。

| 场景 | 唯一入口与档位 |
|---|---|
| 横向动作组 | `UI_INLINE_GAP_CLASS` / `UiToolbar.gap`：micro 2、tight 4、control 6、group 8、row 12、section 16 |
| 纵向堆叠 | `UI_STACK_CLASS`：tight 4、control 6、group 8、row 12、section 16、form 20、stack 24、region 32 |
| 条带 | `UI_BAND_HEIGHT_CLASS` / `UI_BAND_MIN_HEIGHT_CLASS`：row 28、tab 32、header 36、title 40、command 44；`UI_BAND_PADDING_CLASS` 横向 12 |
| 表单行 | `UI_FORM_ROW_MIN_HEIGHT_CLASS` 与 sm28/md32/lg36 控件对齐；行的排布行为由 UiFormRow 管理 |
| 多行文本 | `UI_TEXT_AREA_HEIGHT_CLASS`；UiTextArea、PromptEditor 的 `height` short92/medium120/tall240，填充滚动布局不传 height 时跟随容器 |
| 浮层 | `UI_TRIGGER_PANEL_SIZE_CLASS`；PanelTrigger/Dropdown 的 `panelSize` menu/compact/content/workspace，用 min/clamp 约束视口；内容测量菜单继续按测得宽度定位 |
| 面板正文 | `UI_PANEL_BODY_HEIGHT_CLASS` compact/content/workspace，按视口和内容上限双重约束；浮动输入区用 `UI_INPUT_PANEL_MAX_HEIGHT_CLASS` |
| 拖动面板 | `UI_PANEL_WIDTH`（core/theme/panelSizes.ts）：rail52、sidebar184/232/360、inspector248/320/460、assistant 最小320默认420；拖动由宿主夹取视口 |
| 弹窗正文 | `UI_MODAL_CONTENT_PADDING_CLASS` / `contentPadding` default16、none0、spacious横24纵20；`contentScroll` auto/none 与留白分离，contentClassName 只补布局 |
| 浮层投影 | `--shadow-overlay` 唯一几何，实底与玻璃共用；玻璃内侧亮边仍属于材质 |

间距迁移：最近档，等距向上（10→12、14→16、28→32）。图标槽、负偏移、相对字体单位和大块空态需结合布局判断，不按数值盲替换。不得覆盖全局 spacing 以免连带改变宽高和定位。`veil`、`--ui-radius-*`、`leading-5.5`、`UI_ACCENT_HEX` 已删除；媒体层用 media/on-media。主题仅推导 accent/danger 的静息、悬停、按下纯色，不再生成 hi/hover-hi。

记录留白由 UiRecordItem 的 density 管理：page 每侧20、panel 每侧12、compact 每侧4，内部 gap-2；边界复用 UI_DIVIDER_CLASS。UiFormRow.trailing 占 sm 控件宽度（28），同组传 null 保持列对齐。
