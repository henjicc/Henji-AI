use super::*;
use hound::{SampleFormat, WavSpec, WavWriter};
use serde_json::{json, Value};
use std::{f32::consts::TAU, fs, path::Path, time::Instant};

const SR: u32 = 48000;

fn write_wav(path: &Path, samples: &[f32], channels: u16) {
    let mut writer = WavWriter::create(
        path,
        WavSpec {
            channels,
            sample_rate: SR,
            bits_per_sample: 32,
            sample_format: SampleFormat::Float,
        },
    )
    .unwrap();
    for &x in samples {
        writer.write_sample(x).unwrap();
    }
    writer.finalize().unwrap();
}
fn read_wav(path: &Path) -> Vec<f32> {
    let mut audio = audio::Audio::open(path).unwrap();
    let frames = audio.frames;
    audio.read(0, frames).unwrap()
}
fn noise(seed: &mut u32) -> f32 {
    *seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
    (*seed as f64 / u32::MAX as f64 * 2.0 - 1.0) as f32
}
fn clean_signal() -> Vec<f32> {
    let mut seed = 1729;
    (0..SR as usize * 2)
        .flat_map(|i| {
            let t = i as f32 / SR as f32;
            let left = 0.23 * (TAU * 440.0 * t).sin()
                + 0.07 * (TAU * 880.0 * t).sin()
                + 0.0003 * noise(&mut seed);
            let right = 0.17 * (TAU * 660.0 * t + 0.3).sin() + 0.0003 * noise(&mut seed);
            [left, right]
        })
        .collect()
}
fn error_power(signal: &[f32], clean: &[f32], start: usize, end: usize) -> f64 {
    signal[start * 2..end * 2]
        .iter()
        .zip(&clean[start * 2..end * 2])
        .map(|(a, b)| (*a as f64 - *b as f64).powi(2))
        .sum::<f64>()
        / ((end - start) * 2) as f64
}
fn assert_outside(before: &[f32], after: &[f32], start: usize, end: usize) {
    assert_eq!(before.len(), after.len());
    for i in (0..start * 2).chain(end * 2..before.len()) {
        assert_eq!(
            before[i].to_bits(),
            after[i].to_bits(),
            "outside sample {i}"
        );
    }
    assert!(after.iter().all(|x| x.is_finite()));
}

fn quality_cases(dir: &Path) -> Vec<Value> {
    let clean = clean_signal();
    write_wav(&dir.join("reference.wav"), &clean, 2);
    let mut metrics = Vec::new();
    for name in ["click", "whistle", "phone", "cough_like_noise"] {
        let mut damaged = clean.clone();
        let (start, end, low, high) = match name {
            "click" => (24000, 24064, 0.0, 24000.0),
            "whistle" => (24000, 48000, 3000.0, 4000.0),
            "phone" => (24000, 36000, 1050.0, 1550.0),
            _ => (24000, 33600, 0.0, 24000.0),
        };
        let mut seed = 43;
        // Leave a 20 ms clean margin for spectral fades; a real selection should
        // surround the artifact, not cut it exactly at an abrupt onset/offset.
        for i in start..end {
            let t = i as f32 / SR as f32;
            let x = match name {
                "click" => 0.7 * (1.0 - ((i - start) as f32 / 64.0)),
                "whistle" if i > start + 960 && i < end - 960 => 0.35 * (TAU * 3500.0 * t).sin(),
                "phone" if i > start + 960 && i < end - 960 => {
                    0.25 * ((TAU * 1200.0 * t).sin() + (TAU * 1400.0 * t).sin())
                }
                "cough_like_noise" => {
                    0.5 * noise(&mut seed)
                        * (std::f32::consts::PI * (i - start) as f32 / (end - start) as f32)
                            .sin()
                            .powi(4)
                }
                _ => 0.0,
            };
            damaged[2 * i] += x;
            damaged[2 * i + 1] -= 0.8 * x;
        }
        let input = dir.join(format!("{name}-before.wav"));
        let output = dir.join(format!("{name}-after.wav"));
        write_wav(&input, &damaged, 2);
        let result = if name == "click" {
            declick(serde_json::from_value(json!({"input_path":input,"output_path":output,"ranges":[{"start_frame":start,"end_frame":end}]})).unwrap()).unwrap()
        } else {
            spectral_heal(serde_json::from_value(json!({"input_path":input,"output_path":output,"regions":[{"start_frame":start,"end_frame":end,"low_hz":low,"high_hz":high}]})).unwrap()).unwrap()
        };
        let healed = read_wav(&output);
        assert_outside(&damaged, &healed, start, end);
        let before = error_power(&damaged, &clean, start, end);
        let after = error_power(&healed, &clean, start, end);
        let reduction = 10.0 * (before / after.max(1e-30)).log10();
        let mut boundary_error = 0.0_f32;
        for edge in [start, end] {
            for channel in 0..2 {
                let jump = healed[edge * 2 + channel] - healed[(edge - 1) * 2 + channel];
                let clean_jump = clean[edge * 2 + channel] - clean[(edge - 1) * 2 + channel];
                boundary_error = boundary_error.max((jump - clean_jump).abs());
            }
        }
        let metric = json!({"case":name,"residualReductionDb":reduction,"beforeErrorDbFS":10.0*before.log10(),"afterErrorDbFS":10.0*after.log10(),"boundaryError":boundary_error,"outsideBitExact":true,"elapsedMs":result["elapsedMs"]});
        eprintln!("{metric}");
        assert!(
            reduction > if name == "click" { 25.0 } else { 15.0 },
            "{metric}"
        );
        assert!(boundary_error < 0.015, "{metric}");
        metrics.push(metric);
    }
    metrics
}

