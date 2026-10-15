# 作者语言 v3：表达式

以下函数属于 `languageVersion: 3`，不访问时钟、网络或宿主对象。数值参数和结果必须有限；定义域错误报告函数名与源码行列。三角函数使用弧度。向量为 2–4 维数值数组，四项数组也可通过 `.r/.g/.b/.a` 取分量。

| 签名 | 最短用例 |
|---|---|
| `sqrt(x): number` | `sqrt(4)` → 2 |
| `pow(base, exponent): number` | `pow(2, 3)` → 8 |
| `exp(x): number` | `exp(0)` → 1 |
| `log(x): number`（自然对数，x > 0） | `log(E)` → 1 |
| `log2(x): number`（x > 0） | `log2(8)` → 3 |
| `tan(radians): number` | `tan(0)` → 0 |
| `asin(x): number`（−1 ≤ x ≤ 1） | `asin(0)` → 0 |
| `acos(x): number`（−1 ≤ x ≤ 1） | `acos(1)` → 0 |
| `atan(x): number` | `atan(0)` → 0 |
| `atan2(y, x): number` | `atan2(1, 0)` → PI/2 |
| `hypot(x, y, z?, w?): number` | `hypot(3, 4)` → 5 |
| `sign(x): number` | `sign(-2)` → −1 |
| `fract(x): number`（x − floor(x)） | `fract(-1.2)` → 约 0.8 |
| `mod(value, divisor): number`（非零结果与除数同号） | `mod(-7, 4)` → 1 |
| `trunc(x): number`（向零取整） | `trunc(-1.9)` → −1 |
| `lerp(a, b, t): number`（不夹取 t） | `lerp(0, 10, .5)` → 5 |
| `invLerp(a, b, value): number`（a ≠ b） | `invLerp(0, 10, 5)` → 0.5 |
| `remap(value, a, b, c, d): number`（a ≠ b） | `remap(5, 0, 10, 20, 40)` → 30 |
| `step(edge, x): number`（x < edge 时为 0，否则为 1） | `step(.5, .5)` → 1 |
| `degrees(radians): number` | `degrees(PI)` → 180 |
| `radians(degrees): number` | `radians(180)` → PI |
| `length(vector): number` | `length([3, 4])` → 5 |
| `distance(a, b): number`（向量维数相同） | `distance([0, 0], [3, 4])` → 5 |
| `normalize(vector): vector`（零向量返回零向量） | `normalize([3, 4])[0]` → 0.6 |

常量 `PI` = π、`TAU` = 2π、`E` = 自然常数，例如 `sin(PI / 2)`、`cos(TAU)`、`log(E)`；不能重新声明或作为函数参数名。

运算符 `base ** exponent` 为乘方，例如 `2 ** 3` → 8；`value % divisor` 为向零除法的余数，例如 `-7 % 4` → −3，与 `mod(-7, 4)` 不同。

## 字符串与格式化

`a + b` 任一侧为字符串时拼接；数字使用 `formatNumber` 默认格式，布尔值使用 `true` / `false`。示例：`"进度 " + 25 + "%"`。模板插值接受数字、字符串或布尔值，例如 `` `${25}%` ``。不接受对象、数组或宿主方法调用。

`formatNumber(n, { decimals?, pad?, thousands?, sign? }): string`，例如 `formatNumber(1234.5, { decimals: 2, thousands: true, sign: "always" })` → `"+1,234.50"`。

- `decimals`：0–20 的整数，指定小数位；省略时使用数字的默认十进制表示并展开科学计数法。
- `pad`：0–8192 的整数，整数部分最小位数，左补零，不含符号、小数和分隔符；例如 `formatNumber(7, { pad: 3 })` → `"007"`。
- `thousands`：布尔值，默认 false，true 时整数部分每三位插入逗号。
- `sign`：`"auto"`（默认，仅负数）、`"always"`（总带符号）、`"never"`（不带符号）、`"exceptZero"`（格式化后非零才带符号）。
- 格式独立于系统地区设置；小数点为 `.`。

