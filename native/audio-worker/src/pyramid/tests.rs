use super::*;
use std::f32::consts::TAU;

fn wave(path: &std::path::Path, frames: usize) {
    let mut writer = hound::WavWriter::create(
        path,
        hound::WavSpec {
            channels: 2,
            sample_rate: 48000,
            bits_per_sample: 32,
            sample_format: hound::SampleFormat::Float,
        },
    )
    .unwrap();
    for frame in 0..frames {
        for channel in 0..2 {
            writer
                .write_sample(
                    (TAU * (440.0 + channel as f32 * 220.0) * frame as f32 / 48000.0).sin() * 0.3,
                )
                .unwrap();
        }
    }
    writer.finalize().unwrap();
}
fn bytes(column: &Column) -> Vec<u8> {
    let mut out = Vec::new();
    column.encode(&mut out);
    out
}

#[test]
fn aggregation_matches_definition_including_short_tail() {
    let audio = Samples {
        data: (0..22000)
            .map(|i| (TAU * 450.0 * i as f32 / 48000.0).sin() * (i % 71) as f32 / 100.0)
            .collect(),
        start: 0,
        channels: 1,
    };
    let cancel = AtomicBool::new(false);
    let total = column_count(0, 22000);
    let base = fft::columns(&audio, 205, 0, total as usize, 0, total, &cancel).unwrap();
    for level in 1..=5 {
        let direct = fft::columns(
            &audio,
            205,
            0,
            total.div_ceil(1 << level) as usize,
            level,
            total,
            &cancel,
        )
        .unwrap();
        let mut previous = base.clone();
        for _ in 0..level {
            previous = previous
                .chunks(2)
                .map(|pair| {
                    let mut c = pair[0].clone();
                    if pair.len() == 2 {
                        c.merge(&pair[1]);
                    }
                    c
                })
                .collect();
        }
        for (a, b) in direct.iter().zip(&previous) {
            assert_eq!(a.count, b.count);
            assert_eq!(bytes(a), bytes(b));
        }
    }
}

#[test]
fn impulse_column_ownership_matches_origin() {
    let mut data = vec![0.0; 32768];
    let position = 12 * 512;
    data[position] = 1.0;
    let audio = Samples {
        data,
        start: 0,
        channels: 1,
    };
    for level in [-5, 0, 1, 2] {
        let layout = resolution(level);
        let low = layout.low_bins(48000);
        let total = column_count(level, 32768);
        let rows = fft::columns(
            &audio,
            low,
            0,
            total as usize,
            level,
            column_count(0, 32768),
            &AtomicBool::new(false),
        )
        .unwrap();
        let strongest = rows
            .iter()
            .enumerate()
            .max_by(|(_, a), (_, b)| {
                let bin = low + 1500 * layout.high_fft / 48000;
                a.bins[bin].peak.total_cmp(&b.bins[bin].peak)
            })
            .unwrap()
            .0;
        let hop = 512.0 * 2_f64.powi(level);
        let origin = if level < 0 { -hop / 2.0 } else { -256.0 };
        assert_eq!(
            strongest,
            ((position as f64 - origin) / hop).floor() as usize
        );
    }
}

#[test]
fn long_window_resolves_two_tones_ten_hz_apart() {
    // 两个同时存在的正弦，中心处相位相反；长窗应显示双峰，短窗只有一个宽峰。
    let center = 16384;
    let audio = Samples {
        data: (0..32768)
            .map(|i| {
                let t = (i as f32 - center as f32) / 48000.0;
                ((TAU * 500.0 * t).cos() - (TAU * 510.0 * t).cos()) * 0.25
            })
            .collect(),
        start: 0,
        channels: 1,
    };
    let row = fft::columns(&audio, 205, 32, 1, 0, 64, &AtomicBool::new(false))
        .unwrap()
        .remove(0);
    let peaks = |offset: usize, n: usize| -> Vec<usize> {
        let begin = (480.0 * n as f64 / 48000.0) as usize;
        let end = (530.0 * n as f64 / 48000.0).ceil() as usize;
        (begin..end)
            .filter(|&k| {
                row.bins[offset + k].peak > row.bins[offset + k - 1].peak
                    && row.bins[offset + k].peak > row.bins[offset + k + 1].peak
            })
            .collect()
    };
    let low = peaks(0, 8192);
    assert_eq!(low.len(), 2, "长窗峰值：{low:?}");
    assert!(peaks(205, 2048).len() < 2);
}

