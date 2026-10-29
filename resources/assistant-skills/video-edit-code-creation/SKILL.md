---
name: video-edit-code-creation
description: 在剪辑里设计、编写或修改代码素材：动态图形、标题、花字、粒子、着色器、滤镜与转场，含风格预设、模板与取帧审查。普通剪辑、媒体生成和进度查询不触发。
---

# 剪辑代码创作：先导演，再写代码

用标准 ES 模块和正式工具描述画面。源码加载成功不等于画面验收。

## 审美听谁的

1. 本次需求、品牌规范与序列绑定的风格预设（说明书）。
2. 用户的长期偏好（共享记忆）。
3. 你自己的判断。

本技能里的数值、档位、配方和症状表都只是前两项缺席时的起点和诊断工具，可整套推翻；与说明书或需求冲突时照它们做，不必解释。没有说明书时，你自己定一个有想法的方向直接做，交付时说清选了什么、为什么。

不可越过的只有这些：同一帧结果确定、作者模块契约、真实素材与原文不伪造不删减、关键信息读得清读得完、闪烁安全、付费与权限边界。其余是创作空间：极简或满屏、静止或一直在动、统一或每次不同、霓虹、粒子、回弹、对称，都可以，只要服务这部作品。

## 能用的手段

- 代码图形与文字：Canvas2D 形状、路径、渐变、阴影辉光模糊、逐字逐词动效、遮罩揭示、数字滚动；需要点选和运动模糊的元素写成图层。
- 粒子与场：种子哈希＋时间函数直接求位置，可寻帧（见 recipes-particles）；大规模用 WebGPU。
- GPU：`createWebGPU` 与合成共用设备，可写多遍 WGSL、读下方画面与相邻帧做滤镜；160 多个 shaders 组件作为内置效果与转场使用。
- 空间：多层图层视差和投影倍率做伪3D；WebGPU 可做光线步进、SDF 或真实网格。
- 素材与效果：就地生成图片或视频落到当前位置，调色、内置效果、转场与代码素材叠用。

## 做法

- 先说“用什么画面讲哪一句”。装饰可以多，但要有主次：观众每一刻都知道看哪里。
- 动作解释看哪里、阅读顺序与交接；快慢、动静、大小的对比由风格决定。注意力事件少而准、各有理由，静止也可以是对的。
- 画面文字和口播分工：口播说过的不在画面上逐字再贴一遍。小字只放观众需要、而画面和口播里都没有的信息（编号、单位、来源、时间、数值），不加复述标题的副标题、说明句和装饰性英文。信息密度按用途定：口播讲解、产品介绍像发布会，一屏一个重点；课件、教程这类要留在画面上供人对照的才多放字。字少了不靠堆字填空，靠结构与细节（定位、刻度、分层、质感、细微运动）撑住画面，见 attention 的“画面文字与信息密度”。
- 主动把用户大概率想调的文案、时长/延迟/节奏、颜色、位置、大小和强度声明成参数；数量克制，按元素分组，不把所有数值都开放。画面从参数推导，改动优先改参数。
- 新作者 JS 默认给每段可见文字声明 `text` 内容与 `textStyle` 文字样式参数，两者用 `layer` 绑定同一图层；字体、字号、字重、字距、行距、填充和描边的默认值跟随风格预设。未声明的文字才改源码。
- 动态生成图层用数据键或索引组成稳定 id（如 `node-3`）；驱动数组用 `table` 参数声明 `fields` 与 `default`，建议用 `rowKey` 指定稳定键。图层用 `data:{parameter,keyField,key}`（或 `data:{parameter,index}`）绑定对应项，`factory:{file,name}` 指向工厂函数；选中后改内容直接改数据，改外观改工厂。
- 拖动、缩放和旋转的覆盖立即生效并长期保存，已声明参数也无需写回源码；用户要整理源码时才后台或批量建新版本、验证后合并覆盖，前后同一撤销栈。
- 同类元素的规则由说明书定；局部变化要有语义。
- 一支片子一个代码工程：`代码/` 按 style、film、entries 三层建源码树，素材只是入口；不靠预渲染也要实时播放。
- 大作品（多镜头或 15 秒以上）先做主停留帧，取帧读图给用户确认方向；短小内容直接做完。用户说过“不用停”“直接做完”就自主选定并说明。改字、换色不重做提案。
- 绑定了风格：开工前读说明书、看锚点帧，做完逐条对照不变量与硬约束自查。自己选的风格不算用户口味。做标题、人名条这类反复出现的元素先查模板。
- 改已有作品：先用 `read_application_entity` 读素材、参数、曲线、覆盖与位置，并看原画面。保留满意的内容；源码改动新增版本再重绑；核对共享实例和邻接缝。
- 每组修改后用 `observe_video_edit_frame` 取受影响画面，用 `read_application_media` 真读图。交付写明结果位置、可改内容，分清读回了什么、看过哪些帧、哪些未验证。导出和收录听用户安排，不自动增加付费或权限。
- 交付附“绕路记录”：手写了宿主或内置库该有的通用能力（换行、量字、布局、缓动、遮罩、取色）或反复试错才找到用法时，写明写了什么、为何没找到现成的；这是软件该补的，不算你的失误。

