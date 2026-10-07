# 作者语言 v3：可信着色器与滤镜

作者只能选择可信目录效果，不能提交 WGSL、任意渲染遍或 GPU 资源操作。背景用 shader 图层；单输入滤镜用 shaderFilter；两输入转场不在此接口中。

## shader 图层

```text
shader({id:"sky",name:"aurora",
  params:{speed:1,color_b:rgba(.1,.8,.6,1)}, time:ctx.time*.5,
  x:0,y:0,width:ctx.width,height:ctx.height,opacity:1,blend:"normal"})
```

name 必须编译期确定为字符串常量或 const 别名，使用目录 ID 去掉 shader_ 的短名。params 为静态字段对象或 const 别名，省略取目录默认值。字段值可用参数、时间、数学/色彩表达式；字面量在编译时校验，表达式每帧校验。未知名称/键、越界值报 PARAMETERS 并列出可用项。

shader 是图形树元素，可进 group，支持自身及祖先的平移/旋转/缩放/anchor/opacity/blend 和组 clip；自身不接受 shadow/glow/blur，可用组整体效果。命中是变换与裁切后的矩形，保留 elementId/elementPath/sourceSpan。time 省略取 ctx.time；静态生成器必须显式固定 time:0。可慢放/循环，不累积历史帧；time 与最大 speed 乘积须可表示为有限 f32。

颜色接收作者 RGBA/rgba/hsv/mix，但目录背景色契约为 RGB，量化到 8 位，alpha 不参与图案颜色；透明度用图层 opacity 或效果 strength，不要假设 RGBA 渐变 alpha 在此生效。

## shaderFilter 工序

仅 kind:"filter" 中可用，返回当前 uv 的直通 RGBA：

```text
const chroma = shaderFilter("chromatic",{strength:25,direction:0});
return shaderFilter("grain",{strength:12,speed:1},chroma);
```

两参数处理原始输入；可选第三参数只能是另一项 shaderFilter 或 const 别名，按纹理依赖顺序串接。不能把 sample 或任意颜色运算作为第三参数；最终颜色表达式可以与采样、blur/glow、mix/saturate 等组合：

```text
return clamp(mix(shaderFilter("glass",{scale:20}),blur(4),.5),0,1);
```

params 只允许帧级表达式：参数、时间、数学/色彩函数、静态表；禁止 ctx.u/v、repeat 索引和输入采样，包括绕经 const 对象/字段。每道工序使用本帧源时间；static 滤镜取时间 0。滤镜在 GPU 上求值，CPU 的 evaluateCodeMaterial 不处理滤镜；不能用返回空数组冒充滤镜求值成功。

## 滤镜原语与安全证明

| 调用 | 语义与边界 |
| --- | --- |
| sample(u,v) | 输入归一化坐标采样 |
| sampleOffset(dx,dy) | 当前像素的画布像素偏移 |
| average(colors) | 1–64 个颜色平均，可用静态 repeat |
| blur(radius) | 可信 GPU 模糊；半径 0–256 |
| glow(threshold,radius,intensity) | 亮部提取、散射合成；阈值 0–1、半径 0–256、强度 0–16 |

blur/glow 的半径与 glow 阈值须为数字常量、数值参数或其别名。radius 是金字塔视觉范围，不是精确高斯 sigma。可用数学、色彩、缓动与静态表；索引须静态确定，除数不可可能为零/过小，最终 RGBA 须可证明在 0–1。tween/keyframes 不接受过冲缓动，可改为直接缓动函数+mix+clamp，仍须证明数值安全。

每份滤镜最多 64 次采样、4096 标量工作；shaderFilter 输出采样也计入。每帧最多 4 个 shader 图层，每份滤镜最多 4 道 shaderFilter 工序，repeat/嵌套/输出别名均计费，同一 const 工序多次引用只执行一次。同参数/时间/尺寸的背景和同输入/参数的滤镜帧内复用；纹理计入既有 256 MiB 驻留保护，GPU 不可用或预算不足失败关闭。这是单帧技术限制，不限制工程数量，不保证任意叠加链 4K60。

## 常用十项摘要

数字沿目录原单位，不换成 0–1。S=strength 0–100；K=scale 1–100；D=direction −180–180 度；V=speed −4–4；R=seed 0–10000。括号为默认值，颜色使用作者 RGBA，目录默认 RGB 以实时查询为准。

| 短名 | 角色与参数 |
| --- | --- |
| linear_gradient | 背景；S(100)、K(1)、D(0)、color_a/color_b |
| radial_gradient | 背景；S(100)、K(1)、D(0)、color_a/color_b |
| mesh_gradient | 背景；S(100)、color_a/color_b、V(1) |
| aurora | 背景；S(100)、K(30)、D(0)、R(42)、color_a/color_b、V(1) |
| beam | 背景；S(100)、K(30)、D(0)、color_a/color_b、V(1) |
| sparkle | 背景；S(100)、K(30)、D(0)、R(42)、color_a/color_b、V(1) |
| chromatic | 滤镜；S(40)、D(0) |
| grain | 滤镜；S(40)、K(30)、V(1)、R(42) |
| glass | 滤镜；S(40)、K(30)、D(0) |
| glow_pro | 滤镜；S(40)，range(50)、threshold(50)、exposure(58)、rolloff(62)、core_white(55) 均 0–100 |

## 完整目录从实体读取

1. 用 list_application_entities 列举 entityType:"video_edit.builtin_effect"，按 limit/cursor 分页；不猜文档或实体引用。
2. 对返回 ref 用 read_application_entity，propertyIds 为 video_edit.builtin_effect.name/group/description/params。
3. 选择底层 ID 带 shader_ 的着色器背景/滤镜/光效项；实体引用的 id 可能还带 effect: 包装，先读目录及描述，不把完整 ref.id 塞给 shader。作者短名为底层 ID 去掉 shader_。转场目录不用于这两个接口。
4. params 提供 key/type/min/max/default/unit/说明，以本次实际结果为准。未知效果让错误目录指导改道，不尝试猜名。

宿主 listCodeShaders(role?) 从正式效果定义派生目录，用于文档生成/校验，不是作者可调用函数，也不是 MCP 专用工具。摘要帮助选型，运行时目录是唯一参数真相源；新增效果先查询目录，不在 skill 维护第二套 schema。