#[test]
fn repair_quality_and_exact_outside() {
    quality_cases(tempfile::tempdir().unwrap().path());
}

#[test]
fn spectral_heal_also_removes_a_broadband_click() {
    let dir = tempfile::tempdir().unwrap();
    let clean = clean_signal();
    let mut damaged = clean.clone();
    for sample in &mut damaged[24000 * 2..24032 * 2] {
        *sample += 0.7;
    }
    let input = dir.path().join("click.wav");
    let output = dir.path().join("healed.wav");
    write_wav(&input, &damaged, 2);
    spectral_heal(serde_json::from_value(json!({"input_path":input,"output_path":output,"regions":[{"start_frame":23000,"end_frame":25000,"low_hz":0,"high_hz":24000}]})).unwrap()).unwrap();
    let healed = read_wav(&output);
    assert_outside(&damaged, &healed, 23000, 25000);
    let gain = 10.0
        * (error_power(&damaged, &clean, 23000, 25000)
            / error_power(&healed, &clean, 23000, 25000))
        .log10();
    eprintln!("spectralClickReductionDb={gain:.3}");
    assert!(gain > 25.0);
}

#[test]
fn spectrogram_header_peak_channel_range_and_quantization() {
    let dir = tempfile::tempdir().unwrap();
    let input = dir.path().join("input.wav");
    // Exact bins, distinct channels, amplitude 0.5 => -6.0206 dBFS => 242.
    let samples: Vec<_> = (0..8192)
        .flat_map(|i| {
            [
                0.5 * (TAU * 32.0 * i as f32 / 2048.0).sin(),
                0.5 * (TAU * 64.0 * i as f32 / 2048.0).sin(),
            ]
        })
        .collect();
    write_wav(&input, &samples, 2);
    for channel in [None, Some(1)] {
        let output = dir.path().join(format!("spec{channel:?}.bin"));
        let result = spectrogram(SpectrogramRequest {
            window_size: None,
            time_pooling: false,
            input_path: input.clone(),
            output_path: output.clone(),
            fft_size: 2048,
            hop: None,
            channel,
            start_frame: Some(2048),
            end_frame: Some(4096),
        })
        .unwrap();
        let data = fs::read(output).unwrap();
        assert_eq!(&data[..8], b"HJSP\x01\x00\x40\x00");
        let u32_at = |i| u32::from_le_bytes(data[i..i + 4].try_into().unwrap());
        let u64_at = |i| u64::from_le_bytes(data[i..i + 8].try_into().unwrap());
        assert_eq!(u32_at(8), SR);
        assert_eq!(u32_at(12), if channel.is_some() { 1 } else { 2 });
        assert_eq!(u32_at(16), 2048);
        assert_eq!(u32_at(20), 512);
        assert_eq!(u64_at(24), 4);
        assert_eq!(u32_at(32), 1025);
        assert_eq!(u32_at(36), 2);
        assert_eq!(u64_at(40), 2048);
        assert_eq!(u64_at(48), 4096);
        assert_eq!(u32_at(56), channel.map_or(u32::MAX, |c| c as u32));
        assert_eq!(u32_at(60), 0);
        assert_eq!(data.len() as u64, result["bytes"].as_u64().unwrap());
        for c in 0..u32_at(12) as usize {
            for t in 0..4 {
                let row = &data[64 + (c * 4 + t) * 1025..64 + (c * 4 + t + 1) * 1025];
                let peak = row.iter().enumerate().max_by_key(|(_, v)| *v).unwrap().0;
                assert_eq!(peak, if channel == Some(1) || c == 1 { 64 } else { 32 });
                assert_eq!(row[peak], 242);
                assert!(row[peak + 8] < 20);
            }
        }
    }
}

