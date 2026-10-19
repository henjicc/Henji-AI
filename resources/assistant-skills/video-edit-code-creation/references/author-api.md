# 作者语言 v3：核心与图形

声明素材契约 `apiVersion: 3` 与作者语言 `languageVersion: 3`；API2支持运动曝光，API3增加分层镜头散焦，省略语言版本不会启用 v3。文字与动效读 author-text-motion，着色器与滤镜读 author-shaders，参数实例读 parameters-curves。

## 完整最小源码

ts 围栏须为完整作者源码，测试直接编译；调用片段用 text，工具输入用 json。

```ts
export default {
  apiVersion: 3, languageVersion: 3,
  name: "图形核心", kind: "generator", mode: "dynamic",
  width: 1920, height: 1080, durationSeconds: 5, seed: 42,
  parameters: {},
  render(ctx) {
    const p = smoothstep(0, 1, clamp(ctx.time, 0, 1));
    return [group({id: "card", x: 120 + p * 80, y: 120, opacity: p, motionBlur: {shutter: 180}}, [
      rect({id: "plate", x: 0, y: 0, width: 680, height: 180,
        radius: 16, fill: [0.13, 0.15, 0.19, 1]}),
      line({id: "rule", x1: 32, y1: 144, x2: 648, y2: 144,
        width: 2, color: [.45, .7, .65, 1], trimEnd: p})
    ])];
  }
}
```

name 为 1–160 个 UTF-16 单元；kind 为 generator/filter；可选 shaders 定义自己写的 WGSL 着色器（见 author-shaders）；mode 为 static/dynamic。width/height 为 1–8192 整数像素，durationSeconds 为 0.000001–86400 秒（24 小时源时钟技术范围），seed 为无符号 32 位整数。parameters 必填，可为空。static 禁止读 time/localTime/sequenceTime/frame/fps；静态 shader 必须显式给固定 time。滤镜按输入画面处理，作者尺寸不是重采样指令。

## 受限语法与 render

允许 export 前顶层 const、render 内 const、纯箭头辅助函数；块体只允许 const 与最后一个 return。辅助函数编译时展开，不运行任意 JS。函数参数不能带 TS 类型、默认值、解构或剩余参数。对象字段必须显式写 `x: x`，不支持简写、展开或方法。

允许字面量、数组、静态字段对象，`+ - * / %`、比较、同类型标量 `=== !==`、`&& || !`、同类型两支的三元表达式（“不画”的一支写 `group({}, [])`，不写 `[]`）；`ctx.params` 不能赋给别名。可读数组下标、允许的对象字段、颜色 `.r/.g/.b/.a`；CPU 生成器支持经过检查的动态索引，滤镜索引须静态确定。不支持 if/for/while、let/var、赋值、递归、class/new、默认导入或动态 import（具名相对导入与 @组件 导入见 [多文件与项目组件库](multifile-components.md)）、任意方法及浏览器/Node/网络/文件访问。

ctx：time 源秒、localTime 片段内秒、sequenceTime 序列秒、frame、fps、width/height；参数为 `ctx.params.key`。u/v 仅滤镜可用，表示当前输入归一化像素坐标。关键帧按 time，不把三种时间混用；frame 由宿主提供，不假定总等于源秒乘帧率。

API2 的组可写 `motionBlur:{shutter:180}`；内容只画一次，位姿在快门内求值。开关、相位、边界与嵌套语义见 [文字与动效](author-text-motion.md)。


生成器 return 图形数组或 repeat 结果，嵌套数组展开。`repeat(count, i => expression)` 从零计数，可返回图形/数组/值；count 是非负整数常量或有非负 min、整数 max 的 number 参数，运行值也必须为整数。时间/随机数不能决定展开上界。辅助函数展开最多 16 层，repeat 嵌套最多 4 层。

## 图形与公共字段

坐标为作者画布像素，组内为局部坐标，按输出顺序从底到顶绘制。

| 调用 | 几何与专属字段 |
| --- | --- |
| rect({...}) | x/y/width/height；fill；radius 或 radii（1–4 项，CSS 顺序） |
| ellipse({...}) | x/y/width/height 为外接矩形；fill |
| line({...}) | x1/y1/x2/y2；width、color；stroke/strokeWidth、lineCap/lineJoin、dash、trimStart/trimEnd |
| path({...}) | d 或 points 二选一；closed、fill；描边与 trim 同 line |
| group({...},children) | x/y 默认 0；children 数组/repeat；clip 为局部矩形 {x,y,width,height}；mask:{shape,mode?,invert?} |
| image({...}) | source 为 image 参数；x/y/width/height；空参数不画 |
| text({...}) | x/y/text/fontSize；排版见 author-text-motion |
| shader({...}) | name+params 或 layers 图层树，time/x/y/width/height；见 author-shaders |

公共字段：静态字符串 id；opacity 0–1；rotation 为度；scale 或 scaleX/scaleY（后者优先）；anchorX/anchorY 为局部像素锚点，默认 0。scale 可负以镜像；perChar.scale 必须非负。skewX/skewY 为度，默认 0，范围 −89.9–89.9；矩阵依次缩放、倾斜、旋转，再按锚点与位置平移。blend 为 normal/multiply/screen/overlay/add/lighten/darken/difference/exclusion/soft-light/hard-light/color-dodge/color-burn/hue/saturation/color/luminosity。

除 shader 自身外，可用 shadow:{x,y,blur,color}、glow:{radius,intensity,color}、blur。阴影偏移 ±1024，模糊/辉光半径 0–256，辉光强度 0–16。组 opacity 在整组完成后应用一次；mask 在组效果后、clip 前应用；clip 在局部图层完成效果后裁切，再做组变换。shader 可放组内接受组效果。

