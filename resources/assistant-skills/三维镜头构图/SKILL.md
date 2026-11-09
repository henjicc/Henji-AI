---
name: 三维镜头构图
description: 在 3D 镜头参考里快速搭城市、街道、广场、人群布景，摆人物和机位定构图，做状态关键帧与运镜时使用。
---

# 3D 镜头参考：快速布景、构图与运镜

镜头参考用来快速摆抽象场景、定构图和人物关系，效率第一，画面次要。

## 铁律

1. 文档 ID 取自宿主上下文或 `list_documents`（kind=camera_stage）；画布里的 3D 镜头参考节点读节点属性取它的镜头参考文档 id，不用打开也能改；新建的节点还没有镜头参考时先用 `open_canvas_node_editor` 打开一次来创建，用户要看时也用它打开；对象、布景、摄像机 id 取自 `observe_camera_stage_scene`，不猜、不按名称定位。
2. **成片布景一次生成**：城市、街道、广场、人群用 `generate_camera_stage_set`，一次调用一个撤销点、一次存盘。不要用 `place_camera_stage_object` 一栋一栋地摆楼。
3. 单个主体（主角、道具、摄像机）用 `place_camera_stage_object`；改已有对象的属性用 `change_application_entities` 的 `set_properties`。
4. 布景成员是普通对象，可以逐个改；要整体换参数就重新生成，不要逐个改几百栋楼。

## 布景生成

`layout.preset` 必填，其余参数都可省略（单位米、角度为度、楼高按层），默认值见能力说明。1 单位 = 1 米，角色约 1.8 米高。
街宽、街区尺寸、层高、楼的体量由城市风格按真实城市取值，不要试图用参数凑：

| preset | 常用参数 |
| --- | --- |
| `city` 城市街区 | `style` grid 方格城市（纽约式 80×260 米街区，默认）/ superblock 国内新城（50 米主干道围出约 400 米超级街区，小区高层加商业裙楼塔楼）/ oldtown 欧式老城（113 米方街区、6 层左右）/ organic 自然路网（三级道路自然弯曲交织，楼沿街排）、`width`/`depth` 范围、`density` 0–1、`floors {min,max}` 楼层、`heightProfile` downtown 中心高 / uniform、`props` 参照物；organic 另有 `curvature` 0–1 路网弯曲程度、`river` 穿城河流、`parks` 公园 |
| `street` 街道 | `length`、`road` local 支路 / collector 次干道 / arterial 主干道、`density`、`floors`、`props` |
| `plaza` 广场 | `size` 广场边长、`density`、`floors`、`monument`、`props` |
| `crowd` 人群 | `count`、`formation` grid / scatter / ring、`spacing`（默认 0.9 米）、`facing` forward / center / random |

通用：`center {x,z}`、`rotation`、`seed`。方格类城市的中心总落在两条干路的路口上，主角放在原点附近的路口不会和楼相交；自然路网的原点不一定是路口，主角用自动布置找空地。

- 参照物（`props`，默认开）：人行道与路缘、车道线与斑马线、行道树、路灯、车辆，按真实尺寸摆好，帮生成模型读出尺度。它们不是对象，点不中、不参与碰撞；要清掉就 `props: false` 重新生成。角色站在人行道上时脚下的铺装只高 4 厘米，不用抬高角色。
- 规模：默认方格城市约 370 栋；`width/depth` 给 1500 约 2400 栋，给 3100 约 1 万栋。新城楼少而高，欧式老城楼多而矮，自然路网 3000 米约 8000 栋。密度为 0（或太低碰巧一栋没有）时会在写入前被拒绝。
- 雾：场景默认 90 米。生成或删除布景时，雾距自动推到与布景尺度相配（上千米的城区约 1–2 千米，上限 10000 米）；用户关掉的雾或手调过的 `fog_distance` 不被改动。要更通透就调大 `camera_stage.scene.fog_distance` 或关掉 `fog_enabled`。
- 改参数重新生成：传 `replaceSetId`（取自观察结果 `sets[].id`），只写要改的字段，其余沿用上一次（包括种子）；换风格又没给楼层时楼层取新风格的默认；换一种随机布局就换 `seed`。
- 整片删除：`change_application_entities` 对 `camera_stage.set` 执行 `remove_items`。新建布景不能用 `create_items`。

## 按构图意图定机位

**机位不要自己算坐标。** 用 `compose_camera_stage_shot` 描述想要的镜头，应用求出机位、注视点和焦距，并读回实际构图。一次调用一个撤销点。