#[test]
fn finest_layer_separates_impulses_six_ms_apart_at_every_hop_offset() {
    for rate in [44100_u32, 48000, 96000] {
        let spacing = (rate as f64 * 0.006).round() as usize;
        for offset in 0..16 {
            let first = 2048 + offset;
            let second = first + spacing;
            let mut data = vec![0.0; 4096];
            data[first] = 1.0;
            data[second] = 1.0;
            let audio = Samples {
                data,
                start: 0,
                channels: 1,
            };
            let rows = fft::columns(&audio, 0, 110, 80, -5, 8, &AtomicBool::new(false)).unwrap();
            let energy: Vec<f64> = rows
                .iter()
                .map(|c| c.bins.iter().map(|b| b.peak as f64).sum())
                .collect();
            let a = (first + 8) / 16 - 110;
            let b = (second + 8) / 16 - 110;
            let peak = energy[a].min(energy[b]);
            let valley = energy[a + 1..b]
                .iter()
                .copied()
                .fold(f64::INFINITY, f64::min);
            let dip = 10.0 * (peak / valley.max(1e-20)).log10();
            assert!(dip >= 3.0, "{rate} Hz, offset {offset}: valley {dip} dB");
            // 能量不外溢出半个 256 点窗（8 个 hop）以外。
            assert!(energy[a - 9] < peak * 0.25 && energy[b + 9] < peak * 0.25);
        }
    }
}

#[test]
fn adjacent_layers_preserve_resolved_tone_amplitude_with_padding() {
    for rate in [44100_u32, 48000, 96000] {
        // 包含非整数频点；频率至少有两个周期落入最短窗，避免把周期不足当作增益错误。
        for frequency in [0.05, 0.0973, 0.1737, 0.3111, 0.45] {
            for phase in [0.0_f64, 0.7, 1.9] {
                let audio = Samples {
                    data: (0..16384)
                        .map(|i| {
                            (std::f64::consts::TAU * frequency * i as f64 + phase).sin() as f32
                                * 0.3
                        })
                        .collect(),
                    start: 0,
                    channels: 1,
                };
                let mut previous: Option<f64> = None;
                for level in (-5..=0).rev() {
                    let layout = resolution(level);
                    let low = layout.low_bins(rate);
                    let hop = if level < 0 { 512 >> -level } else { 512 };
                    let row = fft::columns(
                        &audio,
                        low,
                        8192 / hop,
                        1,
                        level,
                        32,
                        &AtomicBool::new(false),
                    )
                    .unwrap()
                    .remove(0);
                    let at = frequency * layout.high_fft as f64;
                    let bin = at.floor() as usize;
                    let fraction = at - bin as f64;
                    let db = |k: usize| {
                        fft::quantize(row.bins[low + k].peak as f64) as f64 / 255.0 * 120.0 - 120.0
                    };
                    let value = db(bin) * (1.0 - fraction) + db(bin + 1) * fraction;
                    assert!(
                        (value - 20.0 * 0.3_f64.log10()).abs() <= 2.0,
                        "幅度标定: {value}"
                    );
                    if let Some(prior) = previous {
                        assert!((value - prior).abs() <= 1.0, "rate {rate}, frequency {frequency}, phase {phase}, level {level}: {prior} -> {value}");
                    }
                    previous = Some(value);
                }
            }
        }
    }
}

#[test]
fn tiles_match_larger_range_at_block_boundaries() {
    let dir = tempfile::tempdir().unwrap();
    let input = dir.path().join("input.wav");
    wave(&input, 70000);
    for level in [-5, 0, 2] {
        let run = |start, count, name: &str| {
            let output = dir.path().join(name);
            tile(
                TileRequest {
                    input_path: input.clone(),
                    output_path: output.clone(),
                    level,
                    column_start: start,
                    column_count: count,
                },
                &AtomicBool::new(false),
            )
            .unwrap();
            fs::read(output).unwrap()
        };
        let all = run(0, 64, &format!("all{level}"));
        let part = run(16, 32, &format!("part{level}"));
        let layout = resolution(level);
        let row_bytes = (layout.low_bins(48000) + layout.high_bins()) * 2;
        let all_count = column_count(level, 70000).min(64) as usize;
        let part_count = column_count(level, 70000).saturating_sub(16).min(32) as usize;
        for channel in 0..2 {
            assert_eq!(
                &part[channel * part_count * row_bytes..(channel + 1) * part_count * row_bytes],
                &all[(channel * all_count + 16) * row_bytes
                    ..(channel * all_count + 16 + part_count) * row_bytes]
            );
        }
    }
}

