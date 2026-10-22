//! Exercise the actual JSON-lines executable, not just command deserialization.
use serde_json::{json, Value};
use std::{
    io::{BufRead, Write},
    process::{Command, Stdio},
};

#[test]
fn persistent_protocol_streams_progress_cancels_and_accepts_next_request() {
    let dir = tempfile::tempdir().unwrap();
    let input = dir.path().join("stream.wav");
    let mut writer = hound::WavWriter::create(
        &input,
        hound::WavSpec {
            channels: 2,
            sample_rate: 48000,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        },
    )
    .unwrap();
    for i in 0..1500000 {
        writer.write_sample((i % 1024) as i16).unwrap();
        writer.write_sample(-(i % 1024) as i16).unwrap();
    }
    writer.finalize().unwrap();
    let mut worker = Command::new(env!("CARGO_BIN_EXE_henji-audio-worker"))
        .arg("--spectral-server")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let stdout = worker.stdout.take().unwrap();
    let (send, receive) = std::sync::mpsc::channel();
    let reader = std::thread::spawn(move || {
        for line in std::io::BufReader::new(stdout).lines() {
            send.send(serde_json::from_str::<Value>(&line.unwrap()).unwrap())
                .unwrap();
        }
    });
    let mut stdin = worker.stdin.take().unwrap();
    let output = dir.path().join("pyramid");
    writeln!(stdin,"{}",json!({"version":1,"id":"build","type":"spectral_build","input_path":input,"output_directory":output})).unwrap();
    let progress = receive
        .recv_timeout(std::time::Duration::from_secs(20))
        .unwrap();
    assert_eq!(progress["event"], "progress");
    assert_eq!(progress["progress"]["done"], false);
    writeln!(stdin,"{}",json!({"version":1,"id":"priority","type":"spectral_tile","input_path":input,"output_path":dir.path().join("priority.rg"),"level":0,"column_start":1024,"column_count":4})).unwrap();
    loop {
        let reply = receive
            .recv_timeout(std::time::Duration::from_secs(20))
            .unwrap();
        // 整文件尚在运行时即时块就能完成，不依赖先取消后台计算。
        assert!(
            !(reply["id"] == "build" && (reply["ok"] == true || reply["progress"]["done"] == true))
        );
        if reply["id"] == "priority" {
            assert_eq!(reply["ok"], true);
            break;
        }
    }
    writeln!(
        stdin,
        "{}",
        json!({"version":1,"id":"cancel","type":"cancel","request_id":"build"})
    )
    .unwrap();
    writeln!(stdin,"{}",json!({"version":1,"id":"tile","type":"spectral_tile","input_path":input,"output_path":dir.path().join("tile.rg"),"level":0,"column_start":1024,"column_count":4})).unwrap();
    writeln!(stdin, "{}", json!({"version":1,"id":"ping","type":"ping"})).unwrap();
    // 保持 stdin 打开仍须及时返回；取消后进程继续接受请求。
    let mut done = std::collections::HashMap::new();
    while done.len() < 4 {
        let reply = receive
            .recv_timeout(std::time::Duration::from_secs(20))
            .unwrap();
        if reply.get("event").is_none() {
            done.insert(reply["id"].as_str().unwrap().to_string(), reply);
        }
    }
    assert_eq!(done["build"]["ok"], false);
    assert!(done["build"]["error"].as_str().unwrap().contains("取消"));
    for id in ["tile", "ping", "cancel"] {
        assert_eq!(done[id]["ok"], true);
    }
    assert_eq!(
        std::fs::metadata(dir.path().join("tile.rg")).unwrap().len(),
        2 * 4 * 1230 * 2
    );
    drop(stdin);
    assert!(worker.wait().unwrap().success());
    reader.join().unwrap();
}

#[test]
fn json_lines_commands_preserve_protocol_and_continue_after_failure() {
    let dir = tempfile::tempdir().unwrap();
    let input = dir.path().join("input.wav");
    let mut writer = hound::WavWriter::create(
        &input,
        hound::WavSpec {
            channels: 1,
            sample_rate: 48000,
            bits_per_sample: 32,
            sample_format: hound::SampleFormat::Float,
        },
    )
    .unwrap();
    for i in 0..10000 {
        writer
            .write_sample((std::f32::consts::TAU * 440.0 * i as f32 / 48000.0).sin() * 0.2)
            .unwrap();
    }
    writer.finalize().unwrap();
    let requests = vec![
        json!({"version":1,"id":"ping","type":"ping"}),
        json!({"version":1,"id":"spec","type":"spectrogram","input_path":input,"output_path":dir.path().join("spec.bin")}),
        json!({"version":1,"id":"heal","type":"spectral_heal","input_path":input,"output_path":dir.path().join("heal.wav"),"regions":[{"start_frame":4000,"end_frame":5000,"low_hz":3000,"high_hz":4000}]}),
        json!({"version":1,"id":"click","type":"declick","input_path":input,"output_path":dir.path().join("click.wav"),"ranges":[{"start_frame":4000,"end_frame":4064}]}),
        json!({"version":1,"id":"invalid","type":"spectrogram","input_path":input,"output_path":dir.path().join("bad.bin"),"hop":0}),
        json!({"version":2,"id":"version","type":"ping"}),
        json!({"version":1,"id":"scan","type":"scan","roots":[]}),
    ];
    let mut worker = Command::new(env!("CARGO_BIN_EXE_henji-audio-worker"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let mut stdin = worker.stdin.take().unwrap();
    for request in &requests {
        writeln!(stdin, "{request}").unwrap();
    }
    drop(stdin);
    let output = worker.wait_with_output().unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let responses: Vec<Value> = String::from_utf8(output.stdout)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert_eq!(responses.len(), requests.len());
    for (index, response) in responses.iter().enumerate() {
        assert_eq!(response["version"], 1);
        assert_eq!(response["id"], requests[index]["id"]);
        assert_eq!(response["ok"], index != 4 && index != 5);
        if response["ok"] == true {
            assert!(response.get("error").is_none());
        } else {
            assert!(response.get("result").is_none());
        }
    }
    assert_eq!(responses[1]["result"]["frames"], 20);
    assert_eq!(responses[1]["result"]["bins"], 1025);
    assert_eq!(responses[2]["result"]["processedRegions"], 1);
    assert_eq!(responses[3]["result"]["processedRanges"], 1);
    assert!(!dir.path().join("bad.bin").exists());
    for name in ["heal", "click"] {
        let reader = hound::WavReader::open(dir.path().join(format!("{name}.wav"))).unwrap();
        assert_eq!(reader.duration(), 10000);
        assert_eq!(reader.spec().channels, 1);
        assert_eq!(reader.spec().sample_format, hound::SampleFormat::Float);
    }
}
