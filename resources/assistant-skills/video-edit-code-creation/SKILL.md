---
name: video-edit-code-creation
description: 在剪辑里编写新的原生代码素材（动态图形、标题、滤镜）、放进时间线、批量调参数与关键帧并取帧检查时使用。普通剪辑、生成图片视频、查询进度不触发。
---

# 剪辑代码素材创作

代码素材是受限作者源码：应用只做语法白名单检查和试渲染，不执行脚本。按用户要求写新源码和参数，不要只换现成素材的参数冒充新作品。

用 `load_assistant_skill`，name 为 `video-edit-code-creation`，按当前步骤只读一份 path：

| 当前步骤 | 读取 |
| --- | --- |
| 写或修改源码 | [作者接口](references/author-api.md) |
| 声明参数、改实例参数、打关键帧、换源码版本 | [参数与关键帧](references/parameters-curves.md) |
| 插入时间线、取帧检查、撤销保存与失败恢复 | [时间线与检查](references/timeline-check.md) |
| 需要可对照的完整写法 | [两个小样例](references/examples.md) |

## 主流程

1. 定目标：读宿主上下文的 `videoEdit`（内置助手随消息提供，外部连接调用 `get_current_application_context`）。`documentRef`、`sequenceRef`、`selectedClipRefs`、`targetTrackRefs` 是 `类型:id` 字符串，例如 `video_edit.sequence:剪辑id:序列id`，传给工具时写成 `{kind:"video_edit.sequence", id:"剪辑id:序列id"}`。用户点名的剪辑优先；没有剪辑上下文时用 `list_application_entities` 列出 `video_edit.document`，不猜 ID。
2. 素材与位置分开检查：选素材时用 `observe_video_edit_frame` 的 source 目标看项目项源画面；定位时用 program 目标看序列某帧的合成画面。结果是图片 assetRef，必须再用 `read_application_media` 读取后才能下判断。
3. 写源码：按作者接口写一个 `export default` 对象。画布宽高默认取目标序列的 `video_edit.sequence.width` / `video_edit.sequence.height`；只声明真正要调的参数。
4. 提交：`change_application_entities` 里 `create_items`，`entityType` 为 `video_edit.code_material`，parent 为剪辑，属性 `video_edit.code_material.source`，可加 `video_edit.code_material.name`。应用在这一步编译并试渲染，失败整体不写入，错误带错误类别和行列号。
5. 插入：生成器会同时产生 kind 为 code 的 `video_edit.item`，在序列下创建 `video_edit.clip`；滤镜不产生项目项，在目标片段下创建 `video_edit.effect`。
6. 调参：多个参数、关键帧和多个片段放进同一次 `change_application_entities`，不要逐项往返。
7. 检查：至少取关键时刻的合成帧并读取画面，核对内容、位置和时间；只拿到 assetRef 不算看过。
8. 收尾：工具写入后应用自动保存；用户要求撤销时调用 `undo_video_edit`，保存失败时调用 `save_video_edit` 重试保存，不重做编辑。

## 边界

- 内置助手当前界面没有某个剪辑工具时，用 `load_application_tools` 按领域 video_edit 加载，不要说做不到。
- 源码版本不可原地改写；要换源码就新建版本再绑定（见参数与关键帧）。
- 不导出、不收录、不发起付费生成，除非用户要求。技能不改变权限、审批或工具范围。
- 最终答复分开写：结构化回读结果、实际读过的画面、尚未验证的部分。