#[test]
fn persistent_layers_match_direct_definition_and_progress_is_readable() {
    let dir = tempfile::tempdir().unwrap();
    let input = dir.path().join("input.wav");
    wave(&input, 300123);
    let output = dir.path().join("pyramid");
    let result = build(
        BuildRequest {
            input_path: input.clone(),
            output_directory: output.clone(),
        },
        &AtomicBool::new(false),
        || {},
        |p| {
            let manifest: Value =
                serde_json::from_slice(&fs::read(output.join("manifest.json")).unwrap()).unwrap();
            assert_eq!(manifest["coveredFrames"], p["coveredFrames"]);
            for level in 3..=15 {
                for channel in 0..2 {
                    assert!(
                        fs::metadata(output.join(format!("level-{level}-channel-{channel}.rg")))
                            .unwrap()
                            .len()
                            >= manifest["available"][level].as_u64().unwrap() * 2460
                    );
                }
            }
        },
    )
    .unwrap();
    let mut reader = Audio::open(&input).unwrap();
    let audio = Samples {
        data: reader.read(0, reader.frames).unwrap(),
        start: 0,
        channels: 2,
    };
    for level in [3, 4, 8, 15] {
        let count = column_count(level, reader.frames);
        assert_eq!(result["available"][level as usize], count);
        let rows = fft::columns(
            &audio,
            205,
            0,
            count as usize,
            level,
            column_count(0, reader.frames),
            &AtomicBool::new(false),
        )
        .unwrap();
        for channel in 0..2 {
            let expected: Vec<u8> = rows
                .iter()
                .flat_map(|c| bytes(c)[channel * 2460..(channel + 1) * 2460].to_vec())
                .collect();
            assert_eq!(
                fs::read(output.join(format!("level-{level}-channel-{channel}.rg"))).unwrap(),
                expected
            );
        }
    }
}

#[test]
fn cancellation_stops_before_publish() {
    let dir = tempfile::tempdir().unwrap();
    let input = dir.path().join("input.wav");
    wave(&input, 600000);
    let output = dir.path().join("pyramid");
    let cancelled = AtomicBool::new(false);
    let result = build(
        BuildRequest {
            input_path: input,
            output_directory: output.clone(),
        },
        &cancelled,
        || {},
        |_| {
            cancelled.store(true, Ordering::Relaxed);
        },
    );
    assert!(result.unwrap_err().to_string().contains("取消"));
    let manifest: Value =
        serde_json::from_slice(&fs::read(output.join("manifest.json")).unwrap()).unwrap();
    assert_eq!(manifest["done"], false);
}

#[test]
fn full_1024_column_tile_matches_whole_context() {
    let dir = tempfile::tempdir().unwrap();
    let input = dir.path().join("full.wav");
    wave(&input, 40000);
    let mut audio = Audio::open(&input).unwrap();
    let samples = Samples {
        data: audio.read(0, audio.frames).unwrap(),
        start: 0,
        channels: 2,
    };
    let rows = fft::columns(
        &samples,
        resolution(-5).low_bins(48000),
        0,
        2048,
        -5,
        column_count(0, 40000),
        &AtomicBool::new(false),
    )
    .unwrap();
    let output = dir.path().join("tile.rg");
    tile(
        TileRequest {
            input_path: input,
            output_path: output.clone(),
            level: -5,
            column_start: 1024,
            column_count: 1024,
        },
        &AtomicBool::new(false),
    )
    .unwrap();
    let actual = fs::read(output).unwrap();
    let mut expected = Vec::new();
    let row_bytes = (resolution(-5).low_bins(48000) + resolution(-5).high_bins()) * 2;
    for channel in 0..2 {
        for row in &rows[1024..2048] {
            expected.extend_from_slice(&bytes(row)[channel * row_bytes..(channel + 1) * row_bytes]);
        }
    }
    assert_eq!(actual, expected);
}

