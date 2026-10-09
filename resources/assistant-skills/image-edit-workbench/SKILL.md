---
name: image-edit-workbench
description: 在痕迹AI修图、调色、抠出或选中主体、移除物体、修补瑕疵、编辑图层与蒙版、导出图片或流转图片产物时使用。视频时间线与成片用 video-edit-workbench；写代码画面用 video-edit-code-creation。
---

# 图片编辑：围绕意图完成可继续修改的作品

## 总原则

- 本技能给起点与判断依据，不规定风格，用户简报和偏好优先；审美数值是可突破的起点，实际写入仍遵守参数契约。
- 先看原图与用途，再决定全局调整、局部选区、修补或图层组织。人说目标，助手先做繁琐操作，人校正边缘、强度和取舍；已有明确授权就继续完成。
- 优先保留可编辑调整层、蒙版与原图。不要为一次局部修图重做整张作品或另建无关工程。

## 铁律：只约束真实契约

1. 从宿主或 `list_documents` 确认来源与目标，用 `describe_application_entities`、`list_application_entities`、`read_application_entity` 取得完整引用和实例可用性。引用来自返回值，不猜 ID，不把目录文档引用冒充图片工作文档引用。
2. 参数、图层与组的读改增删走 `change_application_entities` 的 `set_properties`、`create_items`、`remove_items`；分割、应用选区、移除和修补走算法能力。内置 Pi 缺工具用 `load_application_tools` 按域加载，外部 MCP 从 `describe_application_contract` 发现；技能不增授权。
3. 选区与作品修改进入图片文档同一撤销历史，移除/修补一次提交一次撤销。保留原引用与结果；公开目录没有 V3 图片专用撤销工具，不借用标注撤销工具。撤销入口以当前宿主实际提供的路径为准，不能声称已撤回未执行的操作。
4. 外部 MCP 写入带 operationId，删除还需相关目标与父集合读取返回的 baselineIds。未知结果用 `get_application_operation` 查原操作；修改保留但保存失败用 `retry_application_operation_save`，originalOperationId 指向原调用，不重放修补或另换标识重试。
5. 本地算法不等于云端付费生成；首次可能下载模型，占用网络与磁盘。遵守当前下载、取消与权限边界，不擅自删除模型。需要云端生成时走正式费用审批，不代替用户批准，不以重新付费掩盖保存失败。
6. 改完回读结构并取回结果图核对。`read_application_media` 只读已落盘的 asset、生成结果或画布节点，不能直接传图片工作文档/选区。按[图层与交付](references/layers-export.md)取得真实结果引用；内置 Pi 可用 `observe_application_surface` 看当前应用并实际读取图像，外部 MCP 不开放该截图。没看到像素就写明未做视觉验证。

## 按需读取

用 `load_assistant_skill`，name 为 image-edit-workbench；省略 path 读入口，每步只读相关参考。

| 当前任务 | 参考 |
| --- | --- |
| 曝光、白平衡、曲线、色轮、HSL、LUT、局部调色 | [调整](references/adjust.md) |
| 框选、套索、画笔、组合、羽化、主体/人像和候选消歧 | [选区](references/select.md) |
| 移除杂物、指定干净来源修补、质量选择与模型下载 | [修复](references/repair.md) |
| 图层/组/蒙版/混合、结果读取、导出与跨工作区 | [图层与交付](references/layers-export.md) |

## 工作流程

1. 读简报与现状：用途、保留内容、允许改动、输出与风格已有信息直接复用；读原图、图层关系与色彩模式。画布节点从自身编辑器进入，独立来源用正式图片编辑入口。
2. 做可编辑结果：全局用调整层，局部先选区再蒙版；抠出主体用蒙版或复制，移除物体用修复。参数与引用依赖刚创建的返回值时才分调用。
3. 检查与返修：整体看明暗和构图，局部看发丝、污染边缘、重复纹理、接缝与透明区域；错误选区先修边，纹理不对换质量或来源。用户已授权直接做完时不追加确认闸门。
4. 交付：回读保存事实和真实结果，按用户用途保留文档或输出图片；能直接流转就使用正式桥梁。说明结果、可继续修改内容与未验证边界。
