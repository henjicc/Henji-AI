//! FFmpeg 库版本、许可与已启用解码器信息（hello 握手内容）。

use serde_json::{json, Value};
use std::ffi::{c_void, CStr};
use std::ptr;

use ffmpeg_sys_next as ff;

/// 1.1 验收要求必须存在的解码器；缺失时握手仍成功，但列入 missingRequiredDecoders 由主进程记录。
pub const REQUIRED_DECODERS: &[&str] = &["h264", "hevc", "av1", "libdav1d", "vp9", "prores", "dnxhd", "cfhd", "mpeg2video"];

pub(crate) fn c_text(pointer: *const std::ffi::c_char) -> Option<String> {
    if pointer.is_null() {
        None
    } else {
        Some(unsafe { CStr::from_ptr(pointer) }.to_string_lossy().into_owned())
    }
}

fn split_version(version: u32) -> String {
    format!("{}.{}.{}", version >> 16, (version >> 8) & 0xff, version & 0xff)
}

#[derive(Debug, Clone)]
pub struct DecoderEntry {
    pub name: String,
    pub media: &'static str,
}

pub fn decoders() -> Vec<DecoderEntry> {
    let mut opaque: *mut c_void = ptr::null_mut();
    let mut entries = Vec::new();
    loop {
        let codec = unsafe { ff::av_codec_iterate(&mut opaque) };
        if codec.is_null() {
            break;
        }
        if unsafe { ff::av_codec_is_decoder(codec) } == 0 {
            continue;
        }
        let codec = unsafe { &*codec };
        let media = match codec.type_ {
            ff::AVMediaType::AVMEDIA_TYPE_VIDEO => "video",
            ff::AVMediaType::AVMEDIA_TYPE_AUDIO => "audio",
            _ => continue,
        };
        if let Some(name) = c_text(codec.name) {
            entries.push(DecoderEntry { name, media });
        }
    }
    entries.sort_by(|a, b| a.name.cmp(&b.name));
    entries
}

pub fn hw_device_types() -> Vec<String> {
    let mut types = Vec::new();
    let mut current = ff::AVHWDeviceType::AV_HWDEVICE_TYPE_NONE;
    loop {
        current = unsafe { ff::av_hwdevice_iterate_types(current) };
        if current == ff::AVHWDeviceType::AV_HWDEVICE_TYPE_NONE {
            break;
        }
        if let Some(name) = c_text(unsafe { ff::av_hwdevice_get_type_name(current) }) {
            types.push(name);
        }
    }
    types
}

pub fn missing_required(decoders: &[DecoderEntry]) -> Vec<&'static str> {
    REQUIRED_DECODERS.iter().copied().filter(|required| !decoders.iter().any(|entry| entry.name == *required)).collect()
}

pub fn ffmpeg_info() -> Value {
    let decoders = decoders();
    let video: Vec<&str> = decoders.iter().filter(|entry| entry.media == "video").map(|entry| entry.name.as_str()).collect();
    let audio: Vec<&str> = decoders.iter().filter(|entry| entry.media == "audio").map(|entry| entry.name.as_str()).collect();
    let configuration = c_text(unsafe { ff::avcodec_configuration() }).unwrap_or_default();
    json!({
        "version": c_text(unsafe { ff::av_version_info() }),
        "libavcodec": split_version(unsafe { ff::avcodec_version() }),
        "libavformat": split_version(unsafe { ff::avformat_version() }),
        "libavutil": split_version(unsafe { ff::avutil_version() }),
        "license": c_text(unsafe { ff::avcodec_license() }),
        "gplEnabled": configuration.contains("--enable-gpl"),
        "nonfreeEnabled": configuration.contains("--enable-nonfree"),
        "videoDecoders": video,
        "audioDecoders": audio,
        "requiredDecoders": REQUIRED_DECODERS,
        "missingRequiredDecoders": missing_required(&decoders),
        "hwDeviceTypes": hw_device_types(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_triplet_matches_ffmpeg_encoding() {
        assert_eq!(split_version((62 << 16) | (11 << 8) | 100), "62.11.100");
    }

    #[test]
    fn linked_build_is_lgpl_and_has_required_decoders() {
        let decoders = decoders();
        assert!(decoders.len() > 100, "解码器数量异常：{}", decoders.len());
        assert!(missing_required(&decoders).is_empty(), "缺少解码器：{:?}", missing_required(&decoders));
        let info = ffmpeg_info();
        assert_eq!(info["gplEnabled"], json!(false));
        assert_eq!(info["nonfreeEnabled"], json!(false));
        assert!(info["license"].as_str().unwrap_or_default().contains("LGPL"));
        assert!(info["hwDeviceTypes"].as_array().unwrap().iter().any(|value| value == "d3d11va"));
    }
}
