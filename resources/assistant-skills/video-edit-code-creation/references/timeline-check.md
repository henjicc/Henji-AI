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
- 滤镜：提交后只得到 `video_edit.code_material`。在目标片段下 `create_items`，entityType `video_edit.effect`，属性 `video_edit.effect.definition_id`（素材引用 id 冒号后的部分），可加 `video_edit.effect.name`、`video_edit.effect.parameters`。不设片段效果数量上限，按实际 GPU 资源保护执行；代码滤镜不能加到音频片段。代码滤镜内部的遍数由作者决定，不是片段效果数量限制。
- 片段画面位置：`video_edit.clip.x`、`video_edit.clip.y` 为归一化坐标，另有 `video_edit.clip.scale`、`video_edit.clip.rotation`、`video_edit.clip.opacity`。先读现值再改。

## 批量修改

改多个片段或多个参数时，把每个目标的 `set_properties` 放进同一个 `changes` 数组，一次提交。参数和关键帧写入前按源码声明校验；换源码版本、换图片参数或修改效果时还会试渲染。任一步失败整组不写入，错误会说明原因。

## 取帧检查

`observe_video_edit_frame` 输入：

- 自动选检查点先用 `query_video_edit_review`，给 documentRef、sequenceRef、半开整数帧 from/to；把返回 documentVersion 和 checkpoints.frames 交给本观察入口的 documentVersion 与 target={kind:"frames",sequenceRef,frames}。字幕/效果/转场候选不代表错误，跟踪区间来自已有原始采样，不会重新跟踪；低置信度/跟丢需实际看图，超出抽样的时段仍可能有问题。编辑、重开或已有跟踪结果更新后重新查询计划，进度变化不影响版本。

- `documentRef`：`{kind:"video_edit.document", id}`
- `target`：合成帧 `{kind:"program", sequenceRef, frame}`（frame 是序列整数帧）；源画面 `{kind:"source", itemRef, timeUs}`（timeUs 是素材项源素材的微秒时间）
- `maxWidth` 可选，256–3840，默认 1920；常规核对用 960 左右即可。
- `overlayAnnotations:true` 叠加当前帧未关闭标注和原始列表编号；`annotationIds:["原始标注id"]` 指定标注（可包含已通过项），不是完整实体 ref.id。
- `cropAnnotationId:"原始标注id"` 按标注覆盖的画面范围裁切放大（point/arrow/ellipse/region/text/marker/stroke/element.region）。range 无画面区域不能裁切；目标须属于此序列且覆盖此帧，元素不可定位时先核对源码版本。
- `highlightElement:{clipRef,elementId}` 高亮当前帧可见代码元素。以上标注/高亮选项只支持 program，不用于 source。

它按当前剪辑版本离屏渲染，不改用户的播放头、选区和画面。返回的 `resultRef` 交给 `read_application_media(mode="image")` 查看图像，读到像素后再评价。动画至少看开始、关键帧附近和结束三处；只看一帧不能证明动画正确。

处理批注读 annotations；修改源码新增固定版本，参数仍属于片段实例。不要用旧元素位置/旧版本帧评价新作品，也不要把编译成功当作像素验收。

## 片子数据的检查与修正

`query_video_edit_review` 传 `scene:{}` 启用三项，可用 checks 只选某项；省略 scene 不检查。minSeconds 默认 0.2 个播放秒（考虑片段速度、速度曲线、倒放与嵌套），查询边界保留阈值上下文；cursorJumpRatio 默认画面宽的 0.08。以下名称是结果 kind 值，不是工具名：

- scene_box_stale：声明 footage 且有所属窗口的记录，生效时段内素材不在窗口最上层，或窗口 src 超出记录的 sourceTime 范围，连续达到 minSeconds 才报。
- scene_cursor_jump：同窗口相邻项都画鼠标、src 不连续且叠化很短，录制坐标距离又超过 cursorJumpRatio 倍画面宽；跨剪切续放也查。日志、坐标缺失或鼠标隐藏时不判。
- scene_issue：保留解析器 severity=user 的 message 与字段位置，不把普通整理提示升成画面错误。

检查只读，不重新跟踪，不证明框可见；作者代码可能已把错位的框淡掉。

结果 timeline 是查询序列的半开整数帧，subjectRef 通常是 `video_edit.scene_record`，path 保留完整嵌套放置；motionEvidence.basis 为 scene_data，suggestion 给出片子剪后时刻和字段。记录时刻属于引用片段的素材时间：“片子剪后”是扣除内部剪切后的秒数，start_cut/end_cut 接受剪后秒数，values 内时刻是未剪秒数，duration 是未剪长度，不能拿序列帧直接写秒数。span/untilNext 用起止并与父区间相交；neighbors 复用统一影响时段：上一落点到下一落点的结束，首尾延伸到最近有时段祖先并与父区间相交，不含 margin；不能靠改 duration 假装结束，应调整下一落点或新增落点。叠化结束前旧画面仍在，不算已换掉。每条 timeline 只覆盖对应问题区间，不含中间正常段，也不证明每个放置都已看图。

proposal 形状为 [{ref,propertyId,value}]。先用 `describe_application_entities`（refs、propertyIds、detail="full"）核对可写性；同一 ref 的建议合成 `change_application_entities` 的 `set_properties`：target=ref、entityType=ref.kind、properties[propertyId]=value。写后用 `read_application_entity` 读回属性，再重查受影响区间。

values 建议已带完整取值，不要只写 cursor。同一记录不同源区间、拆分两侧和每个续放接缝分别列出；只有同源区间重复引用才取最早放置。end_cut 只建议收短一直错位到实际生效结束的尾部，取这段连续尾部的开头；中段不给收短 proposal，须拆成多段或在错位前后各加正确落点，保留后续正常部分。同一尾部的重复建议执行一次后重查，其他中段问题仍需处理。

上下文外已经开始的错位写“此前已开始”，不能把上下文边界当真实起点，也不给收短 proposal。手调过的结束字段、cursor 与带 {src} 锚定的时刻不给覆盖 proposal；按 suggestion 确认意图，直接写 start_cut/end_cut 可能改成固定秒数，需先确认或经 values 保持锚定。鼠标烘焙进画面时关闭 cursor 无效，应微调 src 或加叠化。没有 proposal 的先读声明与现值，核对 media/win、sourceTime 或按上述方式拆分；鼠标候选在未烘焙、未手调时可关闭 values.cursor，声明允许时加 xf 或微调 src。按意图选择，不自动改作者代码。

建议仅为当前页按需准备，收短只校验该记录结束字段；按时间片让出并检查取消，后续分页复用候选与已有建议。分页保持原 scene 条件；编辑使旧分页与 documentVersion 失效，须重查后取帧。不可读引用以警告返回，其他结果照常；有警告的片段不能判已通过。候选为零只证明本轮数据检查通过，目标错位消除后仍须处理其他条目。计算预算与候选条数预算分开，超计算量按提示缩小范围，不静默截断。

范围边界截在错位中间时，只能说“尚未确认是否延续到记录结束”，调整范围再查；已确认尾部但没有收短 proposal 时，按 suggestion 中手调、锚定、声明校验或剪切换算等原因处理。让出期间发生编辑会拒绝当前页。

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
