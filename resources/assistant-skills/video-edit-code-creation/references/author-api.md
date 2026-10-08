# 作者语言 v3：核心与图形

同时声明 `apiVersion: 1`（素材契约）与 `languageVersion: 3`（作者语言）；省略后者不会启用 v3。文字与动效读 author-text-motion，着色器与滤镜读 author-shaders，参数实例读 parameters-curves。

## 完整最小源码

本技能所有 ts 围栏必须是可独立编译的完整作者源码，测试直接读取；调用片段用 text，工具输入用 json。

```ts
export default {
  apiVersion: 1, languageVersion: 3,
  name: "图形核心", kind: "generator", mode: "dynamic",
  width: 1920, height: 1080, durationSeconds: 5, seed: 42,
  parameters: {},
  render(ctx) {
    const p = smoothstep(0, 1, clamp(ctx.time, 0, 1));
    return [group({id: "card", x: 120, y: 120, opacity: p}, [
      rect({id: "plate", x: 0, y: 0, width: 680, height: 180,
        radius: 16, fill: ctx.style.palette.surface}),
      line({id: "rule", x1: 32, y1: 144, x2: 648, y2: 144,
        width: 2, color: [.45, .7, .65, 1], trimEnd: p})
    ])];
  }
}
```

name 为 1–160 个 UTF-16 单元；kind 为 generator/filter；可选 shaders 定义自己写的 WGSL 着色器（见 author-shaders）；mode 为 static/dynamic。width/height 为 1–8192 整数像素，durationSeconds 为 0.000001–86400 秒（24 小时源时钟技术范围），seed 为无符号 32 位整数。parameters 必填，可为空。static 禁止读 time/localTime/sequenceTime/frame/fps；静态 shader 必须显式给固定 time。滤镜按输入画面处理，作者尺寸不是重采样指令。

## 受限语法与 render

允许 export 前顶层 const、render 内 const、纯箭头辅助函数；块体只允许 const 与最后一个 return。辅助函数编译时展开，不运行任意 JS。函数参数不能带 TS 类型、默认值、解构或剩余参数。对象字段必须显式写 `x: x`，不支持简写、展开或方法。

允许字面量、数组、静态字段对象，`+ - * / %`、比较、同类型标量 `=== !==`、`&& || !`、同类型两支的三元表达式。可读数组下标、允许的对象字段、颜色 `.r/.g/.b/.a`；CPU 生成器支持经过检查的动态索引，滤镜索引须静态确定。不支持 if/for/while、let/var、赋值、递归、class/new、import、模板字符串、任意方法及浏览器/Node/网络/文件访问。

ctx：time 源秒、localTime 片段内秒、sequenceTime 序列秒、frame、fps、width/height；参数为 `ctx.params.key`。u/v 仅滤镜可用，表示当前输入归一化像素坐标。关键帧按 time，不把三种时间混用；frame 由宿主提供，不假定总等于源秒乘帧率。

v3 还可读固定风格路径 ctx.style：palette 的 bg/surface/fg/muted/accent/accent2/positive/negative；fonts 的 display/body/mono 各有 family/weight；typeScale 的 baseSize、xs/sm/md/lg/xl/xxl/display 为短边比例（字号乘 min(ctx.width,ctx.height)），ratio 为阶梯倍率；shape 的 radius/strokeWidth/spacing1/spacing2/spacing3 也是比例；motion 有 enterDuration/exitDuration/stagger（秒）、enterEase/exitEase/moveEase、allowOvershoot；texture 有 grain/vignette/glowIntensity；layout 有 safeMargin（比例）与 grid（网格数）。未绑定风格包时宿主给默认值，只能静态点路径读取，不能动态索引或写入 ctx.style。

生成器 return 图形数组或 repeat 结果，嵌套数组展开。`repeat(count, i => expression)` 从零计数，可返回图形/数组/值；count 是非负整数常量或有非负 min、整数 max 的 number 参数，运行值也必须为整数。时间/随机数不能决定展开上界。辅助函数展开最多 16 层，repeat 嵌套最多 4 层。

## 图形与公共字段

坐标为作者画布像素，组内为局部坐标，按输出顺序从底到顶绘制。

