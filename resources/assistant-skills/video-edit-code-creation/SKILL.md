---
name: video-edit-code-creation
description: 在剪辑里设计、编写或修改代码素材（动态图形、标题、花字、模板、滤镜），统一风格、编排动画、放入时间线并取帧审查时使用。普通剪辑、媒体生成和进度查询不触发。
---

# 剪辑代码创作：先导演，再写代码

用受限TS作者语言与正式工具描述画面。建议不新增API；编译成功不等于画面验收。

## 原则与铁律

- 本技能给起点与判断依据，不规定风格：简报和偏好优先，刻度、配色、曲线可为创意突破；无偏好时给差异明显的方向，样例只示范写法。
- 先说“用什么画面讲哪一句”，装饰服务母题；每刻一个焦点，元素宁少而大、信息多就分拍。
- 动作解释看哪里、阅读顺序与交接；快慢、动静、大小有对比，落地后静止。
- 文字、配色、节奏、构图、强度开放参数，画面从参数推导；改动优先改参数。
- 字体、颜色、间距、圆角、曲线性格与时长共用规则，局部变化有语义。
- 新作先做主停留帧、取帧读图、确认方向再扩全片。已授权“不用停／直接做完”自主选并说明；改字换色不重做提案。
- 开工复用相关偏好；当前要求和品牌约束优先，自己选的风格不算用户口味。
- 改已有作品先用 `read_application_entity` 读素材、参数、曲线、覆盖与位置并看原画面；保留满意内容，源码改动新增版本重绑，核对共享实例及邻接缝。
- 每组修改后 `observe_video_edit_frame` 取受影响画面、`read_application_media` 真读图。交付区分回读、已看帧与未验项，导出／收录按用户要求，不自动增加付费或权限。

## 按任务分流

`load_assistant_skill` 的name为 `video-edit-code-creation`；省略path读入口，按下表路径读参考。每步读一两份，复用已读内容。

| 任务 | 参考 |
| --- | --- |
| 简报、概念、拆参考 | [简报与概念](references/brief-concept.md) |
| 风格／构图／字体／颜色 | [风格](references/styles.md)、[版式](references/layout.md)、[文字](references/type.md)、[色彩质感](references/color-texture.md) |
| 质感选型、实现边界、试一帧 | [定做法](references/approach.md) |
| 时长曲线、错峰、因果、转场 | [运动](references/motion.md) |
| 全片节奏、讲解、声画 | [结构](references/structure.md) |
| 取帧、批注、A/B、评分、交付 | [审查](references/review.md)、[AI味改法](references/review-ai.md) |
| 换字自适应、量字、压力测试 | [模板](references/templates.md) |
| 开工读口味、明确评价后保存 | [偏好](references/preferences.md) |
| 逐字／逐词、遮罩、排版 | [文字配方](references/recipes-text.md)、[逐词分拍](references/recipes-text-words.md) |
| 打字机、光标、数字滚动 | [终端与数字](references/recipes-text-data.md) |
| 字幕实体、花字、关键词、人名条 | [字幕配方](references/recipes-captions.md) |
| 玻璃、图标、线条、圆角卡片 | [玻璃与线条](references/recipes-glass-lines.md) |
| 三维镜头参考、代码视差 | [空间配方](references/recipes-3d.md) |
| 语法、图形、预算 | [作者接口](references/author-api.md) |
| text、measureText、perChar、缓动 | [文字动效接口](references/author-text-motion.md) |
| 框架组件、图层树、自写WGSL | [着色器接口](references/author-shaders.md) |
| 查真实组件名称与角色 | [纹理](references/shader-components-textures.md)／[续](references/shader-components-textures-2.md)、[图形材质](references/shader-components-shapes.md)／[续](references/shader-components-shapes-2.md)、[模糊扭曲调色](references/shader-components-filters.md)、[风格化转场](references/shader-components-stylize.md) |
| 用户标注发现、定位、回复 | [标注协议](references/annotations.md) |
| 参数化、拆文件、项目组件库 | [参数化](references/parametric.md)、[多文件组件](references/multifile-components.md) |
| 参数类型、分组、条件、自定义类型 | [参数类型](references/parameter-types.md) |
| 实例值、曲线、图片参数、版本绑定 | [参数曲线](references/parameters-curves.md) |
| 定位、插入、时间换算、撤销恢复 | [时间线契约](references/timeline-check.md) |
| 完整提交与调参对照 | [接口样例](references/examples.md) |

## 导演流程

已有决定就从相应阶段继续；小改直接读现状、修改、审查。

| 阶段 | 产出 | 按需读reference |
| --- | --- | --- |
| 想清楚 | 五问简报、目标序列、规格与交付 | preferences、brief-concept、timeline-check |
| 找概念 | 母题与一到三个方向、参考和风险 | brief-concept、styles |
| 定做法 | 选实现、查组件与效果、试一帧 | approach、author-shaders、recipes-3d |
| 定样子 | 主停留帧与版式字体配色，确认方向 | layout、type、color-texture、author-api |
| 搭骨架 | 能量与节拍表，粗排完整时间线 | structure、timeline-check |
| 动起来 | 因果主次、曲线错峰、文字与质感 | motion、parameters-curves、recipes-text、recipes-text-words、recipes-text-data、recipes-captions、recipes-glass-lines |
| 看片改 | 三遍看片、A/B、可执行批注、局部返修 | review、review-ai、annotations |
| 交付沉淀 | 回读自检、可编辑模板、明确长期口味 | review、templates、multifile-components、preferences |

## 执行边界

目标来自宿主上下文或正式目录，不猜ID；缺工具用 `load_application_tools` 加载video_edit。写入走 `change_application_entities`，同目的合并事务，依赖新引用才分调用。源码、参数查接口，放置与恢复查时间线。

概念、节拍、批注留当前对话或正式标注，不自动建文档、临时工程或偏好文件。交付指出结果位置、可修改内容与证据边界。
