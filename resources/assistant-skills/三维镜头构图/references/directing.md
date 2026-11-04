# 导演思维：从一句话剧情到可看段落

> 何时读：用户要“拍一段戏”“导演一下”“多机位”“剪成片”“切镜头”，或要把一句剧情做成有景别变化、有剪辑的段落时。

## 镜头语言：先想这一镜要观众感受到什么

| 意图 | 镜头选择 |
| --- | --- |
| 交代环境、处境、孤独渺小 | 大远景、远景，俯拍，广角 |
| 看清动作与两人关系 | 全景、中景，双人镜头 |
| 情绪、反应、关键一句话 | 近景、特写；越私密越近 |
| 强调细节、制造紧张 | 大特写、插入镜头（道具、手） |
| 强势、压迫 / 弱小、被审视 | 仰拍 / 俯拍；平视保持中立 |
| 谁掌握场面 | 他在画面里更大、视线前方留空 |

- **景别逐步推近**：开场先建立，再全景、中景、近景；情绪升温时推近，场面结束或抽离时拉远。不要从大远景一刀切到特写。
- **运镜要有理由**：跟着走动的人（`follow_camera_stage_character`）、被声音或视线引过去（摇、推）、揭示新信息。说不出理由就让机位不动。
- **揭示**：起点让主体被前景挡住（`compose_camera_stage_shot` 的 `avoidOcclusion: false`），再用 `apply_camera_stage_camera_move` 的 `truck` 或 `crane` 移出来。
- **主观镜头**：过肩已是半主观（前景是看的人）；真主观把摄像机放到角色眼睛高度（约 1.65 米）、注视他看的东西。主观镜头前后各接一镜“他在看”。

## 剪辑规则（`cut_camera_stage_coverage` 按它剪，`check_camera_stage_edit` 按它查）

| 规则 | 条件 | 违反时怎么改 |
| --- | --- | --- |
| `axis` 180° 轴线 | 相邻两镜不在两人连线两侧 | 换同侧机位，或中间插一镜骑轴镜头 |
| `jump_cut` 30° | 相邻两镜看同一人的夹角 ≥ 30°，或景别差 ≥ 2 档 | 换角度差得开的机位，或拉开景别 |
| `cut_on_action` | 切点落在转身、坐下、走动的中段（20%–80%） | 把切点挪到建议时刻 |
| `speaker` | 换人说话时切到说话人，或切听的人的反应 | 在开口处切到说话人的过肩或单人 |
| `duration` | 镜头时长在节奏上下限内：fast 0.8–3.5 秒、medium 1.5–6、slow 3–12 | 合并太短的，长镜头中间切一次反应 |
| `establishing` | 开场第一镜是建立镜头或远景 | 开场用建立镜头 |
| `size_progression` | 相邻两镜景别不跳四档以上 | 中间加过渡景别 |
| `subject_visible` | 这一镜的主要主体大部分时间在画内、没被挡 | 换拍得到的机位（看 `visibleSpans`） |

## 场面配方

**对话（两人）**：建立 → 主镜头双人 → 过肩正反打 → 单人近景 → 反应特写。开口切说话人，情绪高处切近景，听的人有反应时切反应，全程守轴线。节奏 medium。

```json
{ "tool": "cover_camera_stage_scene", "input": { "documentId": "stage-doc", "subjects": ["jia", "yi"], "startTime": 0, "endTime": 20, "shots": ["establishing", "master", "over_shoulder", "single", "reaction"], "lines": [{ "speakerId": "jia", "startTime": 6, "endTime": 9, "text": "你怎么来了？" }, { "speakerId": "yi", "startTime": 9.5, "endTime": 13 }, { "speakerId": "jia", "startTime": 13.5, "endTime": 17 }] } }
```

**追逐**：两人跑（`gait: jog` 或 `sprint`），覆盖用建立（俯拍大远景看两人距离）、主镜头、每人单人；再给每人一台跟拍机位（`follow_camera_stage_character`，`view: back` 或 `front`）。节奏 fast，追的人与被追的人交替，画面上的奔跑方向保持一致。跟拍机位不在覆盖里，需要时用 `change_application_entities` 对 `camera_stage.camera_cut` 执行 `create_items` 补切点，再 `check_camera_stage_edit`。

```json
{ "tool": "follow_camera_stage_character", "input": { "documentId": "stage-doc", "cameraId": "cam-follow", "subjectId": "jia", "startTime": 2, "endTime": 8, "view": "back", "size": "full" } }
```

**独白（一人）**：建立 → 全景 → 近景 → 特写，景别跟着情绪一路推近；关键一句可加慢推（`dollyIn`）。节奏 slow。

```json
{ "tool": "cover_camera_stage_scene", "input": { "documentId": "stage-doc", "subjects": ["jia"], "shots": ["establishing", "master", "single", "reaction"] } }
```

**建立场景**：先 `generate_camera_stage_set` 搭布景，大远景俯拍交代地点，再远景、主体全景进入人物。

## 完整工作流：“甲走到乙面前，转身，两人说了几句”

1. **布景**：`generate_camera_stage_set`（广场、街道）或 `place_camera_stage_object` 摆桌椅；角色用 `place_camera_stage_object`。
2. **走位**：每个角色一次 `block_camera_stage_character`，把走动、转身、说话动作排进时间轴。

```json
{ "tool": "block_camera_stage_character", "input": { "documentId": "stage-doc", "characterId": "jia", "startTime": 0, "beats": [{ "kind": "move", "to": { "objectId": "yi", "side": "front", "distance": 1.2 }, "gait": "walk" }, { "kind": "turn", "toward": { "objectId": "yi" } }, { "kind": "action", "action": "talk", "duration": 3 }] } }
```

3. **覆盖**：`cover_camera_stage_scene` 布一套机位（见上面的对话配方）。看结果 `setups[].visibleSpans`：走位那段拍不到主体的机位，剪辑时会自动避开。
4. **剪辑**：`cut_camera_stage_coverage` 剪成切镜序列，`shots[].reason` 说明每一镜为什么在这里。

```json
{ "tool": "cut_camera_stage_coverage", "input": { "documentId": "stage-doc", "coverageId": "coverage-1", "pace": "medium" } }
```

5. **自检**：看结果的 `violations`；手改过切点再跑一次检查。

```json
{ "tool": "check_camera_stage_edit", "input": { "documentId": "stage-doc", "coverageId": "coverage-1", "pace": "medium" } }
```

6. **修正**：按上面规则表的改法改——换节奏重剪、补镜头（`cover_camera_stage_scene` 带 `replaceCoverageId` 加 `reaction` 或 `insert`）、或改个别切点（`camera_stage.camera_cut.time` / `camera_stage.camera_cut.camera_ref`）。改完回到第 5 步，直到没有错误；提示可以按戏的需要保留，但要告诉用户。
7. **看片**：`observe_camera_stage_scene` 读回机位轨 `cameraCuts`，需要画面时按切点时刻截图或导出视频，告诉用户每一镜拍了什么；没真看画面时只报结构化结果。