#[test]
fn bulk_pcm_reader_matches_hound_across_batches_and_offsets() {
    let dir = tempfile::tempdir().unwrap();
    for (format, bits) in [
        (hound::SampleFormat::Int, 16),
        (hound::SampleFormat::Int, 24),
        (hound::SampleFormat::Int, 32),
        (hound::SampleFormat::Float, 32),
    ] {
        let input = dir.path().join(format!("{format:?}-{bits}.wav"));
        let mut writer = hound::WavWriter::create(
            &input,
            hound::WavSpec {
                channels: 2,
                sample_rate: 48000,
                bits_per_sample: bits,
                sample_format: format,
            },
        )
        .unwrap();
        for i in 0..4096 {
            if format == hound::SampleFormat::Float {
                writer.write_sample((i as f32 - 2000.0) / 4096.0).unwrap();
            } else {
                writer.write_sample(i * 2 - 4000).unwrap();
            }
        }
        writer.finalize().unwrap();
        // 以 hound 为独立参照，核对自行解析的 WAV 读取逐样本一致。
        let mut reference = hound::WavReader::open(&input).unwrap();
        reference.seek(17).unwrap();
        let count = (2000 - 17) * 2;
        let expected: Vec<f32> = if format == hound::SampleFormat::Float {
            reference.samples::<f32>().take(count).map(|v| v.unwrap()).collect()
        } else {
            let scale = 2_f32.powi(bits as i32 - 1);
            reference.samples::<i32>().take(count).map(|v| v.unwrap() as f32 / scale).collect()
        };
        let mut audio = Audio::open(&input).unwrap();
        audio.seek(17).unwrap();
        let mut stream = reader::Stream::new(audio).unwrap();
        let mut actual = Vec::new();
        for count in [0, 1, 3, 1024, 2938] {
            stream.append(count, &mut actual).unwrap();
        }
        assert_eq!(actual, expected);
    }
}

#[test]
fn interrupted_build_resumes_from_aligned_point_with_identical_output() {
    let dir = tempfile::tempdir().unwrap();
    let input = dir.path().join("long.wav");
    // 至少越过一个续算对齐点（第 3 层 4096 列 ≈ 1677 万帧）。
    let frames = (RESUME_ALIGN * 8 * 512 + 200_000) as usize;
    {
        let mut writer =
            crate::dsp::audio::F32Writer::new(File::create(&input).unwrap(), 1, 48000).unwrap();
        let block: Vec<f32> = (0..frames)
            .map(|i| (TAU * 440.0 * i as f32 / 48000.0).sin() * 0.3 * ((i / 9973) % 7) as f32 / 7.0)
            .collect();
        writer.write_samples(&block).unwrap();
        writer.finalize().unwrap();
    }
    let run = |output: &std::path::Path| {
        build(
            BuildRequest {
                input_path: input.clone(),
                output_directory: output.to_path_buf(),
            },
            &AtomicBool::new(false),
            || {},
            |_| {},
        )
        .unwrap()
    };
    let whole = dir.path().join("whole");
    assert_eq!(run(&whole)["resumedFromFrame"], 0);
    // 模拟中断：清单停在对齐点之后，对齐点之后的文件内容是半写的垃圾。
    let partial = dir.path().join("partial");
    fs::create_dir(&partial).unwrap();
    let mut manifest: Value =
        serde_json::from_slice(&fs::read(whole.join("manifest.json")).unwrap()).unwrap();
    let row = (resolution(0).low_bins(48000) as u64 + 1025) * 2;
    for level in MIN_PERSISTED..=MAX_LEVEL {
        let name = format!("level-{level}-channel-0.rg");
        let mut bytes = fs::read(whole.join(&name)).unwrap();
        let keep = ((RESUME_ALIGN + 37) >> (level - MIN_PERSISTED)) * row;
        bytes.truncate(keep as usize);
        let aligned = ((RESUME_ALIGN >> (level - MIN_PERSISTED)) * row) as usize;
        bytes[aligned..].fill(0xEE);
        fs::write(partial.join(&name), bytes).unwrap();
        manifest["available"][level] = json!((RESUME_ALIGN + 37) >> (level - MIN_PERSISTED));
    }
    manifest["done"] = json!(false);
    fs::write(partial.join("manifest.json"), manifest.to_string()).unwrap();
    assert_eq!(run(&partial)["resumedFromFrame"], RESUME_ALIGN * 8 * 512);
    for entry in fs::read_dir(&whole).unwrap() {
        let name = entry.unwrap().file_name();
        assert_eq!(
            fs::read(whole.join(&name)).unwrap(),
            fs::read(partial.join(&name)).unwrap(),
            "{name:?}"
        );
    }
}