| 调用 | 几何与专属字段 |
| --- | --- |
| rect({...}) | x/y/width/height；fill；radius 或 radii（1–4 项，CSS 顺序） |
| ellipse({...}) | x/y/width/height 为外接矩形；fill |
| line({...}) | x1/y1/x2/y2；width、color；stroke/strokeWidth、lineCap/lineJoin、dash、trimStart/trimEnd |
| path({...}) | d 或 points 二选一；closed、fill；描边与 trim 同 line |
| group({...},children) | x/y 默认 0；children 数组/repeat；clip 为局部矩形 {x,y,width,height} |
| image({...}) | source 为 image 参数；x/y/width/height；空参数不画 |
| text({...}) | x/y/text/fontSize；排版见 author-text-motion |
| shader({...}) | name+params 或 layers 图层树，time/x/y/width/height；见 author-shaders |

公共字段：静态字符串 id；opacity 0–1；rotation 为度；scale 或 scaleX/scaleY（后者优先）；anchorX/anchorY 为局部像素锚点，默认 0。scale 可负以镜像；perChar.scale 必须非负。blend 为 normal/multiply/screen/overlay/add/lighten/darken。

除 shader 自身外，可用 shadow:{x,y,blur,color}、glow:{radius,intensity,color}、blur。阴影偏移 ±1024，模糊/辉光半径 0–256，辉光强度 0–16。组 opacity 在整组完成后应用一次；clip 在局部图层完成效果后裁切，再做组变换。shader 可放组内接受组效果。

rect/ellipse/path/text 的 fill/stroke 接受 RGBA 或渐变，strokeWidth 控制描边。lineCap 为 butt/round/square，lineJoin 为 miter/round/bevel；dash 至多 32 项非负长度，非空时不能全零。line/path 的 trimStart/trimEnd 为 0–1，end 不小于 start，沿长度裁描边，不改变填充。SVG d 仅绝对 M L C Q Z；points 为 [[x,y],...]，closed 控制闭合。

```text
linearGradient({x1,y1,x2,y2,stops:[[0,rgbaValue],[1,rgbaValue]]})
radialGradient({cx,cy,r,stops:[[0,rgbaValue],[1,rgbaValue]]})
```

渐变坐标为图形/组局部画布坐标；stops 为 2–8 项静态数组，位置 0–1、非递减。线性两端不能重合，径向半径 >0。颜色用 [r,g,b,a] 或 rgba，各通道 0–1；过冲后用 clamp 收口。

## 元素定位

每个图形可给稳定静态 id；省略时按调用源码偏移生成，repeat 自动加重复索引。输出带 elementId、祖先 elementPath 与 sourceSpan：start/end 为零基 UTF-16 偏移、左闭右开；startLine/startColumn/endLine/endColumn 为一基行列。id 是定位信息，当前没有元素覆盖字段；修改须找到源码调用、新增版本并重绑实例。

源码重排改变自动 id/偏移，先核对标注对应的固定 version，不用旧 sourceSpan 切新源码。命中按当前帧变换、裁切和可见性，包围盒是画布 AABB；文字用正式宿主量字。通过标注 target 或选中元素上下文取得定位，见 annotations。

## 技术预算与错误

| 单份源码/单帧技术保护 | 数值 |
| --- | --- |
| 源码 UTF-8 / AST / 深度 | 64 KiB / 16384 / 64 |
| 绘制单元（逐字按字形）/ CPU 加权工作 | 4096 / 200000 |
| 参数 / 单字符串 / 每帧文字 | 32 / 4096 / 8192 UTF-16 |
| 滤镜采样 / 标量工作 | 64 / 4096 |
| 单路径展平点 / 渐变 stops | 4096 / 2–8 |
| shader 图层 / shaderFilter 工序 | 32 / 8 |
| 字号 / 字形纹理 / GPU 驻留 | 1–1024px / 宽≤8192且≤四百万像素 / 256 MiB |

repeat、辅助函数、路径、字符动画按展开上界计费。以上是单帧保护，不限制工程素材/片段/序列数量，不承诺所有设备 60fps。

错误：SOURCE_LIMIT 源码超限；SYNTAX 禁止语法/结构；TYPE 字段/类型/索引；BUDGET 展开/资源；PARAMETERS 声明/实例/颜色/着色器参数；NON_FINITE 非有限数值/GPU 安全证明；CONTEXT 时间/尺寸/量字/GPU；COMPATIBILITY 不可变版本契约。可归属错误带 sourceSpan，按位置修正后提交新操作，不原样重试。缺字体报告 MISSING_FONT 并回退 sans-serif；回退能画不等于品牌字体已验收。
