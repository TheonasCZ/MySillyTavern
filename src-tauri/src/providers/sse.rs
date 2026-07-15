//! Shared SSE (Server-Sent Events) line reader used by all provider
//! adapters. `reqwest`'s `bytes_stream()` yields arbitrary byte chunks that
//! do not respect line boundaries — a single `data: ...` line (or even a
//! multi-byte UTF-8 codepoint) can be split across two chunks. This module
//! buffers bytes and only emits complete, newline-terminated lines.

/// Accumulates raw bytes across chunk boundaries and yields complete lines
/// (without the trailing `\n`/`\r\n`) as they become available.
#[derive(Default)]
pub struct SseLineSplitter {
    buffer: Vec<u8>,
}

impl SseLineSplitter {
    pub fn new() -> Self {
        Self { buffer: Vec::new() }
    }

    /// Feed a chunk of bytes, returning any complete lines it produced
    /// (including lines completed by bytes left over from a previous call).
    pub fn push(&mut self, chunk: &[u8]) -> Vec<String> {
        self.buffer.extend_from_slice(chunk);
        let mut lines = Vec::new();
        while let Some(pos) = self.buffer.iter().position(|&b| b == b'\n') {
            let mut line_bytes: Vec<u8> = self.buffer.drain(..=pos).collect();
            line_bytes.pop(); // drop '\n'
            if line_bytes.last() == Some(&b'\r') {
                line_bytes.pop();
            }
            lines.push(String::from_utf8_lossy(&line_bytes).into_owned());
        }
        lines
    }
}

/// Extracts the payload of an SSE `data: ...` line, if this is one.
/// Handles both `data: value` and `data:value` (no space).
pub fn parse_data_line(line: &str) -> Option<&str> {
    let rest = line.strip_prefix("data:")?;
    Some(rest.strip_prefix(' ').unwrap_or(rest))
}

/// Extracts the payload of an SSE `event: ...` line, if this is one.
pub fn parse_event_line(line: &str) -> Option<&str> {
    let rest = line.strip_prefix("event:")?;
    Some(rest.strip_prefix(' ').unwrap_or(rest).trim())
}

/// Result of interpreting one provider-specific SSE `data:` payload.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParsedEvent {
    Token(String),
    Done(String),
    None,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_single_chunk_with_multiple_lines() {
        let mut splitter = SseLineSplitter::new();
        let lines = splitter.push(b"data: foo\ndata: bar\n");
        assert_eq!(lines, vec!["data: foo".to_string(), "data: bar".to_string()]);
    }

    #[test]
    fn handles_line_split_across_chunk_boundary() {
        let mut splitter = SseLineSplitter::new();
        let first = splitter.push(b"data: {\"choices\":[{\"delta\":{\"con");
        assert!(first.is_empty());
        let second = splitter.push(b"tent\":\"hi\"}}]}\n");
        assert_eq!(second, vec!["data: {\"choices\":[{\"delta\":{\"content\":\"hi\"}}]}".to_string()]);
    }

    #[test]
    fn handles_crlf_line_endings() {
        let mut splitter = SseLineSplitter::new();
        let lines = splitter.push(b"data: foo\r\ndata: bar\r\n");
        assert_eq!(lines, vec!["data: foo".to_string(), "data: bar".to_string()]);
    }

    #[test]
    fn buffers_incomplete_trailing_bytes() {
        let mut splitter = SseLineSplitter::new();
        let lines = splitter.push(b"data: partial-no-newline-yet");
        assert!(lines.is_empty());
        let lines2 = splitter.push(b"\n");
        assert_eq!(lines2, vec!["data: partial-no-newline-yet".to_string()]);
    }

    #[test]
    fn parses_data_line_with_and_without_space() {
        assert_eq!(parse_data_line("data: hello"), Some("hello"));
        assert_eq!(parse_data_line("data:hello"), Some("hello"));
        assert_eq!(parse_data_line("event: foo"), None);
    }

    #[test]
    fn parses_event_line() {
        assert_eq!(parse_event_line("event: content_block_delta"), Some("content_block_delta"));
        assert_eq!(parse_event_line("data: foo"), None);
    }
}