## 按任务分流

`load_assistant_skill` 的 name 为 `video-edit-code-creation`。省略 path 读入口，按下表路径读参考，每步一两份，已读的直接复用。

| 任务 | 参考 |
| --- | --- |
| 简报、概念、拆参考 | [简报与概念](references/brief-concept.md) |
| 风格预设（读、选、建、改、分享）、风格／构图／字体／颜色 | [风格预设](references/style-kit.md)、[标准样片](references/style-sample.md)、[风格](references/styles.md)、[版式](references/layout.md)、[文字](references/type.md)、[色彩质感](references/color-texture.md) |
| 质感选型、实现边界、试一帧 | [定做法](references/approach.md) |
| 时长曲线、错峰、因果、转场 | [运动](references/motion.md) |
| 动多少、何时静止、太忙或僵住、删减与密度 | [注意力与克制](references/attention.md) |
| 镜头感、分层视差、换场不空、像 PPT | [镜头感](references/camera.md) |
| 全片节奏、讲解、声画 | [结构](references/structure.md) |
| 取帧、批注、A/B、评分、交付 | [审查](references/review.md)、[常见症状](references/review-ai.md) |
| 模板（登记、复用、联动、全局）、换字自适应、压力测试 | [模板](references/templates.md) |
| 开工读口味、明确评价后保存 | [偏好](references/preferences.md) |
| 逐字／逐词、遮罩、排版 | [文字配方](references/recipes-text.md)、[逐词分拍](references/recipes-text-words.md) |
| 打字机、光标、数字滚动 | [终端与数字](references/recipes-text-data.md) |
| 字幕实体、花字、关键词、人名条 | [字幕配方](references/recipes-captions.md) |
| 玻璃、图标、线条、圆角卡片 | [玻璃与线条](references/recipes-glass-lines.md) |
| 粒子、光尘、爆散、星轨 | [粒子与场](references/recipes-particles.md) |
| 三维镜头参考、代码视差 | [空间配方](references/recipes-3d.md) |
| 模块契约、绘制、图层 | [作者接口](references/author-api.md) |
| 预览卡顿、成本反馈 | [性能](references/performance.md) |
| 音乐节拍、视频与网页画面 | [音频与画面输入](references/author-api-media.md) |
| 文字参数与样式、量字、逐字、缓动 | [文字动效接口](references/author-text-motion.md) |
| WebGPU、WebGL、滤镜、相邻帧 | [GPU 接口](references/author-shaders.md) |
| 查内置 shaders 组件名称与角色 | [纹理](references/shader-components-textures.md)／[续](references/shader-components-textures-2.md)、[图形材质](references/shader-components-shapes.md)／[续](references/shader-components-shapes-2.md)、[模糊扭曲调色](references/shader-components-filters.md)、[风格化转场](references/shader-components-stylize.md) |
| 用户标注发现、定位、回复 | [标注协议](references/annotations.md) |
| 代码工程结构、参数化、拆文件 | [代码工程](references/code-project.md)、[参数化](references/parametric.md)、[多文件组件](references/multifile-components.md) |
| 参数类型、分组、条件、自定义类型 | [参数类型](references/parameter-types.md) |
| 实例值、曲线、图片参数、版本绑定 | [参数曲线](references/parameters-curves.md) |
| 定位、插入、时间换算、撤销恢复 | [时间线契约](references/timeline-check.md) |
| 完整提交与调参对照 | [接口样例](references/examples.md) |

## 导演流程

已有决定就从相应阶段继续；小改直接读现状、修改、审查。

| 阶段 | 产出 | 按需读参考 |
| --- | --- | --- |
| 想清楚 | 简报、目标序列、规格与交付 | style-kit、preferences、brief-concept、timeline-check |
| 找概念 | 想法与母题；方向不明时给几个差异明显的方向 | brief-concept、styles |
| 定做法 | 选实现、查组件与效果、试一帧 | approach、author-shaders、recipes-3d |
| 定样子 | 主停留帧与版式、字体、配色 | layout、type、color-texture、author-api |
| 搭骨架 | 能量与节拍表，粗排完整时间线 | structure、timeline-check |
| 动起来 | 因果主次、曲线错峰、事件预算、文字与质感 | motion、attention、camera、parameters-curves、recipes-* |
| 看片改 | 看片、删减轮、A/B、可执行批注、局部返修 | review、review-ai、attention、annotations |
| 交付沉淀 | 回读自检、可编辑模板、明确的长期口味 | review、templates、code-project、preferences |

## 执行边界

目标来自宿主上下文或正式目录，不猜 ID。创建与改参数用通用实体工具，其余按 names 只加载本步骤要用的工具。写入走 `change_application_entities`，同一目的合并成一个事务，依赖新引用时才分开调用。

概念、节拍、批注留在当前对话或正式标注，不自动建文档、临时工程或偏好文件。
