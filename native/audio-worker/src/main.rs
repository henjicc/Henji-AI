use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::error::Error;
use std::fs;
use std::io::{self, BufRead, Write};
use std::path::{Path, PathBuf};
use vst3_host::{
    audio::AudioBuffers,
    simple,
};

const PROTOCOL_VERSION: u32 = 1;

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum Command {
    Ping,
    Scan { roots: Vec<PathBuf> },
    Inspect { plugin_path: PathBuf, sample_rate: u32 },
    Process {
        plugin_path: PathBuf,
        input_path: PathBuf,
        output_path: PathBuf,
        #[serde(default)]
        parameters: HashMap<String, f64>,
        #[serde(default)]
        bypass: bool,
    },
}

#[derive(Debug, Deserialize)]
struct Envelope {
    version: u32,
    id: String,
    #[serde(flatten)]
    command: Command,
}

#[derive(Serialize)]
struct Response {
    version: u32,
    id: String,
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

fn scan_root(root: &Path, plugins: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(root) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().is_some_and(|extension| extension.eq_ignore_ascii_case("vst3")) {
            plugins.push(path);
        } else if path.is_dir() {
            scan_root(&path, plugins);
        }
    }
}

fn inspect(plugin_path: &Path, sample_rate: u32) -> Result<Value, Box<dyn Error>> {
    let plugin = simple::load_plugin_with_settings(plugin_path, sample_rate as f64, 4096)?;
    let parameters = plugin
        .get_parameters()?
        .into_iter()
        .map(|parameter| {
            let value = plugin.get_parameter(parameter.id)?;
            Ok(json!({
                "id": parameter.id,
                "name": parameter.name,
                "normalizedValue": value,
                "displayValue": plugin.format_parameter(parameter.id, value)?,
            }))
        })
        .collect::<Result<Vec<_>, vst3_host::Error>>()?;
    Ok(json!({ "info": plugin.info(), "latencyFrames": plugin.latency_samples(), "parameters": parameters }))
}

fn process(
    plugin_path: &Path,
    input_path: &Path,
    output_path: &Path,
    parameters: &HashMap<String, f64>,
    bypass: bool,
) -> Result<Value, Box<dyn Error>> {
    let mut reader = hound::WavReader::open(input_path)?;
    let spec = reader.spec();
    let sample_rate = spec.sample_rate;
    let channel_count = usize::from(spec.channels);
    if channel_count == 0 { return Err("input WAV has no channels".into()); }
    let frame_count = u64::from(reader.duration());
    let mut plugin = simple::load_plugin_with_settings(plugin_path, sample_rate as f64, 4096)?;
    if plugin.find_parameter("Global bypass").is_ok() {
        plugin.set_parameter_by_name("Global bypass", if bypass { 1.0 } else { 0.0 })?;
    }
    for (name, value) in parameters {
        plugin.set_parameter_by_name(name, *value)?;
    }
    let latency = plugin.latency_samples();
    plugin.start_processing()?;
    let output_spec = hound::WavSpec {
        channels: spec.channels,
        sample_rate,
        bits_per_sample: 32,
        sample_format: hound::SampleFormat::Float,
    };
    let mut writer = hound::WavWriter::create(output_path, output_spec)?;
    let scale = if spec.sample_format == hound::SampleFormat::Int {
        (1_u64 << spec.bits_per_sample.saturating_sub(1)) as f32
    } else { 1.0 };
    let mut samples: Box<dyn Iterator<Item = Result<f32, hound::Error>> + '_> =
        if spec.sample_format == hound::SampleFormat::Int {
            Box::new(reader.samples::<i32>().map(move |sample| sample.map(|value| value as f32 / scale)))
        } else {
            Box::new(reader.samples::<f32>())
        };
    let mut consumed_frames = 0_u64;
    let mut processed_frames = 0_u64;
    let mut written_frames = 0_u64;
    while written_frames < frame_count {
        let remaining_input = frame_count.saturating_sub(consumed_frames);
        let length = usize::try_from(remaining_input.min(4096)).unwrap_or(4096);
        let block_length = if length == 0 { usize::try_from((frame_count - written_frames).min(4096)).unwrap_or(4096) } else { length };
        let mut buffers = AudioBuffers::new(channel_count, channel_count, block_length, sample_rate as f64);
        if length > 0 {
            for frame in 0..length {
                for channel in 0..channel_count {
                    let sample = samples.next().transpose()?.ok_or("unexpected end of WAV")?;
                    buffers.inputs[channel][frame] = sample;
                }
            }
            consumed_frames += length as u64;
        }
        plugin.process_audio(&mut buffers)?;
        for frame in 0..block_length {
            let absolute = processed_frames + frame as u64;
            if absolute < latency as u64 || written_frames >= frame_count { continue; }
            for channel in 0..channel_count {
                let sample = buffers.outputs[channel][frame];
                if !sample.is_finite() { return Err("plugin returned a non-finite sample".into()); }
                writer.write_sample(sample)?;
            }
            written_frames += 1;
        }
        processed_frames += block_length as u64;
    }
    plugin.stop_processing()?;
    writer.finalize()?;
    Ok(json!({
        "inputPath": input_path,
        "outputPath": output_path,
        "sampleRate": sample_rate,
        "channels": channel_count,
        "frames": frame_count,
        "latencyFrames": latency,
        "bypass": bypass,
    }))
}

fn execute(command: Command) -> Result<Value, Box<dyn Error>> {
    match command {
        Command::Ping => Ok(json!({ "worker": "henji-audio-worker", "protocolVersion": PROTOCOL_VERSION })),
        Command::Scan { roots } => {
            let mut plugins = Vec::new();
            for root in roots { scan_root(&root, &mut plugins); }
            plugins.sort();
            plugins.dedup();
            Ok(json!({ "plugins": plugins }))
        }
        Command::Inspect { plugin_path, sample_rate } => inspect(&plugin_path, sample_rate),
        Command::Process { plugin_path, input_path, output_path, parameters, bypass } => {
            process(&plugin_path, &input_path, &output_path, &parameters, bypass)
        }
    }
}

fn main() -> Result<(), Box<dyn Error>> {
    let stdin = io::stdin();
    let mut stdout = io::BufWriter::new(io::stdout().lock());
    for line in stdin.lock().lines() {
        let line = line?;
        if line.trim().is_empty() { continue; }
        let parsed = serde_json::from_str::<Envelope>(&line);
        let response = match parsed {
            Ok(envelope) if envelope.version == PROTOCOL_VERSION => match execute(envelope.command) {
                Ok(result) => Response { version: PROTOCOL_VERSION, id: envelope.id.clone(), ok: true, result: Some(result), error: None },
                Err(error) => Response { version: PROTOCOL_VERSION, id: envelope.id.clone(), ok: false, result: None, error: Some(error.to_string()) },
            },
            Ok(envelope) => Response { version: PROTOCOL_VERSION, id: envelope.id, ok: false, result: None, error: Some("unsupported protocol version".into()) },
            Err(error) => Response { version: PROTOCOL_VERSION, id: "unknown".into(), ok: false, result: None, error: Some(error.to_string()) },
        };
        serde_json::to_writer(&mut stdout, &response)?;
        stdout.write_all(b"\n")?;
        stdout.flush()?;
    }
    Ok(())
}