`formatTime(seconds, "mm:ss" | "hh:mm:ss" | "ss.ff"): string`。负数保留负号，秒向下截取；`ff` 为百分之一秒，不是帧号。`mm:ss` 的分钟和 `ss.ff` 的秒可超过两位；`hh:mm:ss` 的分钟为 00–59。

| 用例 | 输出 |
|---|---|
| `formatTime(61.25, "mm:ss")` | `"01:01"` |
| `formatTime(3661, "hh:mm:ss")` | `"01:01:01"` |
| `formatTime(9.259, "ss.ff")` | `"09.25"` |

单个源码字符串字面量仍最多 4096 UTF-16 单元；拼接、模板和格式化产生的字符串最多 8192，每帧绘制文字合计仍最多 8192。文字纹理尺寸和逐字绘制单元另受运行时预算约束。

`chars(text)`、`words(text)`、`measureText({text, ...})` 的编译预算按字面量长度、text 参数的 maxLength 或 choice 选项最大长度计费；未知长度使用字符上限。字符串功能用于 CPU 生成器和滤镜的帧级属性，不用于逐像素表达式。

## 自然范围与路径

opacity、perChar.opacity、HSV/HSL 的饱和度与明度、alpha 和最终颜色通道自动夹取至 0–1。`mix` 数值结果仍可过冲；颜色结果在作为填充、描边等颜色消费时夹取。NaN/Infinity 报错，不转成零。

`path({d: "..."})` 支持 SVG 的 M/L/H/V/C/S/Q/T/A/Z 及其小写相对命令、隐式重复和科学计数法数字，例如 `path({d:"M0 0h10v10a5 5 0 0 1-5 5z"})`。曲线按长度和画幅自适应分为 4–256 段，最终总点数最多 4096，路径字符串最多 8192 单元；同一路径与画幅产生相同点列。

数学也可用于逐像素滤镜，但仍受 GPU 的有限范围证明约束：除数不能可能为零，log 输入须为正，sqrt 输入须非负，asin/acos 输入须在 −1–1。逐像素 tan 须在 −π/2–π/2 内；normalize 长度须可证明为零或大于 1e-12，atan2 的两参数不能可能同时为零。帧级表达式使用 CPU 定义域检查。

## 滤镜的帧级表达式与运行时反馈

不依赖 u/v、sample/sampleOffset 或图层结果的数值、布尔、颜色子表达式，每帧在 CPU 求值后上传 f32 uniform；帧级求值共享绑定缓存与 1000000 工作预算。最多 512 个 vec4 帧级槽。`sin(ctx.time)`、`sampleGradient(ctx.params.ramp,ctx.time)` 等帧级计算无需逐像素范围证明；有限数值与函数定义域仍在运行时检查。逐像素计算仍检查除零、溢出和函数定义域；混合表达式按该帧实际 f32 uniform 重新检查。最终 RGBA 在片元输出夹到 0–1，不再要求输出的静态范围位于 0–1。

```text
return rgba(sin(ctx.time), 0, 0, 1);
return blur(8 + sin(ctx.time) * 4);
return glow(.2, 4 + ctx.time, 1);
return mix(sample(ctx.u,ctx.v), rgba(1,0,0,1), tween(ctx.time,0,1,0,1,"backOut"));
return average(repeat(ctx.params.count, i => sampleOffset(i,0)));
```

滤镜 repeat 的 count 可为 number 参数，须有不超过 64 的整数 max，运行值须为 1–max 的整数；GPU 按上界展开，average 只计入本帧有效项。tween 支持 backOut/elasticOut/bounceOut 和 y 控制点越过 0–1 的贝塞尔曲线；最终通道夹取。`rgba(1/(ctx.u-.5),0,0,1)` 等逐像素不安全表达式仍被拒绝。

试渲染和 observe_video_edit_frame 的取帧结果在代码渲染超过序列实时预算 `1000/fps` 毫秒时提供 performance：frame、cpuMs、gpuMs、budgetMs，以及有源码计时数据时的 heaviest（kind、cpuMs、sourceSpan 文件与行列）。创建素材/版本通过既有 evidence 回报同一测量。gpuMs 是提交准备至队列完成的墙钟耗时，包含栅格与上传，不是硬件 timestamp。计时不改变帧内容、不拒绝素材；播放沿用既有降级预览。
