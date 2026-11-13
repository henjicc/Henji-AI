# 结果：数据库启动自检与每日快照移出主进程（2026-11-13）

对应待办总表 9c、《全面审查-2026-11-10 / 01-数据层与启动》D4。未碰 git，未启动、重启或关闭应用，未跑 electron:bundle / build，未写真实数据目录（只读查看了 `E:\文档\HenjiAI\.system` 的文件大小，并把两份快照复制到临时目录做实验）。

## 一、现状（改前）

- **何时自检**：`db.ts` 的 `openDatabase` 每次打开都在版本预检、开 WAL 之后同步 `PRAGMA quick_check`，然后才跑迁移。主进程入口 `index.ts` 在 `app.whenReady` 里先 `getDb()`，之后才注册全部 IPC、创建窗口，所以自检期间窗口还没出来。
- **自检不过**：抛 `DatabaseCorruptError`，`getDb` 走 `restoreDatabaseFromSnapshot`：挑最新一份通过 quick_check 的快照，把 `henji.db` 与 `-wal/-shm` 原样移到 `backups/corrupt-<时间>/`，复制快照回来再打开；入口弹窗告知。没有完好快照时原样抛错，什么都不动。
- **何时快照**：打开成功后同步 `snapshotDatabase`：距最新快照满 24 小时就在主连接上 `VACUUM INTO` 到 `.partial`，改名，然后只留最近 7 份。只在启动时看一次，应用连开几天不会再快照。快照失败只记警告，不影响启动。
- **快照没有自检**：新快照写成就改名、删旧的，没有核对新快照本身能否通过自检（恢复时才挑能通过的）。
- **依赖“启动时库已校验”的调用方**：查过 `getDb()` 的全部调用方（素材库、生成记录、设置、助手记忆、回收区等），没有任何代码读取或依赖“已自检”这个状态；它们只依赖“库能打开、迁移已执行”。迁移是唯一在启动阶段大量改写数据的地方。
- **体积**：现在主库 57 MB（D1/D5 之后已从 166 MB 降下来）；`backups/snapshots/` 7 份共约 790 MB，其中 4 份是瘦身前的 155–166 MB，3 份是 50–52 MB。按现在的体积，7 份约 350 MB，旧的大快照会随保留策略自然淘汰。

### 实测（改前，热缓存，Electron 42 自带 Node 运行 better-sqlite3 12.11）

用真实快照的副本：`small.db`（11-12 的快照，49.9 MB，接近现在的库）与 `large.db`（11-09 的快照，158 MB，瘦身前的体积）。

| 操作 | 49.9 MB | 158 MB |
|---|---|---|
| 启动打开（版本预检 + WAL + quick_check） | 531 ms | 1595 ms |
| quick_check，主线程同步 | 420 ms（主线程停 420 ms） | 1696 ms（停 1696 ms） |
| VACUUM INTO，主线程同步 | 747 ms（停 747 ms） | 2617 ms（停 2617 ms） |

冷读会更慢（D4 记录 166 MB 冷读 quick_check 2.37 秒，带快照的那次启动这一段 5.09 秒）。

## 二、方案与依据

| 方案 | 主线程最长阻塞（49.9 / 158 MB） | 取舍 |
|---|---|---|
| better-sqlite3 `db.backup()`（Online Backup API，主连接分步，每步 100 页，步间让出事件循环） | 122 / 459 ms | 仍在主线程拷页，单步就能停住 0.1–0.5 秒；按 SQLite 官方说明，**其他连接**写库会让备份从头再来，命令行助手进程和主应用同时写时可能反复重来 |
| worker_threads + 独立只读连接执行 quick_check | 16 / 26 ms | 采用 |
| worker_threads + 独立只读连接执行 VACUUM INTO | 20 / 23 ms | 采用 |

依据：

- SQLite 官方：WAL 模式下读者和写者互不阻塞，一个读事务从头到尾看到同一个版本；`VACUUM INTO` 在一个读事务里生成该版本的完整、一致的副本，官方文档把它列为在线备份 API 的替代做法。所以后台线程用自己的只读连接做 `VACUUM INTO`，得到的是一致快照，主连接照常读写；代价只是这一两秒内自动 checkpoint 不能越过读者，WAL 暂时变长。实测只读连接执行 `VACUUM INTO` 可行。
- SQLite 官方：`quick_check` 与 `integrity_check` 的区别是前者不核对索引内容是否与表一致（O(N)，后者 O(NlogN)），能发现页面结构损坏、格式错误的记录等常见损坏。2026-10-21 的事故是主文件与 WAL 不同步导致 malformed，quick_check 能查出来，所以保留 quick_check，不升级到 integrity_check。
- better-sqlite3 官方文档（threads.md）：慢查询放进 worker_threads，每个 worker 自己开连接；驱动是 context-aware 的原生模块，可以在 worker 里加载。项目里已有同样的写法（`media-recycle/file-scanner.ts`、`web-source/hashes.ts` 用 `eval` worker，按 `createRequire(__filename).resolve()` 传模块路径），不需要改打包配置。
- 架构规则：主进程只协调 I/O 与生命周期，整库读写这种重活放后台线程。