#[test]
fn spectrogram_stride_columns_match_dense_columns() {
    // hop > fft_size samples one window per column; each column equals the dense column at the same center.
    let dir = tempfile::tempdir().unwrap();
    let input = dir.path().join("input.wav");
    let samples: Vec<_> = (0..65536)
        .map(|i| 0.5 * (TAU * (32.0 + i as f32 / 4096.0) * i as f32 / 2048.0).sin())
        .collect();
    write_wav(&input, &samples, 1);
    let run = |hop: usize, name: &str| {
        let output = dir.path().join(name);
        spectrogram(SpectrogramRequest {
            window_size: None,
            time_pooling: false,
            input_path: input.clone(),
            output_path: output.clone(),
            fft_size: 1024,
            hop: Some(hop),
            channel: None,
            start_frame: Some(4096),
            end_frame: Some(61440),
        })
        .unwrap();
        fs::read(output).unwrap()
    };
    let dense = run(256, "dense.bin");
    let stride = run(4096, "stride.bin");
    let bins = 513;
    let columns = u64::from_le_bytes(stride[24..32].try_into().unwrap()) as usize;
    assert_eq!(columns, 14);
    for t in 0..columns {
        let a = &stride[64 + t * bins..64 + (t + 1) * bins];
        let b = &dense[64 + t * 16 * bins..64 + (t * 16 + 1) * bins];
        assert_eq!(a, b, "column {t}");
    }
}

#[test]
fn spectrogram_padding_preserves_gain_and_tile_context() {
    let dir = tempfile::tempdir().unwrap();
    let input = dir.path().join("谐波.wav");
    let samples: Vec<_> = (0..32768)
        .flat_map(|i| {
            [
                0.5 * (TAU * 32.0 * i as f32 / 2048.0).sin(),
                0.25 * (TAU * 7.25 * i as f32 / 2048.0).sin(),
            ]
        })
        .collect();
    write_wav(&input, &samples, 2);
    let run = |name: &str, fft: usize, start: u64, end: u64, hop: usize, pooling: bool| {
        let output = dir.path().join(name);
        let request = serde_json::from_value(json!({
            "input_path":input,"output_path":output,"fft_size":fft,"window_size":2048,
            "hop":hop,"time_pooling":pooling,"start_frame":start,"end_frame":end
        }))
        .unwrap();
        spectrogram(request).unwrap();
        fs::read(output).unwrap()
    };
    let original = run("原始.bin", 2048, 4096, 8192, 512, false);
    let padded = run("补零.bin", 8192, 4096, 8192, 512, false);
    for c in 0..2 {
        for t in 0..8 {
            for bin in 0..1025 {
                let old = original[64 + (c * 8 + t) * 1025 + bin];
                let new = padded[64 + (c * 8 + t) * 4097 + bin * 4];
                assert!(
                    (old as i16 - new as i16).abs() <= 1,
                    "补零前后同频率幅度应相等"
                );
            }
        }
    }
    assert_eq!(padded[64 + 128], 242);
    // 分块不能重置窗上下文；低 hop、普通 hop、大 hop 均与整段逐字节相等。
    for (hop, pooling) in [(16, false), (512, false), (4096, true)] {
        let whole = run(&format!("整段-{hop}.bin"), 8192, 0, 32768, hop, pooling);
        let left = run(&format!("左块-{hop}.bin"), 8192, 0, 16384, hop, pooling);
        let right = run(&format!("右块-{hop}.bin"), 8192, 16384, 32768, hop, pooling);
        let columns = 16384 / hop;
        for c in 0..2 {
            let a = 64 + c * columns * 4097;
            let b = 64 + c * columns * 2 * 4097;
            assert_eq!(&left[a..a + columns * 4097], &whole[b..b + columns * 4097]);
            assert_eq!(
                &right[a..a + columns * 4097],
                &whole[b + columns * 4097..b + columns * 2 * 4097]
            );
        }
    }
}

