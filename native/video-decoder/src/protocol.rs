//! stdio 控制通道：每条消息为 4 字节小端长度前缀 + UTF-8 JSON。
//!
//! 控制通道只传请求、响应与小体积元数据；画面走显卡共享纹理（1.2），不经过本通道。

use serde::Deserialize;
use serde_json::{json, Value};
use std::io::{self, Read, Write};

pub const PROTOCOL_VERSION: u32 = 1;
/// 单条控制消息上限。控制消息只含元数据，超过即视为协议错误，防止异常长度导致巨量分配。
pub const MAX_MESSAGE_BYTES: usize = 16 * 1024 * 1024;

#[derive(Debug, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Command {
    Hello,
    Probe { path: String },
    Cancel {
        #[serde(rename = "targetId")]
        target_id: String,
    },
    Shutdown,
}

#[derive(Debug, Deserialize)]
pub struct Request {
    pub id: String,
    #[serde(flatten)]
    pub command: Command,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ServiceError {
    pub code: &'static str,
    pub message: String,
}

impl ServiceError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self { code, message: message.into() }
    }
}

pub fn success(id: &str, result: Value) -> Value {
    json!({ "id": id, "ok": true, "result": result })
}

pub fn failure(id: &str, error: &ServiceError) -> Value {
    json!({ "id": id, "ok": false, "error": { "code": error.code, "message": error.message } })
}

/// 读取一条消息；输入流在消息边界处结束时返回 `Ok(None)`（父进程关闭 stdin，服务应退出）。
pub fn read_message(reader: &mut impl Read) -> io::Result<Option<Vec<u8>>> {
    let mut header = [0u8; 4];
    let mut filled = 0;
    while filled < header.len() {
        let read = reader.read(&mut header[filled..])?;
        if read == 0 {
            if filled == 0 {
                return Ok(None);
            }
            return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "消息长度前缀不完整"));
        }
        filled += read;
    }
    let length = u32::from_le_bytes(header) as usize;
    if length > MAX_MESSAGE_BYTES {
        return Err(io::Error::new(io::ErrorKind::InvalidData, format!("消息长度 {length} 超过上限")));
    }
    let mut body = vec![0u8; length];
    reader.read_exact(&mut body)?;
    Ok(Some(body))
}

pub fn encode_message(value: &Value) -> Vec<u8> {
    let body = serde_json::to_vec(value).expect("serde_json::Value 序列化不会失败");
    let mut frame = Vec::with_capacity(body.len() + 4);
    frame.extend_from_slice(&(body.len() as u32).to_le_bytes());
    frame.extend_from_slice(&body);
    frame
}

/// 把消息作为一个整体写出；调用方持有写锁，保证多线程响应不交错。
pub fn write_message(writer: &mut impl Write, value: &Value) -> io::Result<()> {
    writer.write_all(&encode_message(value))?;
    writer.flush()
}

pub fn parse_request(body: &[u8]) -> Result<Request, ServiceError> {
    serde_json::from_slice::<Request>(body).map_err(|error| ServiceError::new("INVALID_REQUEST", format!("无法解析请求：{error}")))
}

/// 解析失败时尽量取回请求 ID，让客户端能把错误对应到具体请求而不是等待超时。
pub fn request_id_hint(body: &[u8]) -> Option<String> {
    serde_json::from_slice::<Value>(body).ok()?.get("id")?.as_str().map(str::to_owned)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn round_trips_length_prefixed_frames() {
        let first = json!({ "id": "a", "type": "hello" });
        let second = json!({ "id": "b", "type": "probe", "path": "D:\\素材\\片头.mov" });
        let mut buffer = encode_message(&first);
        buffer.extend(encode_message(&second));
        let mut reader = Cursor::new(buffer);
        let one: Value = serde_json::from_slice(&read_message(&mut reader).unwrap().unwrap()).unwrap();
        let two: Value = serde_json::from_slice(&read_message(&mut reader).unwrap().unwrap()).unwrap();
        assert_eq!(one, first);
        assert_eq!(two, second);
        assert!(read_message(&mut reader).unwrap().is_none());
    }

    #[test]
    fn rejects_truncated_prefix_and_oversized_length() {
        let mut truncated = Cursor::new(vec![1u8, 0]);
        assert_eq!(read_message(&mut truncated).unwrap_err().kind(), io::ErrorKind::UnexpectedEof);
        let mut oversized = Cursor::new(((MAX_MESSAGE_BYTES as u32) + 1).to_le_bytes().to_vec());
        assert_eq!(read_message(&mut oversized).unwrap_err().kind(), io::ErrorKind::InvalidData);
        let mut short_body = Cursor::new([8u32.to_le_bytes().to_vec(), b"{}".to_vec()].concat());
        assert!(read_message(&mut short_body).is_err());
    }

    #[test]
    fn parses_commands() {
        let hello = parse_request(br#"{"id":"1","type":"hello"}"#).unwrap();
        assert_eq!(hello.id, "1");
        assert_eq!(hello.command, Command::Hello);
        let probe = parse_request(r#"{"id":"2","type":"probe","path":"C:\\a b\\视频.mp4"}"#.as_bytes()).unwrap();
        assert_eq!(probe.command, Command::Probe { path: "C:\\a b\\视频.mp4".into() });
        let cancel = parse_request(br#"{"id":"3","type":"cancel","targetId":"2"}"#).unwrap();
        assert_eq!(cancel.command, Command::Cancel { target_id: "2".into() });
        assert_eq!(parse_request(br#"{"id":"4","type":"shutdown"}"#).unwrap().command, Command::Shutdown);
    }

    #[test]
    fn invalid_requests_keep_id_hint() {
        let body = br#"{"id":"7","type":"explode"}"#;
        assert_eq!(parse_request(body).unwrap_err().code, "INVALID_REQUEST");
        assert_eq!(request_id_hint(body).as_deref(), Some("7"));
        assert_eq!(request_id_hint(b"not json"), None);
        assert_eq!(parse_request(br#"{"id":"8","type":"probe"}"#).unwrap_err().code, "INVALID_REQUEST");
    }

    #[test]
    fn response_shapes() {
        assert_eq!(success("1", json!({ "x": 1 })), json!({ "id": "1", "ok": true, "result": { "x": 1 } }));
        let error = ServiceError::new("CANCELLED", "已取消");
        assert_eq!(failure("2", &error), json!({ "id": "2", "ok": false, "error": { "code": "CANCELLED", "message": "已取消" } }));
    }
}
