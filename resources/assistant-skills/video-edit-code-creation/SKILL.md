---
name: video-edit-code-creation
description: 在剪辑里设计、编写或修改原生代码素材（动态图形、标题、花字、模板、滤镜），统一风格、编排动画、放入时间线并取帧审查时使用。普通剪辑、媒体生成和进度查询不触发。
---

# 剪辑代码创作：先导演，再写代码

用受限 TypeScript 风格作者语言描述画面，只用当前作者接口与正式工具。按意图创作；设计建议不新增 API，样例只核对写法。

## 总原则

- **先有想法再有画面**：先说“用什么画面讲哪一句”，每个装饰都要服务它。
- **少即是多**：每个时刻一个主焦点；元素宁少而大，信息多就分拍。
- **运动服务信息**：动作交代看哪里、先看什么、何时读完；无理由的动作删除。
- **统一胜过花样**：配色、字体、间距、曲线性格与时长刻度共用一套；局部变化要有语义。
- **节奏要有对比**：快慢、动静、大小交替；阅读停留也属于设计。

## 铁律

1. 新作品先做关键画面，取帧读图后请用户确认，再扩展全片。用户已说“不用停／直接做完”就自己选并说明理由；改字、换色等小改不重新确认方向。
2. 开工先读相关用户偏好。当前要求与品牌约束优先；自己选的风格不等于用户长期口味。
3. 改已有作品先用 `read_application_entity` 读当前素材、实例参数、曲线和位置，并看原画面。在原素材上改；源码变动沿新版本绑定，不删除重建满意内容。检查共享实例及相邻接缝。
4. 每次完成一组修改，都用 `observe_video_edit_frame` 取受影响画面，再用 `read_application_media` 真正读图；拿到引用或编译成功都不能证明画面正确。
5. 交付前自检，分开报告回读、看过的帧与未验证项。导出或收录按用户要求，不因加载技能增加付费调用或权限。

## 按任务分流

`load_assistant_skill` 的 name 为 `video-edit-code-creation`；省略 path 读入口，传下表路径读参考。每步读一两份，复用已读内容。

| 当前任务 | 先读 |
| --- | --- |
| 新作品、找视觉想法、拆解参考 | [简报与概念](references/brief-concept.md) |
| 定气质、参数尺度或系列统一 | [风格坐标](references/styles.md) |
| 定构图、画幅、安全框、信息层级 | [版式](references/layout.md) |
| 标题、字幕、花字、人名条、选字体 | [文字](references/type.md) |
| 定配色、渐变、颗粒、投影与辉光 | [色彩与质感](references/color-texture.md) |
| 曲线手感、接力、动势与转场 | [运动](references/motion.md) |
| 全片节奏、知识讲解、声画安排 | [结构](references/structure.md) |
| 取帧、批注、A/B、返修与交付 | [审查](references/review.md) |
| 换字自适应、量字、压力测试 | [模板](references/templates.md) |
| 开工读口味、用户明确评价后记偏好 | [用户偏好](references/preferences.md) |
| 写或修改源码：语法、图形与预算 | [作者接口](references/author-api.md) |
| 文字排版、量字、逐字与动效函数 | [文字与动效接口](references/author-text-motion.md) |
| 着色器背景、滤镜原语与效果目录 | [着色器接口](references/author-shaders.md) |
| 处理用户标注/批注 | [标注处理协议](references/annotations.md) |
| 参数声明、实例值、关键帧、新版本绑定 | [参数与曲线](references/parameters-curves.md) |
| 定位目标、插入、时间换算、撤销与恢复 | [时间线契约](references/timeline-check.md) |
| 需要完整可对照的提交写法 | [接口样例](references/examples.md) |

## 导演流程

已有明确决定就从相应阶段继续；小改直接读现状、修改、审查。

| 阶段 | 做什么与产出 | 按需读的 reference |
| --- | --- | --- |
| 想清楚 | 五问收成简报，确认目标序列、规格与交付范围 | preferences、brief-concept、timeline-check |
| 找概念 | 视觉想法＋母题，出 1–3 个方向，说明参考与实现风险 | brief-concept、styles |
| 定样子 | 做主停留帧，固定版式、字体、颜色；请确认或自主选定 | layout、type、color-texture、author-api |
| 搭骨架 | 能量曲线与节拍表，粗排完整时间线，先验证信息顺序 | structure、timeline-check |
| 动起来 | 先因果和主次，再曲线、时长、错峰与转场 | motion、parameters-curves |
| 看片改 | 三遍看，批注最影响理解的地方，比较后局部修 | review |
| 交付沉淀 | 回读与自检；按需做可编辑模板，只记明确长期口味 | review、templates、preferences |

## 执行边界

目标从宿主上下文或正式目录取得，不猜 ID；缺剪辑工具时用 `load_application_tools` 加载 video_edit。写入走 `change_application_entities`，依赖新引用才分调用，同目的修改合并事务。源码、参数与关键帧查接口参考，放置与恢复查时间线契约。

概念、节拍和批注留当前对话或正式标注，不自动建文档、临时工程或偏好文件。交付指出结果位置与可修改内容。