#[test]
fn spectrogram_overview_keeps_click_between_sparse_windows() {
    let dir = tempfile::tempdir().unwrap();
    let input = dir.path().join("爆音.wav");
    let mut samples = vec![0.0; 32768];
    samples[10240] = 0.9;
    // 落在旧末列覆盖区之外，同时对齐 Hann 中心，单独验证尾段覆盖而非窗边衰减。
    samples[32256] = 0.9;
    write_wav(&input, &samples, 1);
    let run = |pooling: bool| {
        let output = dir.path().join(format!("{pooling}.bin"));
        let request = serde_json::from_value(json!({
            "input_path":input,"output_path":output,"fft_size":8192,"window_size":2048,
            "hop":8192,"time_pooling":pooling
        }))
        .unwrap();
        spectrogram(request).unwrap();
        fs::read(output).unwrap()
    };
    assert!(run(false)[64..].iter().all(|&v| v == 0));
    let pooled = run(true);
    assert!(pooled[64 + 4097..64 + 2 * 4097].iter().all(|&v| v >= 110));
    assert!(pooled[64 + 3 * 4097..64 + 4 * 4097].iter().all(|&v| v >= 110));
    // 可选参数缺省仍按旧协议，非法窗长必须在发布文件前失败。
    let old: SpectrogramRequest =
        serde_json::from_value(json!({"input_path":input,"output_path":"unused"})).unwrap();
    assert_eq!(old.window_size, None);
    assert!(!old.time_pooling);
    for size in [0, 1000, 4096] {
        let output = dir.path().join(format!("非法-{size}.bin"));
        let request = serde_json::from_value(
            json!({"input_path":input,"output_path":output,"fft_size":2048,"window_size":size}),
        )
        .unwrap();
        assert!(spectrogram(request).is_err());
        assert!(!output.exists());
    }
}

fn write_mask(path: &Path, width: u32, height: u32, value: impl Fn(usize, usize) -> u8) {
    let mut bytes = b"HJMK\x01\x00\x10\x00".to_vec();
    bytes.extend(width.to_le_bytes());
    bytes.extend(height.to_le_bytes());
    for y in 0..height as usize {
        for x in 0..width as usize {
            bytes.push(value(x, y));
        }
    }
    fs::write(path, bytes).unwrap();
}

#[test]
fn masks_strength_overlap_and_validation() {
    let dir = tempfile::tempdir().unwrap();
    let input = dir.path().join("input.wav");
    let clean = clean_signal();
    let mut damaged = clean.clone();
    for i in 25000..35000 {
        damaged[2 * i] += 0.4 * (TAU * 3500.0 * i as f32 / SR as f32).sin();
    }
    write_wav(&input, &damaged, 2);
    let mask = dir.path().join("mask.bin");
    // 24000..36000 => 24 columns; bins 128..170 => 43 rows.
    let region = json!({"start_frame":24000,"end_frame":36000,"low_hz":3000,"high_hz":4000,"mask_path":mask});
    let run = |tag: &str, regions: Value, strength: f32| {
        let output = dir.path().join(format!("{tag}.wav"));
        let result = spectral_heal(serde_json::from_value(json!({"input_path":input,"output_path":output,"regions":regions,"strength":strength})).unwrap());
        (result, output)
    };
    write_mask(&mask, 24, 43, |_, _| 0);
    let (_, out) = run("zero", json!([region]), 1.0);
    assert_eq!(read_wav(&out), damaged);
    write_mask(&mask, 24, 43, |_, _| 255);
    let (_, out) = run("strength0", json!([region]), 0.0);
    assert_eq!(read_wav(&out), damaged);
    let (result, full) = run("full", json!([region]), 1.0);
    result.unwrap();
    let (result, twice) = run("overlap", json!([region, region]), 1.0);
    result.unwrap();
    assert_eq!(read_wav(&full), read_wav(&twice));
    write_mask(&mask, 24, 43, |_, _| 128);
    let (result, half) = run("half", json!([region]), 1.0);
    result.unwrap();
    let full = read_wav(&full);
    let half = read_wav(&half);
    for i in 0..full.len() {
        assert!((half[i] - (damaged[i] + (full[i] - damaged[i]) * 128.0 / 255.0)).abs() < 1e-5);
    }
    write_mask(&mask, 24, 43, |x, y| {
        if (5..18).contains(&x) && (10..35).contains(&y) {
            255
        } else {
            0
        }
    });
    let (result, brush) = run("brush", json!([region]), 1.0);
    result.unwrap();
    let brush = read_wav(&brush);
    assert_outside(&damaged, &brush, 24000, 36000);
    assert!(
        error_power(&brush, &clean, 27000, 32000)
            < error_power(&damaged, &clean, 27000, 32000) * 0.1
    );
    // Read-only failures never publish an output.
    fs::write(&mask, b"bad").unwrap();
    let (result, out) = run("badmask", json!([region]), 1.0);
    assert!(result.is_err());
    assert!(!out.exists());
    let (result, out) = run("badstrength", json!([]), 1.1);
    assert!(result.is_err());
    assert!(!out.exists());
    let err = declick(serde_json::from_value(json!({"input_path":input,"output_path":dir.path().join("long.wav"),"ranges":[{"start_frame":24000,"end_frame":31000}]})).unwrap()).unwrap_err().to_string();
    assert!(err.contains("128 ms") && err.contains("6144"));
}