| 意图 | 参数与取值 |
| --- | --- |
| 镜头关系 | `relation`：`single` 单人、`two_shot` 双人镜头、`over_shoulder` 过肩（`subjects` 为 [肩膀在前景的人, 被拍的人]）、`reverse_pair` 正反打一对（再给 `reverseCameraId`，第一台从 A 肩后拍 B，第二台从 B 肩后拍 A）。省略时一个主体为单人、两个为双人 |
| 景别 | `size`：`extreme_long` 大远景（人约占画高 1/10）、`long` 远景（约 1/3，脚在下三分线）、`full` 全景（头到脚）、`medium` 中景（膝以上）、`medium_close` 中近景（腰以上）、`close` 近景（胸口以上）、`closeup` 特写（肩以上）、`extreme_closeup` 大特写（脸的局部）。省略时单人、双人为中景，过肩、正反打为近景 |
| 画面位置 | `position`（单人）：`left` / `center` / `right` 落在三分线；默认 `auto` 按视线留空——人朝画面右看就站左三分线，正对镜头居中 |
| 从哪一面拍 | `view`（单人，按主体自己的左右）：`front`、`front_left`、`front_right`、`left`、`right`、`back`；省略取 3/4 正面，落在摄像机现在所在的一侧 |
| 角度 | `angle`：`eye_level` 平视（与眼睛同高）、`high` 俯拍、`low` 仰拍、`birds_eye` 鸟瞰。过肩与正反打只用平视：机位在前景那人肩后与他眼睛同高，站着的人肩后拍坐着的人自然是俯拍 |
| 焦距倾向 | `lens`：`wide` 广角 24mm（离得近、透视强）、`standard` 标准 50mm、`telephoto` 长焦 85mm（离得远、压缩空间）；过肩、正反打默认长焦。过肩的焦距按两人间距连续求：机位站在前景那人身后、前景约占画宽三分之一，两人离得远就换更长的焦距，200mm 也不够时景别逐档放宽；两人身高不同时正反打两台离被拍者一样远、景别一致，焦距按被拍者身高换算（矮的那边更长）。改了什么写在 `adjusted` 里 |
| 轴线 | 两人镜头默认守在两人连线的同一侧，跟已经拍这两人的机位一致；`crossAxis: true` 才有意越轴 |
| 遮挡 | 默认被挡时在意图范围内换角度或换焦距距离并在结果的 `adjusted` 里说明；`avoidOcclusion: false` 只报告不避让 |
| 时间 | `at.time` 或 `at.stateKeyframeId`：只把机位记进那一刻（没有状态关键帧就新建）；省略则整条时间轴都摆在这里，摄像机已有运镜时必须给 `at` |

主体用 `{ objectId }`（取自观察结果；布景里的楼用 `list_application_entities` 查 id），或布景里的一个地点 `{ point, height }`。新机位先用 `place_camera_stage_object`（`objectType: camera`, `reusePolicy: require_new`）建一台摄像机再定。

结果的 `shots[]` 是写入后按那一刻实际画面读回的：每个主体的 `shotSize`、`heightRatio`（占画高比例）、`horizontal` 左中右、`screenBox` 投影框、`lookRoom` 视线留空、`keyVisible` 脸或中心是否可见、`occludedBy` 被谁挡；两人镜头附 `axis`（谁在画左、谁在画右）。出现 `compositionHint`（改了机位、被挡、出画，或实际景别、角度与要的不同）或 `adjusted` 时，把实际情况如实告诉用户；还要换就改意图重新调用，不要手改坐标。

### 常见配方

- **建立镜头**：开场交代环境用 `size: extreme_long` 或 `long`，`angle: high` 或 `birds_eye`，`lens: wide`；主体可以是主角，也可以是布景里的地点 `{ point, height }`。
- **过肩正反打**：先建两台摄像机，`relation: reverse_pair`、`size: close`（或 `closeup`），一次定好正打和反打，两台自动在轴线同侧；对话开场再加一个 `two_shot` 交代两人关系。一整段戏要多机位时直接用下一节的 `cover_camera_stage_scene`。
- **揭示**：终点先定——在终点时刻 `at.time` 给清楚的构图；起点在更早的时刻让主体被前景挡住（`avoidOcclusion: false`，从前景物体后面的 `view` 拍），中间交给运镜引擎；也可以起点定好后用 `apply_camera_stage_camera_move` 的 `truck` 或 `crane` 移出遮挡。
- **跟拍**：主体会走动时用 `follow_camera_stage_character`（见下一节），不要在起点终点各定一次构图让引擎去接。

## 角色走位、动作与跟拍

**先排走位，再定机位、做运镜和跟拍。** 走位每一拍都写成状态关键帧，后排的运镜才对得上人的节拍。

`block_camera_stage_character` 用按顺序的节拍 `beats` 给一个角色排戏，一次调用一个撤销点：

