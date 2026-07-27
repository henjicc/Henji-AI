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