#[test]
fn wav_formats_and_failure_atomicity() {
    let dir = tempfile::tempdir().unwrap();
    for bits in [16, 24, 32] {
        let path = dir.path().join(format!("pcm{bits}.wav"));
        let mut writer = WavWriter::create(
            &path,
            WavSpec {
                channels: 1,
                sample_rate: SR,
                bits_per_sample: bits,
                sample_format: SampleFormat::Int,
            },
        )
        .unwrap();
        for i in 0..10000 {
            writer
                .write_sample(((i % 31 - 15) as i64 * ((1_i64 << (bits - 1)) / 32)) as i32)
                .unwrap();
        }
        writer.finalize().unwrap();
        let output = dir.path().join(format!("float{bits}.wav"));
        declick(DeclickRequest {
            input_path: path.clone(),
            output_path: output.clone(),
            ranges: vec![],
        })
        .unwrap();
        assert_eq!(read_wav(&path), read_wav(&output));
        spectrogram(SpectrogramRequest {
            window_size: None,
            time_pooling: false,
            input_path: path,
            output_path: dir.path().join(format!("pcm{bits}.bin")),
            fft_size: 256,
            hop: Some(256),
            channel: None,
            start_frame: None,
            end_frame: None,
        })
        .unwrap();
    }
    let input = dir.path().join("nan.wav");
    write_wav(&input, &[0.0, f32::NAN, 0.0], 1);
    let out = dir.path().join("failed.wav");
    assert!(declick(DeclickRequest {
        input_path: input.clone(),
        output_path: out.clone(),
        ranges: vec![]
    })
    .is_err());
    assert!(!out.exists());
    let bytes = fs::read(&input).unwrap();
    assert!(declick(DeclickRequest {
        input_path: input.clone(),
        output_path: input.clone(),
        ranges: vec![]
    })
    .is_err());
    assert_eq!(fs::read(input).unwrap(), bytes);
}

#[test]
fn protocol_defaults_errors_and_old_ping() {
    for (command, field) in [("spectral_heal", "regions"), ("declick", "ranges")] {
        let req: crate::Envelope = serde_json::from_value(json!({"version":1,"id":"contract","type":command,"input_path":"in.wav","output_path":"out.wav",field:[]})).unwrap();
        assert_eq!(req.version, 1);
    }
    let req: crate::Envelope =
        serde_json::from_value(json!({"version":1,"id":"p","type":"ping"})).unwrap();
    assert_eq!(crate::execute(req.command).unwrap()["protocolVersion"], 1);
    let req: crate::Envelope = serde_json::from_value(
        json!({"version":1,"id":"s","type":"spectrogram","input_path":"in","output_path":"out"}),
    )
    .unwrap();
    match req.command {
        crate::Command::Spectrogram(r) => {
            assert_eq!(r.fft_size, 2048);
            assert!(r.hop.is_none());
        }
        _ => panic!(),
    }
    assert!(validate_fft(1000).is_err());
    assert!(validate_fft(usize::MAX).is_err());
}

