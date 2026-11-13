//! 开发用子命令：不经主进程直接录一段、对录完的旁路文件做统计。只用于自测与排查，应用不调用。

use crate::core::{
    protocol::{self, CaptureConfig},
    session::{Paths, Session},
    timing,
};
use crate::platform::Native;
use serde_json::{json, Value};
use std::{path::Path, sync::atomic::Ordering, thread, time::Duration};

fn option<'a>(arguments: &'a [String], name: &str) -> Option<&'a str> {
    arguments.iter().position(|argument| argument == name).and_then(|index| arguments.get(index + 1)).map(String::as_str)
}

fn number(arguments: &[String], name: &str, default: f64) -> f64 {
    option(arguments, name).and_then(|text| text.parse().ok()).unwrap_or(default)
}

/// record --out <目录> [--point x,y | --display \\.\DISPLAY1] [--seconds 30] [--fps 60] [--codec h264|hevc]
///        [--rate quality|vbr|cbr] [--bitrate 比特每秒] [--pause-at 秒 --pause-for 秒] [--prepare-ms 300]
/// 事件按一行一条 JSON 打到标准输出，最后一行是停止的应答。
pub fn record(arguments: &[String]) -> i32 {
    protocol::OUTPUT_LINES.store(true, Ordering::Release);
    let Some(directory) = option(arguments, "--out") else {
        eprintln!("缺少 --out <目录>");
        return 2;
    };
    let point = option(arguments, "--point").and_then(|text| {
        let mut parts = text.split(',').map(|part| part.trim().parse::<i32>());
        Some([parts.next()?.ok()?, parts.next()?.ok()?])
    });
    let request = json!({
        "sessionId": "dev", "directory": directory,
        "source": {"kind": "display", "id": option(arguments, "--display"), "point": point},
        "fps": number(arguments, "--fps", 60.0) as u32,
        "codec": option(arguments, "--codec").unwrap_or("h264"),
        "rateControl": option(arguments, "--rate").unwrap_or("quality"),
        "bitrate": number(arguments, "--bitrate", 0.0) as u64,
    });
    let (events, streamer) = protocol::spawn_streamer();
    let outcome = (|| -> Result<(), String> {
        let mut session = Session::prepare::<Native>(CaptureConfig::parse(&request)?, events.clone())?;
        events.send(json!({"event": "prepared", "info": session.info}));
        thread::sleep(Duration::from_millis(number(arguments, "--prepare-ms", 300.0) as u64));
        session.command("start", &json!({"id": "start"}))?;
        let seconds = number(arguments, "--seconds", 30.0);
        let (pause_at, pause_for) = (number(arguments, "--pause-at", -1.0), number(arguments, "--pause-for", 5.0));
        if pause_at >= 0.0 && pause_at < seconds {
            thread::sleep(Duration::from_secs_f64(pause_at));
            session.command("pause", &json!({"id": "pause"}))?;
            thread::sleep(Duration::from_secs_f64(pause_for));
            session.command("resume", &json!({"id": "resume"}))?;
            thread::sleep(Duration::from_secs_f64((seconds - pause_at).max(0.0)));
        } else {
            thread::sleep(Duration::from_secs_f64(seconds));
        }
        // 被中断的会话已经自己结束，停止会被拒绝：照常等它收尾。
        let _ = session.command("stop", &json!({"id": "stop"}));
        session.join();
        Ok(())
    })();
    events.barrier();
    drop(events);
    let _ = streamer.join();
    match outcome {
        Ok(()) => 0,
        Err(error) => {
            println!("{}", json!({"ok": false, "error": protocol::failure(&error)}));
            1
        }
    }
}

/// preview-read：在另一个进程里按句柄打开预览纹理并读回（自测用，见平台层的说明）。
pub fn preview_read() -> i32 {
    #[cfg(windows)]
    let outcome = crate::platform::windows::read_preview_from_stdin();
    #[cfg(not(windows))]
    let outcome: Result<Value, String> = Err("这个平台还没有预览".into());
    match outcome {
        Ok(result) => {
            println!("{result}");
            0
        }
        Err(error) => {
            println!("{}", json!({"error": error}));
            1
        }
    }
}

fn spread(values: &mut [i64]) -> Value {
    if values.is_empty() {
        return json!(null);
    }
    values.sort_unstable();
    let at = |fraction: f64| values[((values.len() - 1) as f64 * fraction).round() as usize];
    json!({"min": values[0], "p50": at(0.5), "p99": at(0.99), "max": values[values.len() - 1]})
}

/// inspect <目录> [文件名前缀]：读清单与逐帧时刻表，输出新帧 / 重复 / 丢弃、暂停位置、来源帧间隔与延后量的分布。
pub fn inspect(arguments: &[String]) -> i32 {
    let Some(directory) = arguments.first() else {
        eprintln!("用法：inspect <目录> [文件名前缀]");
        return 2;
    };
    let paths = Paths::new(Path::new(directory), arguments.get(1).map(String::as_str).unwrap_or("screen"));
    let (header, records) = match timing::read(&paths.timing) {
        Ok(table) => table,
        Err(error) => {
            eprintln!("读不了逐帧时刻表：{error}");
            return 1;
        }
    };
    let manifest: Value = std::fs::read(&paths.manifest).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok()).unwrap_or(Value::Null);
    let period = 1_000_000 * header.fps_den.max(1) as i64 / header.fps_num.max(1) as i64;
    let has = |record: &timing::Record, flag: u16| record.flags & flag != 0;
    let fresh: Vec<&timing::Record> = records.iter().filter(|record| has(record, timing::FLAG_FRESH)).collect();
    let dropped = records.iter().filter(|record| has(record, timing::FLAG_DROPPED)).count();
    let mut intervals: Vec<i64> = fresh.windows(2).map(|pair| pair[1].source_us - pair[0].source_us).collect();
    // 相邻两张新帧隔了一帧半以上：这中间屏幕没变，或者来源少给了帧。
    let long_gaps = intervals.iter().filter(|interval| **interval > period * 3 / 2).count();
    // 格时刻减所用来源帧的采集时刻：这张画面在文件时间轴上比它实际出现晚了多少。
    let mut delays: Vec<i64> = fresh.iter().map(|record| header.cell_time(record.cell) - record.source_us).collect();
    let pauses: Vec<Value> = records
        .windows(2)
        .enumerate()
        .filter(|(_, pair)| pair[1].cell != pair[0].cell + 1)
        .map(|(index, pair)| json!({"frame": index + 1, "pausedCells": pair[1].cell - pair[0].cell - 1, "afterResumeFlag": has(&pair[1], timing::FLAG_AFTER_RESUME), "keyframe": has(&pair[1], timing::FLAG_KEYFRAME)}))
        .collect();
    let summary = json!({
        "fps": header.fps_num as f64 / header.fps_den.max(1) as f64,
        "originUs": header.origin_us,
        "records": records.len(),
        "freshFrames": fresh.len(),
        "repeatedFrames": records.len() - fresh.len() - dropped,
        "droppedFrames": dropped,
        "pauses": pauses,
        "freshIntervalUs": spread(&mut intervals),
        "freshIntervalsOverOneAndHalfFrames": long_gaps,
        "freshDelayUs": spread(&mut delays),
        "sourceTimesMonotonic": records.windows(2).all(|pair| pair[0].source_us <= pair[1].source_us),
        "manifest": {"completed": manifest["completed"], "result": manifest["result"], "video": manifest["video"]},
    });
    println!("{}", serde_json::to_string_pretty(&summary).unwrap());
    0
}
