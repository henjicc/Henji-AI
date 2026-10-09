# 图层、蒙版与交付流转

> 何时读：组织图层/组、调整混合与蒙版、选择真实编辑宿主、读取结果图、导出或流转其他工作区时读。

## 原宿主与真实引用

已有画布多图层图片节点用 `open_multi_layer_document_node_editor` 的 canvasRef/nodeRef 进入节点自己的编辑器，不能用独立工具箱替代。独立素材/生成结果用 `open_image_editor_with_source` 的 sourceRef。两者都有导航，只在任务需要进入编辑宿主或用户要求查看时执行。进入后从实际目录读图片工作文档、根层及选区引用；不由目录ID拼接它们。

`image_edit.document` 是工作文档引用，`documents.document` 是项目目录文档引用（图片类型为 image_document）；两者不能互换。`list_documents`、宿主与实体返回值分别用于各能力指定的字段，不裁掉前缀、不靠同名猜目标。

## 图层与组

普通读写和集合操作走 `change_application_entities`，同目的修改合并事务；新增引用返回后再处理其依赖。

| 对象 | 正式属性与操作 |
| --- | --- |
| 工作文档 | `image_edit.document.root_refs` 读根图层，width/height/color_mode 读尺寸与色彩；元数据不是任意写入口 |
| 图层 | `image_edit.layer.name`、`image_edit.layer.visible`、`image_edit.layer.locked`、`image_edit.layer.opacity`、`image_edit.layer.blend_mode`；opacity是0–1 |
| 层树 | `image_edit.layer.parent_ref` / `image_edit.layer.index` 改父组与同级顺序，引用与顺序来自实际层树 |
| 组 | `image_edit.group.name`、`image_edit.group.parent_ref`、`image_edit.group.index`、`image_edit.group.visible`、`image_edit.group.opacity`、`image_edit.group.blend_mode`、`image_edit.group.isolated`；`image_edit.group.child_refs`只读 |
| 蒙版 | 从 `image_edit.layer.mask_ref` 或 `image_edit.group.mask_ref` 读蒙版，`image_edit.mask.inverted` 可反相；`image_edit.mask.resource_refs`只读，不手填像素资源 |

组用 create_items，必填组名；普通层按 describe 给齐 name/type/definition_id/params。像素资源与蒙版内容由正式工具/算法维护，不能为创建像素层捏造资源。effect/adjustment 的params按定义schema；基础调色见adjust.md。

公开混合为 normal/multiply/screen/overlay/soft-light，按实际枚举选，不从其他软件抄未注册模式。隔离组与穿透合成的影响需看最终图；透明覆盖可从opacity=0.7试起，用户风格优先，这不是固定配方。尊重锁定及已有精修；不能为了绕过拒绝自动解锁或删蒙版。应用当前选区为层蒙版用 `apply_image_edit_selection` 的 mask，会替换原蒙版。选区会话与作品共用历史，但不要把“可撤销”说成助手已执行撤销。

## 结果图读取与图片导出

1. 先读写入/保存回执、参数与蒙版状态。内置 Pi 可用 `observe_application_surface` 查看当前应用并实际读取图像；这是当前窗口证据，不代表已检查原尺寸导出。外部 MCP 不开放该内部截图工具。
2. 画布来源中受支持的栅格层/组，用 `export_image_edit_target_to_canvas` 给原 canvasRef、sourceNodeRef、targetRef，生成普通 PNG 节点并连接来源；随后 `read_application_media` 用返回 nodeRef 分块到 eof，再让支持图像的模型查看。调整/效果层不能单独导出；浮点/HDR文档也不支持这个算法，不能借它假装全能图片导出。
3. 要下载画布节点图片用 `download_canvas_media`，documentId/nodeIds 必须来自原画布发现结果，destination 只用已配置 quick/preset。核对 savedNodeIds/failedNodeIds；分批大小按本工具schema，不给整个作品节点数量设配额。读取整图时确认节点关联媒体的outputIndex，不把输入原图误当编辑结果。
4. 独立图片编辑器已有扁平图片导出界面；当前公开工具目录未提供可指定该工作文档的通用扁平导出能力。不要发明工具或把 `commit_image_edit` 当V3工作文档导出：它只收创建预览返回的previewRef。需要这个界面导出而当前调用面无法执行时如实说明具体缺口。
5. 交付可编辑文档用 `export_document_package` 的 documentId（目录返回值），结果是 .henjipack 而不是PNG。它连同引用素材/内嵌图层打包，核对 missingFiles。图片格式/透明度/尺寸/色彩空间由实际导出入口约束，不能承诺未发现的格式选项。

未取得实际像素时说明“结构已回读，视觉未验证”，不把文档引用、缩略图或保存成功当原尺寸图片验收。

## 跨工作区直接复用

- 画布原位编辑沿原文档保存与节点预览更新；派生单层/组节点走上述导出桥梁，保持来源关联，不手动搬路径。
- 图片文档进剪辑用 `place_video_edit_creative_result`：result.type=document，result.documentRef 为保存图片的目录文档引用；placement=library 只放素材库，其他落位按剪辑schema。返回后读实际项目项/片段与关联媒体，取得可读媒体引用再检查。需要素材库/时间线写权限；不要只为截图创建无关剪辑。
- 剪辑节目帧用 `edit_video_edit_program_frame` 打开图片编辑，保留原 frameEditSessionRef/returnPlacement；保存图片后由 `place_video_edit_creative_result` 用目录文档来源及原样返回的单帧落位回填。普通时间线操作按需读 video-edit-workbench，写代码画面另读 video-edit-code-creation。
- 若原操作保留修改但保存未确认，用 `retry_application_operation_save`，新operationId标识保存恢复、originalOperationId指原编辑调用；不新建文件/工程、重复图层或重新修补来绕过保护。取回图后检查整体、细边缘、接缝与透明背景，报告实际落位和未验部分。