### 改后的行为

1. **启动不等自检**：打开时只做版本预检（读结构与迁移账本，打不开、读不出结构这类最常见的损坏在这里就会暴露并走原恢复流程）。完整 quick_check 挪到后台。
2. **必须在首次写入前完成的自检，只剩两种情况**，这两种情况保持原来的同步自检：
   - **有待执行的迁移**（账本条数与程序不一致，含全新库）：迁移会大量改写数据，在坏库上执行只会让损坏扩散，迁移前备份也会把坏库原样备份。这只在升级后第一次启动出现。
   - **上次后台自检报过损坏**（存在 `henji.db.verify-on-start` 标记）：见下条。
3. **后台自检**：`getDb()` 之后排定，15 秒后在后台线程跑第一次。之后每小时看一次是否满 24 小时，满了就“自检 + 快照”一起做（应用连开几天也有每日快照）。
   - **发现损坏**：先记 error 日志，再写标记，然后弹窗提示用户保存后重启（“稍后重启 / 立即重启”）；本次会话不再写快照、不删任何快照。下次启动看到标记，就在任何写入前同步自检；不过就走原来的快照恢复流程（隔离原文件、换上最新完好快照、弹窗告知）。只有同步自检通过或已换上快照后才删标记；没有可用快照时标记保留、原样报错。
   - **后台线程起不来**（例如打包后 worker 里加载原生模块失败）：本次改在主线程执行，与改前的同步行为完全相同，并记 `db.maintenance.worker_failed`，自检与快照不会因此停掉。
4. **快照**：先自检主库，通过才写；写到 `.partial`，**对新快照再跑一次 quick_check**，通过才改成正式名，改名成功后才按保留策略删旧快照。任何一步失败都删掉半成品、旧快照一份不动。错误分两种：`VACUUM INTO` 读源库时报损坏（它全量读，比 quick_check 读得更全，能碰到 quick_check 不核对的坏处）按主库损坏处理，走上面的标记与提示；清理半成品、打开或自检副本出错、磁盘满这类只算“快照失败”，记日志、下次再试，不误报重启。带标记启动时的同步自检用 `integrity_check`（比 quick_check 多核对索引内容），以便查出后台全量读才发现的问题。超过一小时的残留 `.partial` 会被清掉（一小时内的可能是另一个进程正在写）。
5. **录制中**：录音或录屏进行中（`recording-power.ts` 已有的唤醒锁持有者，新增 `isRecordingInProgress()` 读出）推迟快照（它要写一整个库大小的文件），每分钟再看一次，录完再写。只读的自检不推迟，避免录制几个小时里一直写坏库。导出、转写不在这个信号里：快照已经不占主线程，只是磁盘读写，没有为它们另做信号。
6. **保留策略**：最近 7 份全留（与改前完全相同，下限不变）；更早的按固定的 7 天时间段每段留最新一份，最多 3 段，跳过最近 7 份已经占的段。总数最多 10 份，可退回的范围从 7 天延到约一个月。按现在 50 多 MB 的库约 500 MB；改前的 1.1 GB 主要是瘦身前的大快照，会自然淘汰。
   - 周段必须是固定的（`floor(时间 / 7天)`），不能按“距今几周”滑动：滑动分段时每天的新快照都会把同一份老快照挤出当前档，永远攒不出周档（第一轮审查查出，已改并补了逐日滚动 60 天的测试）。
   - “只在库有变化时才快照”没有做：SQLite 没有跨连接、跨启动可靠的“自上次快照后是否有写入”标识（`data_version` 只对本连接有意义），用文件大小或修改时间判断不可靠；快照已经不占主线程，每天一份的代价只是磁盘，宁可多一份。

## 三、改动文件

