# 前端 UI 令牌与硬约束

> 读取时机：写 TSX、调整样式或排查样式未生效时。详细设计规则只维护在 [henji-ui-surface](../../.codex/skills/henji-ui-surface/SKILL.md)；两侧 skill 由 check:skill-sync 保证一致。

## 规则覆盖：规则 → 门禁 → CI

新增规则必须填写门禁与覆盖边界，不能把人工判断写成已自动拦截。

| 规则 | 门禁与边界 | CI |
|---|---|---|
| 原生 button/input/select/textarea、role=button | ESLint JSX；仅 primitives.tsx 与测试替身豁免原生控件，颜色等其他规则仍生效 | 必跑 lint |
| 颜色、旧别名、未定义颜色类 | check:colors；ESLint 拦其中的字面量与灰色板 | 必跑 |
| 手写表面/弹窗/玻璃、调用点外观 | check:surface A–E；默认严格，--report 仅诊断 | 必跑严格 |
| 分段、面板行、记录、列宽、动作组、状态反馈、主动作预算 | check:surface S1–S5/S7–S9；S8 部分仅告警；动态结构交 DOM | 必跑严格 |
| 图标与同行静态 size | check:icons A–D/S6 | 必跑严格 |
| 任意值、私有样式、过期登记与旧文案 | check:ui-residue | 必跑 |
| 间距/时长/缓动/布局动效/死令牌 | check:ui-design；transition-all 另由 ESLint 拦字面量与模板 | 必跑；不宣称 build 已接入 design |
| skill 同步、目录、源码符号、令牌表 | check:skill-sync 聚合 check:ui-catalog、check:skill-symbols、gen:token-docs --check | 必跑 |
| 巡检遗留有去向、关闭项有真实 guard | check:ui-findings 与 Node 回归测试 | 随 skill-sync / Node 必跑 |
| DOM 结构、选中差异、真实对比度 | ui:tour --audit 或 check:ui-visual 共用循环；图形单独由场景像素断言 | jsdom/纯函数测试必跑；真实 Electron ui-rule-audit 仅手动试运行 |
| Windows 像素基线 | check:ui-gallery-diff；固定本机环境 | 不进 CI |
| 信息准入、材质使用语义、转换确认、截图目视 | skill/review 人工核对；已有场景只证明被覆盖状态 | 不宣称自动覆盖 |

## 详细规则唯一入口

- 容器、按钮、选中态、信息准入与组件枚举：[skill 主文件](../../.codex/skills/henji-ui-surface/SKILL.md)。分段例外由重设计记录 017 / 缺陷修复记录 014 定稿，其他单选遵循同一词汇表。
- 令牌值域与硬约束：[typography-and-tokens.md](../../.codex/skills/henji-ui-surface/references/typography-and-tokens.md)。生成块读取真实 Tailwind 配置，手写部分只解释语义；`npm run gen:token-docs` 同步两侧。
- 动效：[motion.md](../../.codex/skills/henji-ui-surface/references/motion.md)；图标：[icons.md](../../.codex/skills/henji-ui-surface/references/icons.md)；核对与遗留闭环：[review.md](../../.codex/skills/henji-ui-surface/references/review.md)。
- 验收先按 [testing.md](testing.md) 判级；只在精确测试不能证明公共布局、滚动、溢出或跨主题风险时升级真实截图，同一矩阵只跑一次 --audit。

## 令牌速查入口

| 类别 | 写法 / 唯一来源 |
|---|---|
| 颜色 | 语义类；Tailwind 类名映射主题变量；媒体用 media/on-media |
| 字号 | UI_TEXT_*_CLASS；正文 13；详细值域由生成表列出 |
| 圆角 | control/field/overlay；嵌套内层不得大于外层 |
| 阴影 / 层级 | 具名 shadow；语义 z 类或 Z_LAYERS |
| 间距 | 2/4/6/8/12/16/20/24/32；UI_INLINE_GAP_CLASS / UI_STACK_CLASS |
| 控件高 | UiControlSize sm28/md32/lg36；图标按钮附属 2xs20/xs24/xl40 |
| 动效 | UI_DURATION 与 UI_LOOP_MS；内联过渡用 uiTransition |

## 已知静默失效坑

这些不会报错、不会被类型系统发现，只会"看起来没生效"：

1. **透明度修饰符只能用 Tailwind 刻度值（步进 5）**：`bg-black/72`、`border-white/42` 这类非刻度值**不生成任何 CSS**。需要精确比例时在令牌定义处登记，业务不可写黑白或任意颜色。
2. **同属性叠类胜负看 Tailwind 产物顺序**，不是 className 顺序。优先写成互斥三元；确需叠加先生成 CSS 确认谁在后面。
3. **不要写 `dark:` 变体**：深浅色由主题引擎改变量完成，`darkMode: 'class'` 只为让误写的 `dark:` 永不生效。
4. **全局主题变量只能放 `src/index.css`**：放在 `storyboard.css` 这类被工作区懒加载的样式表里，会导致设置项在用户打开对应工作区之前完全不生效。
5. **布局定位不得藏在外观样式表**：`scrollbar.css` 等具名样式表只能承担文件名承诺的外观或行为；`position`、`top/right/bottom/left`、`z-index` 必须直接写在组件 className。已知两次事故——`scrollbar.css` 藏 `position: fixed` 导致工作区逃逸助手插入量；懒加载的 `storyboard.css` 藏全局主题变量导致设置延迟生效。只 grep JSX 或按文件名查 CSS 都很难发现，确需 CSS 例外时必须就地注释原因。
6. **`accent` 不能作文字色**（填充色，对比度不足），文字用 `text-accent-text`（`UI_COLOR_ACCENT_TEXT_CLASS`）；字压在强调实底上用 `bg-accent text-on-accent`，不写死白字。
7. **同一插件的颜色类按类名字母序输出**（Tailwind 3.4），给类改名可能改变两个同属性类的胜负；同一元素上只留一个颜色类（互斥三元）。

## 颜色查改入口

主题色的推导规则只改 `src/core/theme/themeEngine.ts`（改后同步 `index.css` 的 `theme-tokens` 静态默认值，`themeStaticDefaults.test.ts` 会校验）；Tailwind 映射改 `tailwind.config.js`；组件皮肤改 `src/index.css` 与 `src/components/ui/styleTokens.ts`；内容色登记 `src/core/theme/colorTokens.ts`。`npm run check:colors` 会扫 `.ts/.tsx/.css`，纯 CSS 里只能写 `rgb(var(--xxx-rgb) / a)` 或 `var(--token)`。图像处理/画布像素算法可例外，但优先复用 token。

`Z_LAYERS` 与 `tailwind.config.js` 互为镜像，需同步修改。