| 节拍 | 参数 |
| --- | --- |
| 走到某处 `move` | `to` 目的地、`via` 途经点：地面坐标 `{ point: {x, z} }` 或对象 `{ objectId, side, distance }`（站在门、桌子、另一个人旁边，`side` 为 near / front / back / left / right）；时间三选一：`duration` 走多久、`endTime` 第几秒走到、`speed` 米/秒，都省略按步态默认速度；`gait`：walk 走 1.3、formal_walk 端正地走、crouch_walk 蹲着走、jog 跑 3、sprint 冲刺 7（米/秒）；`avoidObstacles` 默认绕开挡路的对象 |
| 转向 `turn` | `toward` 一个地点或对象（含摄像机：转身面对镜头），或 `{ yaw }`；`duration` 省略按角度，转 180° 约 1 秒 |
| 做动作 `action` | `action`：idle 待机、talk 站着说话、wave 挥手、sit_down 坐下、sit 坐着、stand_up 起身、interact 伸手操作、pick_up 拿东西、crouch 蹲着、dance、jump、fall 倒地、hit 受击等；一次性动作做完自己接后续（坐下后坐着，挥手后待机），循环动作给 `duration` 就做这么久再回到之前的动作 |
| 停一会 `wait` | `duration` |

每拍默认紧接上一拍，`at` 指定开始时刻，`startTime` 是第一拍的时刻（默认 0）。应用自己规划绕障路线、起步停下平滑加减速、朝向沿前进方向转；走跑动作按走过的路程推进，脚不打滑；动作之间交叉淡入淡出。走位接管角色从第一拍起的时间轴：之后已有的状态关键帧里角色都改成走位终点（结果的 `laterStateKeyframesAligned`）。

结果 `beats[]` 读回每拍的实际起止、终点位置与朝向；走动附 `route`（路线长度、平均速度、步态、`playbackRate` 动作放慢倍数、`detourPoints` 绕障拐点、`crossings` 仍穿过的对象）。出现 `crossings` 或 `blockingHint` 时换途经点或目的地重排。

`follow_camera_stage_character` 让摄像机在 `startTime`–`endTime` 跟着走动的角色拍，`size`、`position`、`angle`、`lens` 取值同定机位；`view` 相对行进方向：back 跟在身后、front 在前面倒退拍、left/right 侧跟；`frame: travel` 机位随路线转弯，`world` 方向不变（沿街平移）；`lag` 机位滞后秒数（默认 0.5，0 为硬贴）。起止时刻放在角色的状态关键帧上或角色停着的时候，主体停下后多留一秒。默认预判整段里主体会不会被挡，被挡就换方位或抬高并在 `adjusted` 里说明；`samples[]` 是几帧实际构图，`occlusions[]` 是被挡时段。跟拍时段里再给这台摄像机定机位（`at`）、做运镜或拖动机位，会结束那张卡前后两段的跟拍；整段重跟就再调一次。

### 常见配方

- **走到门口停下，转身挥手**：`move`（`to: { objectId: 门, side: front }`）→ `turn`（`toward: { objectId: 摄像机 }`）→ `action wave`。
- **跟着走的背影**：先排 `move`，再 `follow_camera_stage_character`（`view: back`、`size: full` 或 `medium`、`endTime` = 到达时刻 + 1）。
- **侧跟**：`view: left` 或 `right`，直街用 `frame: world`。
- **坐下说话**：`move` 到椅子 → `turn` 背对椅子 → `action sit_down` → `action sit_talk`（给 `duration`）。

`observe_camera_stage_scene` 的 `characters[].blocking` 是每个角色的动作时间线；传 `times` 读回这些时刻角色的位置、朝向（0 朝 +Z、90 朝 +X）、正在做的动作与速度，`follows` 列出跟拍时段。

## 多机位覆盖与剪辑（导演思维）

一段戏要拍成有景别变化、能切镜的段落时，按 **布景 → 走位 → 覆盖 → 剪辑 → 自检 → 修正** 做，景别与情绪、各种场面的覆盖配方和完整示例见 [导演思维](references/directing.md)（用 `load_assistant_skill` 读 `references/directing.md`）。

- `cover_camera_stage_scene`：给主体、时段、台词，一次布好建立、主镜头、过肩正反打、单人近景（可加反应、插入），全部守轴线同侧、整段静止；结果的 `visibleSpans` 是每台拍得到主体的时段。
- `cut_camera_stage_coverage`：按节拍剪成切镜序列写进**机位轨**（`camera_stage.camera_cut`，与状态关键帧互不牵连，切机位时人物动作照常连续），`pace` 选 fast / medium / slow；结果带规则检查。
- `check_camera_stage_edit`：对机位轨上已有的切镜跑剪辑规则，列出违规、涉及哪两镜与改法。手改切点后再查一遍。
- 单个切点：`change_application_entities` 对 `camera_stage.camera_cut` 执行 `create_items`（`time`、`camera_ref`）或 `remove_items`，改 `camera_stage.camera_cut.time` / `camera_stage.camera_cut.camera_ref`；观察结果的 `cameraCuts` 是当前机位轨，`coverages` 是记下的覆盖。