- `electron/main/services/db.ts`：`openDatabase` 只在有待执行迁移或存在损坏标记时同步自检；新增 `scheduleDatabaseMaintenance`（后台调度、录制推迟快照、损坏标记与通知、日志）与测试用 `waitForDatabaseMaintenanceIdle`；`closeDb` 先停后台维护；去掉启动时的同步快照。
- `electron/main/services/db-maintenance.ts`（新）：后台线程的自检与快照（`runDatabaseMaintenance`），线程起不来时回退主线程；结果判定 `classifyDatabaseJob`。
- `electron/main/services/db-recovery.ts`：去掉同步 `snapshotDatabase`；新增 `isDatabaseSnapshotDue`、`snapshotsToPrune`（保留策略）、`pruneDatabaseSnapshots`、`removeStalePartialSnapshots`、`quickCheckPassed` / `quickCheckFailure`；`listDatabaseSnapshots` 只列文件。恢复流程 `restoreDatabaseFromSnapshot` 只多了一个可选参数（挑快照用哪种检查），默认行为不变；`verifyDatabase` 同样多了可选的 `integrity_check`。
- `electron/main/services/recording-power.ts`：新增 `isRecordingInProgress()`。
- `electron/main/index.ts`：`getDb()` 之后调用 `scheduleDatabaseMaintenance`，损坏时弹窗（命令行模式写 stderr）。
- `electron/main/services/db-recovery.native.test.ts`：按新行为重写。

数据库文件格式、表结构、迁移账本都没有改；`henji.db.verify-on-start` 是数据库旁的一个纯文本标记文件。

## 四、验证

- `npx tsc -p tsconfig.electron.json --noEmit`：本次改动通过。收尾时工作区里别人正在改的 `electron/main/services/screen-recording/capture/capture.test.ts` 有语法错误，会让 tsc 跳过语义检查，所以另用一份排除该文件的临时 tsconfig（继承原配置）跑了一遍，通过。
- 改到文件的 eslint（`--max-warnings 0`）：通过。
- `npm run check:main-imports`：通过。
- `npm run test:assistant-persistence -- electron/main/services/db-recovery.native.test.ts`（Electron ABI 原生 SQLite）：13 项全过，包括：
  - 带标记恢复时跳过只坏在索引内容上的快照（这份快照能过 quick_check、过不了 integrity_check）；
  - 结果判定：复制时读到源库损坏判主库损坏，副本自身的问题、磁盘满只算快照失败；
  - 后台线程写快照、每天最多一份、不留半个文件；
  - 每天一份连续写 60 天，始终留着最近 7 天，另有 3 份分属更早的不同周；
  - 改名失败时旧快照一份不少；快照阶段出错只算快照失败、不判主库损坏；
  - 自检不过时不写新快照、不删旧快照；
  - 自检与快照期间主线程最长间隔小于 100 ms，且小于同步执行耗时的一半；
  - 端到端：坏了一个数据页的库照常打开（不等自检）→ 录制进行中的后台自检照样发现损坏、留下标记并通知、不动快照 → 下次 `getDb` 同步自检、换上完好快照、隔离原文件、删掉标记；
  - 录制中推迟快照，录完才写；
  - 原有的损坏识别、恢复跳过坏快照、没有完好快照时不动原文件。
- `npm run test:assistant-persistence -- electron/main/services/db-migrations.native.test.ts`：14 项全过（`db.ts` 的其他用法没受影响）。
- `npx vitest run --mode unit electron/main/services/recording-power.test.ts`：通过。

### 改后实测

| | 49.9 MB | 158 MB |
|---|---|---|
| 启动打开（不跑迁移时） | 531 → **7 ms** | 1595 → **7 ms** |
| 后台自检，主线程最长阻塞 | 420 → **16 ms** | 1696 → **26 ms** |
| 后台快照，主线程最长阻塞 | 747 → **20 ms** | 2617 → **23 ms** |

剩下的十几毫秒是线程启动与消息往返。后台线程本身的耗时与改前相同（自检约 0.5 / 1.6 秒，快照约 0.8 / 2.4 秒），只是不再占主线程。

## 五、真实窗口验证步骤（交给用户或下一轮）

1. `npm run electron:dev -- --background` 启动，窗口出来后约 15 秒，用 `npm run logs:query` 或日志窗口找 `main.db` 域：应有 `db.check.completed`（`reason: background`，`thread: worker`），到了 24 小时还应有 `db.snapshot.completed`（带 `bytes`、`durationMs`、`pruned`）。
2. **正式构建上必须看一次 `thread` 字段**（`npm run electron:prod`）：若是 `main` 且伴随 `db.maintenance.worker_failed`，说明打包后 worker 里加载不了原生驱动，此时功能正确但仍会卡主线程，需要回来处理。
3. 开始录屏或录音后跨过快照时间点：日志应出现 `db.snapshot.deferred`，录完一分钟内出现 `db.snapshot.completed`，`deferredMs` 为推迟时长。
4. 损坏路径不要在真实数据上试；已由原生测试端到端覆盖。

## 六、独立审查

审了三轮（见下）。

