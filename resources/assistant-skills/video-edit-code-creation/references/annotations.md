# 用户标注处理协议

标注与剪辑共用正式实体、事务、撤销和观察能力。只处理用户已发送的 open 标注；draft 待发送，addressed 等用户审查，resolved 已通过。不要自行发送草稿或代替用户通过。

## 发现与读取

先读宿主 videoEdit.openAnnotations 摘要，取稳定 ref、所属 document/sequence 和帧。摘要只给前若干条；总数更多时用 list_application_entities 列举 video_edit.annotation，按 sequence parent、where 的 video_edit.annotation.status:"open" 和 limit/cursor 分页，不把摘要条数当产品上限。

用 read_application_entity 的 propertyIds 读取 video_edit.annotation.status/text/frame/end_frame/target/clip_id/thread。提交前重读当前状态、完整讨论和修订。目标为 point/region/stroke/element/range；画面坐标为合成画幅归一化坐标。range 的起止帧含两端，画面目标也可能覆盖连续时间范围。

## 取叠加帧与局部帧

observe_video_edit_frame：documentRef 为实际剪辑引用；target.kind:"program"，sequenceRef 为标注所属序列，frame 为标注整数帧。

- overlayAnnotations:true 显示当前帧未关闭项及原编号。
- annotationIds 指定原始 annotation.id，可包括已通过项；不要传完整实体引用字符串。
- cropAnnotationId 使用同一原始 id，放大点、矩形、笔迹或元素 region。
- range 无画面区域，观察起止、中间与相邻接缝，不裁切。
- 可用 highlightElement:{clipRef,elementId} 核对当前帧元素。

返回 resultRef 交 read_application_media 读到 eof，真正读图后判断。标注不在此序列/帧或元素不可见时会拒绝，重新定位，不猜区域。可先看全帧关系再放大细节；只看裁切图可能误判对齐和主次。

## 定位代码元素

element 目标先按 clip_id 回读片段固定源码版本，再读 video_edit.code_version.source。用 elementId 与 sourceSpan 定位对应调用；源码位置是零基 UTF-16 偏移、左闭右开，一基行列帮助阅读。源码已变化时先核对版本/id，不能按旧偏移修改新源码。

如宿主有video_edit.document.selected_code_element，可读clipRef、elementId、sourceSpan与parameterKeys，优先修改关联参数。无关联参数的局部修正可沿video_edit.clip.element_overrides按elementId合并，先读并保留其他覆盖；不编造element实体。无命中／region时读源码或可见帧再改，坐标不证明源码归属。

参数修改走片段 code_parameters；结构改动新增 code_version，拿到返回引用后重绑 clip.code_version_id（滤镜重绑 effect.version_id），保留授权范围外实例、其它参数及曲线。必要时检查共享定义的调用方，不删除重建用户满意内容。

## 修改、回复与待审查

内容修改、追加 thread 与 status=addressed 放在同一次 change_application_entities。若先创建新源码版本获取引用，最终实例绑定/参数修改和标注回复仍合并一事务。thread 支持 mutate_properties 的 append，value 为新消息数组，保留全部既有讨论：

```json
{
  "summary":"提交标注处理结果供用户审查",
  "changes":[{
    "kind":"mutate_properties",
    "entityType":"video_edit.annotation",
    "target":{"kind":"video_edit.annotation","id":"实际返回的标注引用id"},
    "mutations":[
      {"propertyId":"video_edit.annotation.thread","operation":"append","value":[{
        "id":"本次生成的唯一消息id",
        "author":{"kind":"assistant","name":"助手"},
        "createdAt":"2026-10-08T00:00:00.000Z",
        "text":"已调整标题留白并核对进场、停留、退场；可撤销此次处理。"
      }]},
      {"propertyId":"video_edit.annotation.status","operation":"set","value":"addressed"}
    ]
  }]
}
```

这是回复部分示意，实际调用必须在 changes 前面加本次内容修改；时间、id 和说明换成本次真实值。内置身份用 assistant，外部用 external/name，不能冒充 user。addressedBy 由宿主维护，不写 revision/transactionId。回复说明改了什么、如何验证、用户能撤销哪次处理；未看过的帧不写成已验收。

回读内容和标注，再取帧读图；用户重开后的意见是新一轮输入。只有用户可写 resolved。用户要求撤销时走正式剪辑历史/标注审查入口，缺少历史不能宣称已撤销。

## 不要做

不覆盖/删旧讨论，不删标注冒充解决，不代用户通过，不猜路径/源码版本/媒体 URL，不私建执行或通知通道。批注不自动授予付费许可；生成继续服从正式授权。失败时保留标注可处理状态与完成素材，结果未知先查询原操作，不能重放已经发生的付费或内容修改。
