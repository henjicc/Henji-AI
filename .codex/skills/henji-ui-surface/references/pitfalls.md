# 已知静默失效与结构性坑

（`henji-ui-surface` 的参考文档。"改了但没生效"时先翻这份。）

## 同属性叠类 = 静默失效（本仓库最常见的隐蔽 bug）

> **两个工具类落在同一个 CSS 属性上时，胜负看 Tailwind 产物里的先后顺序，不看 className 里的顺序。**

`className={"bg-panel/30 " + (dragging ? "bg-surface-dark/55" : "")}` 读起来像"拖拽时换底色"，
实际上谁在生成的 CSS 里靠后谁赢，和你写的顺序无关。这类 bug 不报错、不警告，只是"那个效果一直没出现"。

本项目已经因此踩过三次：

| 现象 | 真相 |
|---|---|
| 筛选 chip 的选中态是"蓝框+灰底"而不是实心蓝 | 变体自带的 `bg-layer` 排在调用方传的 `bg-brand-600` 之后，令牌从未生效 |
| 上传区的拖拽高亮从来没亮过 | 底色 `bg-zinc-900/30` 排在高亮 `bg-zinc-800/55` 之后 |
| `UiOptionButton` 的 `menu` 变体差点盖掉网格底色 | 变体里的 `bg-transparent` 会和调用方的 `bg-veil-faint` 抢 |

**三条做法，按优先级：**

1. **写成互斥三元**：`dragging ? 'bg-surface-dark/55' : 'bg-panel/30'` —— 任何时刻只有一个类，根本不存在打架。
2. **变体里不写"默认值等于浏览器默认"的类**（如 button 的 `bg-transparent`，preflight 已经保证），给调用方留出覆盖空间。
3. **确实要叠**：先用 `npx tailwindcss -i src/index.css -o /tmp/x.css` 生成 CSS，`grep -n` 两个类看谁在后面；或者直接上 `!` 强制。

排查命令：

```bash
npx tailwindcss -i src/index.css -o /tmp/x.css && grep -n "^\.bg-panel {\|^\.bg-surface-dark {" /tmp/x.css
```

同理，**透明度修饰符只能用 Tailwind 刻度值**（步进 5：`/25` `/35` `/45` 都行，`/42` `/72` 不生成任何 CSS）。

## primitive 自带的 padding，调用点覆盖不掉（4 处已实测失效）

上一节讲的是"同属性叠类"的一般情况，间距工具类是它最容易中招的子类，因为
**Tailwind 的 `px-*` / `py-*` 是按数值升序输出的**——数值大的排在后面，所以：

> 只有**比基类更大**的值能覆盖成功；更小的值会被基类静默压过。

`UiOptionButton` 基类写死了 `px-2.5 py-2`。实测这四处调用点的覆盖**完全没生效**，
渲染出来的仍是基类值，作者以为改了密度、实际没有：

| 调用点 | 写的 | 实际 |
|---|---|---|
| `cameraStage/panels/ObjectListPanel.tsx` | `py-1.5` | `py-2` |
| `cameraStage/panels/CharacterPoseSection.tsx` | `py-1` | `py-2` |
| `canvas/nodes/storyboardSplit/IncomingImagePicker.tsx` | `px-2` | `px-2.5` |
| `canvas/params/ModelPickerList.tsx` | `py-1.5` | `py-2` |

（同批里 `NodeSelectionMenu` 的 `px-3`、`PresetPanel` 的 `px-3` 是生效的——因为比 2.5 大。）

**所以不要用 className 调 primitive 的内边距。** 需要不同密度时：

1. 首选：把密度做成 primitive 上的**有限枚举**（像 `UiButton` 的 `size`），由 primitive 内部
   写成互斥分支，根本不产生叠类；
2. 其次：调整外层容器的间距/负边距，不碰 primitive 自身的 padding；
3. 实在要覆盖：加 `!`（`!py-1.5`），但这会让下一个人以为 className 覆盖普遍可行，
   属于最后手段。

验证某个覆盖到底生不生效，看构建产物里两个类谁靠后：

```bash
grep -bo '\.py-1\.5{\|\.py-2{' out/renderer/assets/index-*.css
```
