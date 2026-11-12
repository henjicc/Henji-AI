/*
 * 生成历史规模基准（只读排查用，不依赖应用）。
 * 运行：ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe tickets/46-正式使用链路/证据/规模/history-sqlite-bench.cjs [规模...]
 * better-sqlite3 按 Electron ABI 编译，所以借 Electron 的 Node 运行；库建在系统临时目录，跑完删除，不碰用户数据目录。
 *
 * 表结构与查询照抄：
 * - electron/main/services/generation-history/schema.ts（history 表、created_at 索引、FTS5 trigram 与同步触发器）
 * - electron/main/services/media-recycle/schema.ts:61-74（结果交接触发器 media_handoff_history_*）
 * - electron/main/services/generation-history/store.ts list()/insert()/update()/deleteMany()
 * 位置写法换算（scope.decodeValue）没有照搬，toRecord 里只做 JSON.parse；IPC 结构化克隆用 v8.serialize 近似。
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const v8 = require('node:v8')
const Database = require(path.resolve(__dirname, '../../../../node_modules/better-sqlite3'))

const sizes = process.argv.slice(2).map(Number).filter(Boolean)
const SIZES = sizes.length ? sizes : [1000, 10000, 50000]
const UNRELEASED_PCT = Number(process.env.UNRELEASED_PCT ?? 10)
const MODELS = ['seedream-4', 'nano-banana', 'flux-kontext', 'kling-2.1', 'veo-3', 'hailuo-02', 'minimax-tts', 'qwen-image', 'gpt-image-1', 'wan-2.2']
const PROMPT = '樱花树下的年轻女性，长黑发，仰头看向头顶透过花枝的光，神情安静。初春，头顶盛开的粉色樱花树冠，阳光从花枝后方倒注，粉色花瓣缓缓飘落。写实电影摄影，柔和逆光与光晕，浅景深，细腻真实的皮肤与发丝，轻微胶片颗粒。'

function ms(fn) { const t = process.hrtime.bigint(); const r = fn(); return [Number(process.hrtime.bigint() - t) / 1e6, r] }
function fmt(v) { return Math.round(v * 10) / 10 }

function createSchema(db) {
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE history (
      id TEXT PRIMARY KEY, provider_id TEXT NOT NULL, model_id TEXT NOT NULL, type TEXT NOT NULL, prompt TEXT,
      params TEXT NOT NULL, result_paths TEXT NOT NULL DEFAULT '[]', task_id TEXT, status TEXT NOT NULL,
      error_message TEXT, cost REAL, duration INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, deleted_at INTEGER
    );
    CREATE INDEX idx_history_created_at ON history(created_at DESC);
    CREATE INDEX idx_history_deleted_at ON history(deleted_at);
    CREATE VIRTUAL TABLE history_fts USING fts5(prompt, content='history', content_rowid='rowid', tokenize='trigram');
    CREATE TRIGGER history_fts_after_insert AFTER INSERT ON history BEGIN
      INSERT INTO history_fts(rowid, prompt) VALUES (new.rowid, new.prompt); END;
    CREATE TRIGGER history_fts_after_update AFTER UPDATE OF prompt ON history BEGIN
      INSERT INTO history_fts(history_fts, rowid, prompt) VALUES ('delete', old.rowid, old.prompt);
      INSERT INTO history_fts(rowid, prompt) VALUES (new.rowid, new.prompt); END;
    CREATE TABLE generation_submissions (
      request_id TEXT PRIMARY KEY, input_digest TEXT NOT NULL, response_json TEXT, created_at INTEGER NOT NULL,
      phase TEXT NOT NULL DEFAULT 'provider', model_id TEXT, media_released INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX media_recycle_submission_pending ON generation_submissions(media_released, phase);
  `)
  const handoff = (filter) => `UPDATE generation_submissions SET media_released = 1
    WHERE media_released = 0 AND phase = 'completed' AND (${filter})
      AND EXISTS (SELECT 1 FROM json_each(response_json, '$.filePaths'))
      AND NOT EXISTS (
        SELECT 1 FROM json_each(response_json, '$.filePaths') AS output
        WHERE NOT EXISTS (
          SELECT 1 FROM history, json_each(history.result_paths) AS result
          WHERE result.value = output.value
        )
      );`
  return () => { for (const action of ['INSERT', 'UPDATE OF result_paths']) {
    db.exec(`CREATE TRIGGER media_handoff_history_${action === 'INSERT' ? 'insert' : 'update'}
      AFTER ${action} ON history BEGIN ${handoff("EXISTS (SELECT 1 FROM json_each(response_json, '$.filePaths') AS output, json_each(NEW.result_paths) AS added WHERE output.value = added.value)")} END`)
  } }
}

function row(i) {
  const type = i % 10 < 7 ? 'image' : i % 10 < 9 ? 'video' : 'audio'
  const count = type === 'image' ? 1 + (i % 4) : 1
  const ext = type === 'image' ? 'png' : type === 'video' ? 'mp4' : 'mp3'
  const resultPaths = Array.from({ length: count }, (_, k) => `henji://user/生成/2026-11/${type}-${i}-${k}.${ext}`)
  const params = {
    prompt: `${PROMPT}#${i}`, aspect_ratio: '16:9', resolution: '2K', num_images: count, seed: i * 7919,
    uploadedFilePaths: i % 3 === 0 ? [`henji://user/上传/ref-${i}.jpg`] : undefined,
    __dimensions: '2048x1152', guidance_scale: 3.5, negative_prompt: '文字、水印、边框、低清晰度',
    __resultUrls: [`https://cdn.example.com/out/${i}.${ext}`],
  }
  const created = new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString().replace('T', ' ').slice(0, 19)
  return {
    id: `task-${i}`, provider_id: i % 2 ? 'ppio' : 'fal', model_id: MODELS[i % MODELS.length], type,
    prompt: `${PROMPT}#${i}`, params: JSON.stringify(params), result_paths: JSON.stringify(resultPaths),
    task_id: `srv-${i}`, status: i % 13 === 0 ? 'error' : 'success', created_at: created, resultPaths,
  }
}

function toRecord(r) {
  return { ...r, params: JSON.parse(r.params), resultPaths: JSON.parse(r.result_paths) }
}

function bench(n) {
  const file = path.join(os.tmpdir(), `henji-history-scale-${process.pid}-${n}.db`)
  const db = new Database(file)
  // 交接触发器在造数之后再建：造数时逐行触发会让造数本身变成 O(n²)（10k 行实测 4.6s），与要测的单次插入无关。
  const addHandoffTriggers = createSchema(db)
  const insert = db.prepare(`INSERT INTO history (id, provider_id, model_id, type, prompt, params, result_paths, task_id, status, created_at, updated_at)
    VALUES (@id, @provider_id, @model_id, @type, @prompt, @params, @result_paths, @task_id, @status, @created_at, @created_at)`)
  const sub = db.prepare(`INSERT INTO generation_submissions (request_id, input_digest, response_json, created_at, phase, media_released)
    VALUES (?, 'x', ?, 0, 'completed', ?)`)
  const [seedMs] = ms(() => db.transaction(() => {
    for (let i = 0; i < n; i++) {
      const r = row(i)
      // 未交接回执占比用 UNRELEASED_PCT 调（默认 10，偏保守）；11-13 只读查询用户真实库：已完成回执 127 条里 112 条未交接（88%）。
      sub.run(`req-${i}`, JSON.stringify({ filePaths: r.resultPaths }), (i % 100) < UNRELEASED_PCT ? 0 : 1)
      insert.run(r)
    }
  })())
  addHandoffTriggers()
  const out = { n, unreleasedPct: UNRELEASED_PCT, seedMs: fmt(seedMs), dbMB: fmt(fs.statSync(file).size / 1e6) }
  out.pagePlan = db.prepare(`EXPLAIN QUERY PLAN SELECT * FROM history WHERE deleted_at IS NULL ORDER BY created_at DESC, rowid DESC LIMIT 50`).all().map((r) => r.detail).join(' | ')

  const where = 'deleted_at IS NULL'
  const all = db.prepare(`SELECT * FROM history WHERE ${where} ORDER BY created_at DESC, rowid DESC`)
  const [listAllSql, rows] = ms(() => all.all())
  const [listAllParse, records] = ms(() => rows.map(toRecord))
  const [ipcMs, buf] = ms(() => v8.serialize(records))
  const [ipcBackMs] = ms(() => v8.deserialize(buf))
  out.listAll = { sqlMs: fmt(listAllSql), parseMs: fmt(listAllParse), cloneMs: fmt(ipcMs + ipcBackMs), payloadMB: fmt(buf.length / 1e6) }

  const page = db.prepare(`SELECT * FROM history WHERE ${where} ORDER BY created_at DESC, rowid DESC LIMIT 50 OFFSET ?`)
  out.page50Ms = fmt(ms(() => page.all(0))[0])
  out.page50DeepMs = fmt(ms(() => page.all(Math.max(0, n - 100)))[0])
  const byModel = db.prepare(`SELECT * FROM history WHERE ${where} AND model_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 50`)
  out.modelFilter50Ms = fmt(ms(() => byModel.all('veo-3'))[0])
  const fts = db.prepare(`SELECT * FROM history WHERE ${where} AND rowid IN (SELECT rowid FROM history_fts WHERE history_fts MATCH ?) ORDER BY created_at DESC, rowid DESC`)
  const [ftsMs, ftsRows] = ms(() => fts.all('"花瓣缓缓"'))
  out.ftsCommonMs = fmt(ftsMs); out.ftsCommonHits = ftsRows.length
  out.ftsRareMs = fmt(ms(() => fts.all(`"#${n - 7}"`))[0])
  const like = db.prepare(`SELECT * FROM history WHERE ${where} AND prompt LIKE ? ORDER BY created_at DESC, rowid DESC`)
  out.like2charMs = fmt(ms(() => like.all('%樱花%'))[0])
  out.countMs = fmt(ms(() => db.prepare(`SELECT COUNT(*) FROM history WHERE ${where}`).get())[0])
  out.getByIdMs = fmt(ms(() => db.prepare('SELECT * FROM history WHERE id = ? AND deleted_at IS NULL').get(`task-${n >> 1}`))[0])

  // 新任务完成：插入一行，对应一条未交接回执 → 触发交接（NOT EXISTS 子查询扫整张 history 的 json_each）。
  const runs = 10
  let insertTotal = 0, updatePathsTotal = 0, updateStatusTotal = 0
  for (let k = 0; k < runs; k++) {
    const r = row(n + k)
    sub.run(`req-new-${k}`, JSON.stringify({ filePaths: r.resultPaths }), 0)
    insertTotal += ms(() => insert.run({ ...r, id: `new-${k}` }))[0]
    updateStatusTotal += ms(() => db.prepare("UPDATE history SET status = 'success', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(`new-${k}`))[0]
    updatePathsTotal += ms(() => db.prepare('UPDATE history SET result_paths = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(r.result_paths, `new-${k}`))[0]
  }
  out.insertWithHandoffMs = fmt(insertTotal / runs)
  out.updateStatusMs = fmt(updateStatusTotal / runs)
  out.updateResultPathsMs = fmt(updatePathsTotal / runs)
  const released = db.prepare("SELECT COUNT(*) c FROM generation_submissions WHERE request_id LIKE 'req-new-%' AND media_released = 1").get().c
  out.handoffReleased = `${released}/${runs}`

  // 多选删除 1000 条（store.deleteMany：事务里逐条 UPDATE deleted_at）。
  const del = db.prepare('UPDATE history SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL')
  const ids = Array.from({ length: Math.min(1000, n) }, (_, i) => `task-${i * Math.max(1, Math.floor(n / 1000))}`)
  out.deleteMany1000Ms = fmt(ms(() => db.transaction(() => ids.filter((id) => del.run(Date.now(), id).changes > 0).length)())[0])
  const rest = db.prepare('SELECT id FROM history WHERE deleted_at IS NULL').all().map((r) => r.id)
  out.clearAllMs = fmt(ms(() => db.transaction(() => rest.filter((id) => del.run(Date.now(), id).changes > 0).length)())[0])

  db.close()
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(file + suffix, { force: true })
  return out
}

const started = Date.now()
for (const n of SIZES) {
  console.log(JSON.stringify(bench(n)))
  if (Date.now() - started > 25_000) { console.log('stop: time budget'); break }
}