- 第一轮「重要」两条：保留策略按“距今几周”滑动分段导致周档永远攒不出来、近一周可退回点从 7 降到 4 —— 已改为固定周段、最近 7 份全留并补逐日滚动测试；录制推迟会让自检推迟几个小时 —— 已改为录制中只推迟快照、自检照常。「小问题」已修：写标记失败会吞掉损坏通知（改为先记日志再写标记，失败单独记）；快照阶段错误被误判为主库损坏（分开回报）；回退主线程没有日志（补 `db.maintenance.worker_failed` 与 `db.maintenance.start`）；`listDatabaseSnapshots` 会把同名文件夹当快照（改为只列文件）。
- 第二轮「重要」一条：上一轮拆分后，`VACUUM INTO` 读源库报损坏也被降级成快照失败，用户不会被提示 —— 已把这一步的错误单独判定（读到损坏按主库损坏处理），带标记启动改用 integrity_check，并补判定测试。「小问题」：快照因磁盘满等原因失败后每小时重试一次整库读写（与改前节奏相同，记录不改）；回退主线程时打开连接失败也清掉半成品（已改）。
- 第三轮「重要」一条：带标记恢复时挑快照用 quick_check、换上后复检用 integrity_check，两者不一致；若最新快照只坏在索引内容上，会每次启动都换上它再失败、应用起不来 —— 已让恢复挑快照与复检用同一种检查（带标记时都是 integrity_check），并补了“快照能过 quick_check、过不了 integrity_check 时跳过它”的测试（用真实构造的索引内容不一致的库）。三轮后没有遗留的重要问题。
- 未改、在下节说明：退出时 worker 正在执行原生调用会拖慢退出；`.partial` 的 -wal/-shm 旁路文件（实测只读打开 VACUUM INTO 产物不会生成）；恢复时另一个进程还开着库（原有问题）。

## 七、风险与没做的

- **启动时不再每次都先自检再写**：没有待执行迁移、也没有标记时，损坏要到启动后约 15 秒的后台自检才发现，这 15 秒加上用户看到提示到重启之间的写入，换快照时会丢（坏文件原样隔离，可以手工找回）。改前最坏情况是同一天里自检之后发生的损坏，同样要到下次启动才发现，所以多出来的只有这十几秒到重启前的窗口。这是“启动不卡”与“写入前必先自检”之间的取舍，是本次唯一比改前松的地方，请确认是否接受；若不接受，可以只对体积超过某个阈值的库挪到后台。
- **打包后 worker 加载原生驱动**：开发环境与原生测试里可行；打包后依赖 Electron 在 worker 里的 asar 支持（better-sqlite3 整个在 asarUnpack 里）。没有在正式构建上验证；失败时自动回退主线程并记日志，正确性不受影响，见第五节第 2 步。
- **退出**：后台线程正执行 VACUUM INTO 时，`terminate()` 打断不了原生调用，退出可能多等最多一两秒；`closeDb` 的 `wal_checkpoint(TRUNCATE)` 碰到读者只返回忙，WAL 留到下次启动合并，不丢数据；残留 `.partial` 一小时后清掉。
- **原有问题（未改）**：后台自检留下标记后，若下一个启动的进程在另一个进程（命令行助手或主应用）仍打开库时执行恢复，Windows 上改名会失败、启动报错弹窗；macOS 上改名能成功但另一个进程继续写被隔离的文件。改前每次打开都自检，同样存在这条路径；标记让它更容易触发（需要两个进程同时运行）。
- **`compactDatabaseIfFragmented`**：首屏加载后的整库 `VACUUM` 仍在主进程同步执行（空闲页超过 32 MB 且占四分之一以上才触发，约一秒）。它要改写主库、必须在写连接上做，挪到后台线程会让主连接的写入等待最长 5 秒，没有动。
- **迁移前备份**（`db-migrations.ts` 的 `backupDatabase`）仍是同步 `VACUUM INTO`：只在升级后有破坏性迁移时发生一次，且必须在迁移前完成，没有动。
- 没有做“只在库有变化时才快照”，理由见第二节第 6 条。
- **极端情况的重复提示**：若后台 `VACUUM INTO` 读到损坏，而带标记启动时的 integrity_check 仍然通过，标记会被删掉，之后后台再次报损坏、再次弹窗。不丢数据、也不会悄悄跳过，只是每次启动提示一次；“快照全量读报损坏但 integrity_check 通过”的库没能构造出来做测试，判定逻辑用纯函数测试覆盖。
- **“quick_check 通过但 VACUUM INTO 报损坏”** 没有真实样本测试（索引内容不一致的库 VACUUM INTO 照样能成功，构造不出会让它报损坏的库），只测了判定函数。
