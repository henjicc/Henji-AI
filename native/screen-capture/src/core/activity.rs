//! 活动时间线：与画面同一时钟的旁路记录，一行一条 JSON（只追加，进程被杀时最多丢最后一秒）。
//!
//! 给助手粗剪用：哪几秒画面没变（加载、等待）、前台窗口何时换成了哪个。条目种类：
//! - `start`：`{timeUs, fps}`，网格起点；
//! - `motion`：`{frame, timeUs, cells, freshFrames, bytes}`，从文件第 frame 帧起的 cells 格里系统给了几张新帧、
//!   编码后共多少字节。系统只在重新合成画面时给新帧，freshFrames 为 0 一定是静止；但屏幕上只要有窗口在不停重画
//!   （哪怕内容没变）就一直有新帧，这时看 bytes：没变的帧编码后只有几百字节；
//! - `foreground`：`{frame, timeUs, title, process, pid}`，前台窗口或它的标题变了；
//! - `pause` / `resume`：`{frame, timeUs}`；`stop`：`{frame, timeUs}`。
//! `frame` 是文件帧序号（pts），`timeUs` 是平台单调时钟的微秒。

use serde_json::{json, Value};
use std::{
    fs::File,
    io::{self, BufWriter, Write},
    path::Path,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Foreground {
    pub title: String,
    pub process: String,
    pub pid: u32,
}

struct Bucket {
    frame: u64,
    time_us: i64,
    cells: u32,
    fresh: u32,
    bytes: u64,
}

pub struct Writer {
    file: BufWriter<File>,
    bucket_cells: u32,
    bucket: Option<Bucket>,
    foreground: Option<Foreground>,
}

impl Writer {
    pub fn create(path: &Path, origin_us: i64, fps_num: u32, fps_den: u32) -> io::Result<Self> {
        let mut writer = Self {
            file: BufWriter::new(File::create(path)?),
            bucket_cells: (fps_num / fps_den.max(1)).max(1),
            bucket: None,
            foreground: None,
        };
        writer.line(json!({"type": "start", "timeUs": origin_us, "fps": fps_num as f64 / fps_den.max(1) as f64}))?;
        Ok(writer)
    }

    /// 每写一行就交给系统：条目不多（每秒一两行），进程被杀时已写的都在。
    fn line(&mut self, value: Value) -> io::Result<()> {
        serde_json::to_writer(&mut self.file, &value)?;
        self.file.write_all(b"\n")?;
        self.file.flush()
    }

    fn close_bucket(&mut self) -> io::Result<()> {
        match self.bucket.take() {
            Some(bucket) => self.line(json!({
                "type": "motion", "frame": bucket.frame, "timeUs": bucket.time_us,
                "cells": bucket.cells, "freshFrames": bucket.fresh, "bytes": bucket.bytes,
            })),
            None => Ok(()),
        }
    }

    /// 每个进文件的格子调用一次；满一秒写一条。
    pub fn cell(&mut self, frame: u64, grid_us: i64, fresh: bool, bytes: u64) -> io::Result<()> {
        let bucket = self.bucket.get_or_insert(Bucket { frame, time_us: grid_us, cells: 0, fresh: 0, bytes: 0 });
        bucket.cells += 1;
        bucket.fresh += fresh as u32;
        bucket.bytes += bytes;
        if bucket.cells >= self.bucket_cells {
            self.close_bucket()?;
        }
        Ok(())
    }

    /// 前台窗口有变化才写；暂停期间不调用，继续后第一次调用会补上当时的前台窗口。
    pub fn foreground(&mut self, frame: u64, time_us: i64, current: Option<Foreground>) -> io::Result<()> {
        let Some(current) = current else { return Ok(()) };
        if self.foreground.as_ref() == Some(&current) {
            return Ok(());
        }
        self.line(json!({
            "type": "foreground", "frame": frame, "timeUs": time_us,
            "title": current.title, "process": current.process, "pid": current.pid,
        }))?;
        self.foreground = Some(current);
        Ok(())
    }

    /// pause / resume / stop：先把没满一秒的统计写出，边界两侧不混在一条里。
    pub fn mark(&mut self, kind: &str, frame: u64, time_us: i64) -> io::Result<()> {
        self.close_bucket()?;
        self.line(json!({"type": kind, "frame": frame, "timeUs": time_us}))?;
        self.file.flush()
    }

    pub fn flush(&mut self) -> io::Result<()> {
        self.file.flush()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_one_motion_line_per_second_and_foreground_only_on_change() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("screen.activity.jsonl");
        let mut writer = Writer::create(&path, 1_000, 60, 1).unwrap();
        let editor = Foreground { title: "main.rs - 编辑器".into(), process: "Code.exe".into(), pid: 7 };
        writer.foreground(0, 1_000, Some(editor.clone())).unwrap();
        for frame in 0..90u64 {
            // 第一秒一直在变，之后静止。
            writer.cell(frame, 1_000 + frame as i64 * 16_666, frame < 60, if frame < 60 { 9_000 } else { 300 }).unwrap();
            writer.foreground(frame, 0, Some(editor.clone())).unwrap();
        }
        writer.mark("pause", 90, 1_501_000).unwrap();
        writer.mark("resume", 90, 3_501_000).unwrap();
        writer.foreground(90, 3_501_000, Some(Foreground { title: "终端".into(), process: "wt.exe".into(), pid: 9 })).unwrap();
        writer.mark("stop", 90, 3_600_000).unwrap();
        drop(writer);
        let lines: Vec<Value> = std::fs::read_to_string(&path).unwrap().lines().map(|line| serde_json::from_str(line).unwrap()).collect();
        let kinds: Vec<&str> = lines.iter().map(|line| line["type"].as_str().unwrap()).collect();
        assert_eq!(kinds, ["start", "foreground", "motion", "motion", "pause", "resume", "foreground", "stop"]);
        assert_eq!((lines[2]["frame"].as_u64(), lines[2]["cells"].as_u64(), lines[2]["freshFrames"].as_u64()), (Some(0), Some(60), Some(60)));
        assert_eq!((lines[3]["frame"].as_u64(), lines[3]["cells"].as_u64(), lines[3]["freshFrames"].as_u64()), (Some(60), Some(30), Some(0)));
        assert_eq!((lines[2]["bytes"].as_u64(), lines[3]["bytes"].as_u64()), (Some(540_000), Some(9_000)));
        assert_eq!(lines[6]["process"], "wt.exe");
    }
}