rect/ellipse/path/text 的 fill/stroke 接受 RGBA 或渐变，strokeWidth 控制描边。lineCap 为 butt/round/square，lineJoin 为 miter/round/bevel；dash 至多 32 项非负长度，非空时不能全零。line/path 的 trimStart/trimEnd 为 0–1，end 不小于 start，沿长度裁描边，不改变填充。SVG d 支持完整路径语法（含相对命令、H V S T A，见 author-api-expressions）；points 为 [[x,y],...]，closed 控制闭合。

```text
linearGradient({x1,y1,x2,y2,stops:[[0,rgbaValue],[1,rgbaValue]]})
radialGradient({cx,cy,r,stops:[[0,rgbaValue],[1,rgbaValue]]})
conicGradient({cx,cy,angle:0,stops:[[0,rgbaValue],[1,rgbaValue]]})
```

渐变坐标为图形/组局部画布坐标；stops 为 2–32 项静态数组，位置 0–1、非递减。线性两端不能重合，径向半径 >0。颜色用 [r,g,b,a] 或 rgba，各通道 0–1；过冲后用 clamp 收口。

`conicGradient` 的 angle 默认 0 度，零度从中心向右，顺时针增加，绕中心一圈覆盖 stops 的 0–1。

`group({mask:{shape,mode:"alpha",invert:false}}, children)`：shape 是一个图形调用，支持 rect/ellipse/line/path/text/image/shader，也可嵌套 group；使用组内局部坐标和同一帧上下文。mode 为 alpha（默认）或 luma，后者为预乘 RGB 的 `.2126*r + .7152*g + .0722*b`。invert 默认 false，true 时覆盖率为 `1-coverage`，包括图形之外的区域。空图片产生零覆盖；反转后全覆盖。矩形 clip 独立保留。

```text
group({mask:{shape:ellipse({x:ctx.time*20,y:0,width:200,height:200,fill:[1,1,1,1]}),mode:"alpha"}}, [rect({x:0,y:0,width:400,height:200,fill:[1,0,0,1]})])
rect({x:0,y:0,width:100,height:100,skewX:15,skewY:5,blend:"difference",fill:[.8,.2,.3,1]})
```

## 元素定位

每个图形可给稳定静态id；省略按源码偏移生成，repeat加索引。输出带elementId、elementPath与sourceSpan：start/end为零基UTF-16偏移、左闭右开；行列一基。实例可沿video_edit.clip.element_overrides修位置／文字等，先读并保留其他覆盖；文字参数优先改参数。结构改动仍新增版本并重绑。

源码重排改变自动 id/偏移，先核对标注对应的固定 version，不用旧 sourceSpan 切新源码。命中按当前帧变换、裁切和可见性，包围盒是画布 AABB；文字用正式宿主量字。通过标注 target 或选中元素上下文取得定位，见 annotations。

## 技术预算与错误

| 单份源码/单帧技术保护 | 数值 |
| --- | --- |
| 源码 UTF-8 / AST / 深度 | 64 KiB / 16384 / 64 |
| 绘制单元（逐字按字形）/ CPU 加权工作 | 4096 / 1000000 |
| 参数 / 单字符串 / 每帧文字 | languageVersion 3 不限个数（v1/v2 为 32）/ 4096 / 8192 UTF-16 |
| 滤镜采样 / 标量工作 | 64 / 4096 |
| 单路径展平点 / 渐变 stops | 4096 / 2–32 |
| shader 图层 / shaderFilter 工序 | 32 / 8 |
| 字号 / 字形纹理 / GPU 驻留 | 1–1024px / 宽≤8192且≤四百万像素 / 256 MiB |

repeat、辅助函数、路径、字符动画按展开上界计费。代码目标驻留数量按 256 MiB 纹理预算和分辨率计算，预留一半给图层与效果；超过驻留容量时按最近使用顺序回读位图并淘汰纹理，同帧合成保留结果，后续按需重建，没有固定 16 个目标限制。以上是单帧保护，不限制工程素材/片段/序列数量，不承诺所有设备 60fps。

渲染时先检查组透明度、裁切与恒空蒙版；能证明不可见的子树不展开，其省下的 CPU 求值不计费。静态编译检查、数值确定性和可见部分预算保持不变，表达式缓存仍按原有逻辑工作量计费。命中测试及元素覆盖使用完整树定位，存在元素覆盖时保守求值后再做绘制剔除，避免原本透明或画外元素无法移回。绘制命令完全相同才复用整帧纹理；静态组复用图层，任意微小变化、字体变化与可变媒体输入都会阻止相应复用，不要为提高命中率删掉作品需要的动画。

试渲染和取帧结果的 performance / evidence 会返回 CPU 求值、GPU 准备到队列完成的墙钟耗时、前五项结构的源码行列和成本占比，以及剔除与复用次数；预算内也返回，超预算不拒绝有效画面。结构计时包含子结构，可能重叠；占比按各类已测结构总和归一化，不能把结构时间相加当成整帧耗时，也不能当成硬件 GPU timestamp。先依据反馈优化最贵结构，再核对实际画面。

错误：SOURCE_LIMIT 源码超限；SYNTAX 禁止语法/结构；TYPE 字段/类型/索引；BUDGET 展开/资源；PARAMETERS 声明/实例/颜色/着色器参数；NON_FINITE 非有限数值/GPU 安全证明；CONTEXT 时间/尺寸/量字/GPU；COMPATIBILITY 不可变版本契约。可归属错误带 sourceSpan，按位置修正后提交新操作，不原样重试。缺字体报告 MISSING_FONT 并回退 sans-serif；回退能画不等于品牌字体已验收。