#[test]
fn dc_nyquist_silence_short_files_and_invalid_requests() {
    let dir = tempfile::tempdir().unwrap();
    for (name, bin) in [("dc", 0), ("nyquist", 128), ("silence", 256)] {
        let input = dir.path().join(format!("{name}.wav"));
        let data: Vec<_> = (0..1024)
            .map(|i| match name {
                "dc" => 0.5,
                "nyquist" => {
                    if i % 2 == 0 {
                        0.5
                    } else {
                        -0.5
                    }
                }
                _ => 0.0,
            })
            .collect();
        write_wav(&input, &data, 1);
        let output = dir.path().join(format!("{name}.bin"));
        spectrogram(SpectrogramRequest {
            window_size: None,
            time_pooling: false,
            input_path: input.clone(),
            output_path: output.clone(),
            fft_size: 256,
            hop: Some(64),
            channel: None,
            start_frame: Some(256),
            end_frame: Some(257),
        })
        .unwrap();
        let bytes = fs::read(&output).unwrap();
        assert_eq!(bytes.len(), 64 + 129);
        if bin == 256 {
            assert!(bytes[64..].iter().all(|&x| x == 0));
        } else {
            assert_eq!(bytes[64 + bin], 242);
        }
        for (fft_size, hop, channel, start, end) in [
            (100, Some(25), None, None, None),
            (256, Some(0), None, None, None),
            (256, Some((1 << 24) + 1), None, None, None),
            (256, None, Some(1), None, None),
            (256, None, None, Some(2), Some(2)),
            (256, None, None, None, Some(1025)),
        ] {
            let bad = dir.path().join("bad.bin");
            assert!(spectrogram(SpectrogramRequest {
                window_size: None,
                time_pooling: false,
                input_path: input.clone(),
                output_path: bad.clone(),
                fft_size,
                hop,
                channel,
                start_frame: start,
                end_frame: end
            })
            .is_err());
            assert!(!bad.exists());
        }
    }
    let input = dir.path().join("short.wav");
    write_wav(&input, &[0.25], 1);
    let output = dir.path().join("short.bin");
    let result = spectrogram(SpectrogramRequest {
        window_size: None,
        time_pooling: false,
        input_path: input,
        output_path: output,
        fft_size: 2048,
        hop: None,
        channel: None,
        start_frame: None,
        end_frame: None,
    })
    .unwrap();
    assert_eq!(result["frames"], 1);
}

#[test]
fn declick_maximum_duration_disjoint_ranges_and_context_failure() {
    let dir = tempfile::tempdir().unwrap();
    let input = dir.path().join("in.wav");
    let clean = clean_signal();
    let mut damaged = clean.clone();
    for (start, end) in [(10000, 10032), (30000, 36144)] {
        for sample in &mut damaged[start * 2..end * 2] {
            *sample += 0.3;
        }
    }
    write_wav(&input, &damaged, 2);
    let output = dir.path().join("out.wav");
    let ranges = vec![
        TimeRange {
            start_frame: 10000,
            end_frame: 10032,
        },
        TimeRange {
            start_frame: 30000,
            end_frame: 36144,
        },
    ];
    declick(DeclickRequest {
        input_path: input.clone(),
        output_path: output.clone(),
        ranges,
    })
    .unwrap();
    let healed = read_wav(&output);
    for i in 0..clean.len() / 2 {
        if !(10000..10032).contains(&i) && !(30000..36144).contains(&i) {
            assert_eq!(&healed[i * 2..i * 2 + 2], &damaged[i * 2..i * 2 + 2]);
        }
    }
    let gain = 10.0
        * (error_power(&damaged, &clean, 30000, 36144)
            / error_power(&healed, &clean, 30000, 36144))
        .log10();
    eprintln!("declick128msReductionDb={gain:.3}");
    assert!(gain > 20.0);
    for ranges in [
        vec![TimeRange {
            start_frame: 0,
            end_frame: 3,
        }],
        vec![
            TimeRange {
                start_frame: 5000,
                end_frame: 5100,
            },
            TimeRange {
                start_frame: 5110,
                end_frame: 5200,
            },
        ],
    ] {
        let output = dir.path().join("fail.wav");
        let error = declick(DeclickRequest {
            input_path: input.clone(),
            output_path: output.clone(),
            ranges,
        })
        .unwrap_err()
        .to_string();
        assert!(error.contains("32 clean context"));
        assert!(!output.exists());
    }
}

