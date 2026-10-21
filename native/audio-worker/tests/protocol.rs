//! Exercise the actual JSON-lines executable, not just command deserialization.
use serde_json::{json, Value};
use std::{
    io::Write,
    process::{Command, Stdio},
};

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
