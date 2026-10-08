# 时间线与检查

所有修改都用 `change_application_entities`；`changes` 按顺序执行。引用 id 一律取自上下文或工具返回，不要自己拼不存在的 id。

## 放进时间线

需要用到上一步新建对象的 id 时分两次调用：先提交源码，拿到结果后再插入。

- 生成器：提交 `video_edit.code_material` 后，结果里会有级联新建的 `video_edit.item`。没看到时用 `list_application_entities`，entityType 为 `video_edit.item`，`where` 写 `{"video_edit.item.kind":"code","video_edit.item.name":"素材名"}`。
- 插入片段：`create_items`，entityType `video_edit.clip`，parent 为序列引用，属性：
  - 必填 `video_edit.clip.item_id`（素材项引用 id 冒号后的部分）、`video_edit.clip.kind`（填 `"code"`）、`video_edit.clip.name`；
  - 常用 `video_edit.clip.start`（序列帧，默认取上下文的 `frame`）、`video_edit.clip.track`（轨道号）、`video_edit.clip.duration`（帧，动态素材不能超过声明时长）；
  - 可同时写 `video_edit.clip.code_parameters`、`video_edit.clip.code_curves`。
- 轨道号可以从同轨已有片段的 `video_edit.clip.track` 读到；不要假设新序列有几条轨道：先用 `list_application_entities` 读该序列的 `video_edit.track`（kind、index），缺轨道时在序列下 `create_items` 新建。锁定的轨道会拒绝修改，换轨道或请用户解锁。
- 滤镜：提交后只得到 `video_edit.code_material`。在目标片段下 `create_items`，entityType `video_edit.effect`，属性 `video_edit.effect.definition_id`（素材引用 id 冒号后的部分），可加 `video_edit.effect.name`、`video_edit.effect.parameters`。不设片段效果数量上限，按实际 GPU 资源保护执行；代码滤镜不能加到音频片段。单份源码 8 道 shaderFilter 工序预算不是片段效果数量限制。
- 片段画面位置：`video_edit.clip.x`、`video_edit.clip.y` 为归一化坐标，另有 `video_edit.clip.scale`、`video_edit.clip.rotation`、`video_edit.clip.opacity`。先读现值再改。

## 批量修改

改多个片段或多个参数时，把每个目标的 `set_properties` 放进同一个 `changes` 数组，一次提交。参数和关键帧写入前按源码声明校验；换源码版本、换图片参数或修改效果时还会试渲染。任一步失败整组不写入，错误会说明原因。

## 取帧检查

`observe_video_edit_frame` 输入：

- `documentRef`：`{kind:"video_edit.document", id}`
- `target`：合成帧 `{kind:"program", sequenceRef, frame}`（frame 是序列整数帧）；源画面 `{kind:"source", itemRef, timeUs}`（timeUs 是素材项源素材的微秒时间）
- `maxWidth` 可选，256–3840，默认 1920；常规核对用 960 左右即可。
- `overlayAnnotations:true` 叠加当前帧未关闭标注和原始列表编号；`annotationIds:["原始标注id"]` 指定标注（可包含已通过项），不是完整实体 ref.id。
- `cropAnnotationId:"原始标注id"` 按 point/region/stroke/element.region 裁切放大。range 无画面区域不能裁切；目标须属于此序列且覆盖此帧，元素不可定位时先核对源码版本。
- `highlightElement:{clipRef,elementId}` 高亮当前帧可见代码元素。以上标注/高亮选项只支持 program，不用于 source。

它按当前剪辑版本离屏渲染，不改用户的播放头、选区和画面。返回的 `resultRef` 交给 `read_application_media` 读到 eof，读到像素后再评价。动画至少看开始、关键帧附近和结束三处；只看一帧不能证明动画正确。

处理批注读 annotations；修改源码使用 languageVersion:3 并新增固定版本，参数仍属于片段实例。不要用旧元素位置/旧版本帧评价新作品，也不要把编译成功当作像素验收。

## 撤销与保存

- 写入成功后应用自动保存。
- `undo_video_edit` / `redo_video_edit` 输入 `documentRef`，每次一步；撤销后回读相关属性，确认回到预期再报告。
- `save_video_edit` 只重试保存，不会重复编辑。

## 失败恢复

- 编译或试渲染失败：剪辑没有变化。按错误类别和行列改源码，作为新操作提交。
- 「检查期间剪辑已修改」「原剪辑已关闭」：重新读取目标后再提交。
- 属性或实体写错：错误会列出可用项，按列出的改，不要换名乱试。
- 结果未知或断线：外部连接用 `get_application_operation` 按原 operationId 查询，不要换标识重做；部分完成且提示可只重试保存时用 `retry_application_operation_save`。
- 删除片段或素材属于破坏性操作，需要用户明确同意，并按要求提供 baselineIds。