#[test]
fn spectral_edges_multichannel_and_region_order() {
    let dir = tempfile::tempdir().unwrap();
    let input = dir.path().join("multi.wav");
    let data: Vec<_> = (0..16000)
        .flat_map(|i| [0.2 * (TAU * 440.0 * i as f32 / SR as f32).sin(), 0.0, 0.1])
        .collect();
    write_wav(&input, &data, 3);
    let run = |name: &str, regions: Value| {
        let out = dir.path().join(format!("{name}.wav"));
        spectral_heal(
            serde_json::from_value(json!({"input_path":input,"output_path":out,"regions":regions}))
                .unwrap(),
        )
        .unwrap();
        read_wav(&out)
    };
    let a = json!({"start_frame":0,"end_frame":1024,"low_hz":3000,"high_hz":4000});
    let b = json!({"start_frame":15000,"end_frame":16000,"low_hz":3000,"high_hz":4000});
    let forward = run("ab", json!([a, b]));
    let backward = run("ba", json!([b, a]));
    assert_eq!(forward, backward);
    assert_eq!(forward.len(), data.len());
    assert_eq!(&forward[1024 * 3..15000 * 3], &data[1024 * 3..15000 * 3]);
    for &sample in forward.iter().skip(1).step_by(3) {
        assert_eq!(sample, 0.0);
    }
    let bad = dir.path().join("fail.wav");
    for (regions, sample_rate) in [
        (
            json!([{"start_frame":0,"end_frame":16000,"low_hz":0,"high_hz":24000}]),
            SR,
        ),
        (json!([a]), 44100),
        (
            json!([{"start_frame":100,"end_frame":1000,"low_hz":-1,"high_hz":10}]),
            SR,
        ),
        (
            json!([{"start_frame":100,"end_frame":1000,"low_hz":1,"high_hz":2}]),
            SR,
        ),
    ] {
        assert!(spectral_heal(serde_json::from_value(json!({"input_path":input,"output_path":bad,"regions":regions,"sample_rate":sample_rate})).unwrap()).is_err());
        assert!(!bad.exists());
    }
}

/// Reproducible benchmark (one test thread, no Electron):
/// cargo test --release --manifest-path native/audio-worker/Cargo.toml -j 4
///     benchmark -- --ignored --nocapture --test-threads=1
/// Writes audio and HJSP only beneath ignored .tmp/audio-dsp-bench/.
#[test]
#[ignore = "explicit 60-minute IO/performance benchmark"]
fn benchmark() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.tmp/audio-dsp-bench");
    fs::create_dir_all(&root).unwrap();
    // An isolated run directory avoids overwriting any previous listening files.
    let run = tempfile::Builder::new()
        .prefix("run-")
        .tempdir_in(&root)
        .unwrap()
        .keep();
    let metrics = quality_cases(&run);
    let input = run.join("60min-48k-stereo.wav");
    let output = run.join("60min-48k-stereo.hjsp");
    let generation = Instant::now();
    let mut writer = WavWriter::create(
        &input,
        WavSpec {
            channels: 2,
            sample_rate: SR,
            bits_per_sample: 16,
            sample_format: SampleFormat::Int,
        },
    )
    .unwrap();
    let second: Vec<i16> = (0..SR)
        .flat_map(|i| {
            [
                (14000.0 * (TAU * 440.0 * i as f32 / SR as f32).sin()) as i16,
                (12000.0 * (TAU * 660.0 * i as f32 / SR as f32).sin()) as i16,
            ]
        })
        .collect();
    // A buffered PCM16 writer keeps fixture creation from dominating the run.
    for _ in 0..3600 {
        let mut block = writer.get_i16_writer(second.len() as u32);
        for &x in &second {
            block.write_sample(x);
        }
        block.flush().unwrap();
    }
    writer.finalize().unwrap();
    eprintln!(
        "fixtureGenerationSeconds={:.3}",
        generation.elapsed().as_secs_f64()
    );
    let result = spectrogram(SpectrogramRequest {
        window_size: None,
        time_pooling: false,
        input_path: input,
        output_path: output,
        fft_size: 2048,
        hop: None,
        channel: None,
        start_frame: None,
        end_frame: None,
    })
    .unwrap();
    assert_eq!(result["frames"], 337500);
    assert_eq!(result["bytes"], 691875064_u64);
    println!(
        "{}",
        json!({"directory":run,"quality":metrics,"spectrogram":result})
    );
}