## 观察与验证

`observe_camera_stage_scene` 的 `objects` 只列逐个放置的对象；布景只在 `sets` 里给摘要（数量、范围、参数）。需要某栋楼时用 `list_application_entities` 分页列 `camera_stage.object`，或按范围判断，不要整片读回。

每台摄像机带 `composition`：当前画面的角度、焦距、拍到的主体及其景别、左中右、投影框与遮挡。自检构图先看它，再按需截图看画面。

检查一段动画或运镜时，把各关键时刻一次传进 `times`：结果的 `cameraSamples` 给出每台摄像机在这些时刻的位置、注视点和 `composition`。不要拖动播放头再逐个观察。

相对位置依据观察到的边界盒，不要凭空猜坐标；用户要求复用当前摄像机时不要新建。空间写入后用 `verify_camera_stage_scene` 做结构化验证；没有真读画面时只说结构化结果，不描述没看到的画面。

## 动画与运镜

- 状态关键帧动画：同一次 `change_application_entities` 里交替写 `camera_stage.playback.current_time` 与对象或摄像机的 `animatable.*` / `pose_preset`，应用自动建关键帧；最后可同事务写 `loop`、`playing`。不要按时间点拆成多轮。
- 语义运镜（环绕、推拉、平移、升降）用 `apply_camera_stage_camera_move`，每次追加一段；整理示范机位用 `organize_camera_stage_motion` 再 `apply_camera_stage_motion_candidate`。

### 连续运镜与运镜设备

- **一气呵成**：几段运镜要连成一个动作（推进接升降接环绕），从第二段起每段都传 `continuity: "smooth"`。这几段会合成一条连续轨迹：衔接处不减速，拐角自动圆滑，镜头角速度也连续。要在某处停住（节拍、对白）就传 `continuity: "stop"` 或不传；已经做好的衔接用 `change_application_entities` 改该状态关键帧的 `camera_stage.state_keyframe.continuity`。
- **按长度给时长**：各段时长尽量和路程成比例（同样 7 秒，3 米的升降和 10 米的环绕快慢差三倍），否则慢的那段中途会塌速，看着还是一顿。衔接卡是途经点，拐角会被切圆，经过时在拐角内侧一点。塌速时结果的 `timing.sag` 给出时刻与速度，`timing.suggestedJointTimes` 是整条一口气走完时各衔接卡应在的时刻：按它用 `change_application_entities` 改这些状态关键帧的 `camera_stage.state_keyframe.time`，或撤销后按路程重新分配各段 `duration`。
- **运镜设备**：`rig` 参数（或摄像机属性 `camera_stage.camera.rig`）选设备，人和助手都按名称选：
  - `dolly` 轨道车：平稳推拉横移，起停很柔，速度 ≤1.5 米/秒；
  - `crane` 摇臂：大幅升降与越过前景，转弯最缓，加速度 ≤0.5 米/秒²；
  - `steadicam` 斯坦尼康：跟拍、绕人走，带轻微漂浮；
  - `drone` 无人机：大范围高速、航拍，朝向跟得最慢；
  - `handheld` 手持：起步快、带手抖，纪实感；
  - `free` 不模拟设备（默认）：各段按 `speed` 预设走，衔接设平滑时仍连续。
  选了设备后起步和停下的加速度都从零开始，转弯按设备的惯性放缓。
- **注视跟随**：设备自带“镜头比主体慢半拍”的跟随（`camera_stage.camera.aim_lag`，单位秒，常用 0.1–0.3，0 为始终正对）。要构图锁死主体就设 0。播放、拖动时间轴与导出逐帧一致。
- **自检**：运镜结果的证据里有 `smoothness`：整条连续链的峰值速度、加速度、角速度，每个衔接点的 `velocityJump`（应接近 0）、中途停顿 `stops`（应为空）、与上一段的衔接 `continuityWithPrevious`（stop 表示停稳再走，有意的节拍停顿就不用改），以及 `timing.sag`（塌速）、`timing.reverses`（往回走）和设备上限检查 `timing.withinLimits` / `timing.requiredDuration`。出现 `smoothnessHint` 时按提示改：设平滑、调衔接时刻、加长时长或换设备。
- 运镜结果的证据里、或应用机位候选（`apply_camera_stage_motion_candidate`）的结果里出现 `clearanceHint`，说明轨迹穿过了楼、角色等对象（`clearance` 列出名称与第几秒）或钻到地面以下：按 `clearanceHint` 撤销后调整再应用（环绕把起始机位放远或抬高、推近调大 `distanceRatio`、升降减小幅度；候选就挪机位或改选其他候选），直到不再出现。推得太近、环绕半径小于楼宽时，注视对象本身也会被列出。
