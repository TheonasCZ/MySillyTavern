//! Reading and writing Character Card data embedded in PNG `tEXt`/`iTXt`
//! chunks, per PLAN.md §5.3.
//!
//! PNG layout: 8-byte signature, then a sequence of chunks
//! `length(4) | type(4) | data(length) | crc32(4)` (length and crc are
//! big-endian; crc32 covers `type + data`). We don't decode the image
//! itself — we only need to locate/insert/remove specific chunks by type
//! and (for text chunks) by keyword, so a manual chunk walk is simpler and
//! has fewer dependencies than a full PNG codec.
//!
//! Character card data lives base64-encoded in a `tEXt` chunk keyed
//! `chara` (V2) or `ccv3` (V3, preferred when both are present). Some V3
//! cards in the wild use `iTXt` instead of `tEXt` for `ccv3` — we read
//! both but always *write* `tEXt` (uncompressed, Latin-1 keyword/text, no
//! language tag) since that's what every consumer supports.

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;

const PNG_SIGNATURE: [u8; 8] = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

#[derive(Debug, thiserror::Error)]
pub enum PngCardError {
    #[error("not a valid PNG file (bad signature)")]
    BadSignature,
    #[error("truncated or malformed PNG chunk")]
    Malformed,
    #[error("no character card data found in this PNG")]
    NoCardData,
    #[error("invalid base64 in card chunk: {0}")]
    Base64(#[from] base64::DecodeError),
    #[error("card chunk is not valid UTF-8: {0}")]
    Utf8(#[from] std::string::FromUtf8Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

struct Chunk<'a> {
    kind: [u8; 4],
    data: &'a [u8],
}

/// Walks the chunks of `png`, calling `visit` with (type, data, offset of
/// the chunk's length field) for each one. Stops early if `visit` returns
/// `Some`.
fn walk_chunks<'a>(png: &'a [u8]) -> Result<Vec<(Chunk<'a>, usize)>, PngCardError> {
    if png.len() < 8 || png[0..8] != PNG_SIGNATURE {
        return Err(PngCardError::BadSignature);
    }
    let mut chunks = Vec::new();
    let mut i = 8usize;
    while i + 8 <= png.len() {
        let start = i;
        let length = u32::from_be_bytes(png[i..i + 4].try_into().unwrap()) as usize;
        let kind: [u8; 4] = png[i + 4..i + 8].try_into().unwrap();
        let data_start = i + 8;
        let data_end = data_start
            .checked_add(length)
            .ok_or(PngCardError::Malformed)?;
        if data_end + 4 > png.len() {
            return Err(PngCardError::Malformed);
        }
        let data = &png[data_start..data_end];
        chunks.push((Chunk { kind, data }, start));
        i = data_end + 4; // skip CRC
        if &kind == b"IEND" {
            break;
        }
    }
    Ok(chunks)
}

/// Decodes a `tEXt` chunk's payload into (keyword, text). `tEXt` is
/// `keyword \0 text`, both Latin-1.
fn decode_text_chunk(data: &[u8]) -> Option<(&[u8], &[u8])> {
    let nul = data.iter().position(|&b| b == 0)?;
    Some((&data[..nul], &data[nul + 1..]))
}

/// Decodes an `iTXt` chunk's payload into (keyword, text). Layout:
/// `keyword \0 compression_flag(1) compression_method(1) language_tag \0
/// translated_keyword \0 text`. We only support the uncompressed case
/// (compression_flag == 0), which is what every card exporter produces.
fn decode_itxt_chunk(data: &[u8]) -> Option<Vec<u8>> {
    let mut idx = 0usize;
    let kw_end = data[idx..].iter().position(|&b| b == 0)? + idx;
    idx = kw_end + 1;
    if idx + 2 > data.len() {
        return None;
    }
    let compression_flag = data[idx];
    idx += 2; // flag + method
    let lang_end = data[idx..].iter().position(|&b| b == 0)? + idx;
    idx = lang_end + 1;
    let tkw_end = data[idx..].iter().position(|&b| b == 0)? + idx;
    idx = tkw_end + 1;
    let text = &data[idx..];
    if compression_flag != 0 {
        // Compressed iTXt is not something we produce or expect to see in
        // practice for character cards; skip rather than fail the whole
        // read.
        return None;
    }
    Some(text.to_vec())
}

/// Reads the character card JSON (still base64-encoded at this point is
/// decoded already) embedded in `png`. Prefers a `ccv3` chunk over `chara`
/// when both are present, per the V3 spec.
pub fn read_card_json(png: &[u8]) -> Result<String, PngCardError> {
    let chunks = walk_chunks(png)?;

    let mut chara: Option<String> = None;
    let mut ccv3: Option<String> = None;

    for (chunk, _) in &chunks {
        match &chunk.kind {
            b"tEXt" => {
                if let Some((keyword, text)) = decode_text_chunk(chunk.data) {
                    let value = base64_to_json(text)?;
                    match keyword {
                        b"ccv3" => ccv3 = Some(value),
                        b"chara" => chara = Some(value),
                        _ => {}
                    }
                }
            }
            b"iTXt" => {
                // Determine keyword first (before the null-separated
                // fields) to route to the right slot.
                if let Some(nul) = chunk.data.iter().position(|&b| b == 0) {
                    let keyword = &chunk.data[..nul];
                    if keyword == b"ccv3" || keyword == b"chara" {
                        if let Some(text) = decode_itxt_chunk(chunk.data) {
                            let value = base64_to_json(&text)?;
                            if keyword == b"ccv3" {
                                ccv3 = Some(value);
                            } else {
                                chara = Some(value);
                            }
                        }
                    }
                }
            }
            _ => {}
        }
    }

    ccv3.or(chara).ok_or(PngCardError::NoCardData)
}

fn base64_to_json(text: &[u8]) -> Result<String, PngCardError> {
    let decoded = BASE64.decode(text)?;
    Ok(String::from_utf8(decoded)?)
}

/// Returns a copy of `png` with any existing `chara`/`ccv3` `tEXt`/`iTXt`
/// chunks removed and a new `tEXt` chunk (keyword `chara`, base64 of
/// `card_json`) inserted immediately before `IEND`, with CRC recomputed.
///
/// We always write the `chara` keyword (not `ccv3`) for maximum
/// compatibility with older readers that only look for `chara` — V3-aware
/// readers fall back to parsing `spec`/`spec_version` inside the JSON
/// itself, which callers are expected to set correctly in `card_json`.
pub fn write_card_json(png: &[u8], card_json: &str) -> Result<Vec<u8>, PngCardError> {
    let chunks = walk_chunks(png)?;
    if chunks.is_empty() {
        return Err(PngCardError::Malformed);
    }

    let mut out = Vec::with_capacity(png.len() + card_json.len());
    out.extend_from_slice(&PNG_SIGNATURE);

    let is_card_chunk = |kind: &[u8; 4], data: &[u8]| -> bool {
        if kind != b"tEXt" && kind != b"iTXt" {
            return false;
        }
        match data.iter().position(|&b| b == 0) {
            Some(nul) => &data[..nul] == b"chara" || &data[..nul] == b"ccv3",
            None => false,
        }
    };

    let new_chunk_data = build_text_chunk_data("chara", card_json);

    for (chunk, _) in &chunks {
        if is_card_chunk(&chunk.kind, chunk.data) {
            continue; // drop existing card chunks
        }
        if &chunk.kind == b"IEND" {
            write_chunk(&mut out, b"tEXt", &new_chunk_data);
        }
        write_chunk(&mut out, &chunk.kind, chunk.data);
    }

    Ok(out)
}

fn build_text_chunk_data(keyword: &str, text: &str) -> Vec<u8> {
    let encoded = BASE64.encode(text.as_bytes());
    let mut data = Vec::with_capacity(keyword.len() + 1 + encoded.len());
    data.extend_from_slice(keyword.as_bytes());
    data.push(0);
    data.extend_from_slice(encoded.as_bytes());
    data
}

fn write_chunk(out: &mut Vec<u8>, kind: &[u8; 4], data: &[u8]) {
    out.extend_from_slice(&(data.len() as u32).to_be_bytes());
    out.extend_from_slice(kind);
    out.extend_from_slice(data);
    let mut hasher = crc32fast::Hasher::new();
    hasher.update(kind);
    hasher.update(data);
    out.extend_from_slice(&hasher.finalize().to_be_bytes());
}

/// Builds a minimal valid 1x1 grayscale PNG with no text chunks. Used both
/// as a placeholder avatar for characters imported without one (e.g. a
/// pure-JSON card import) and as the base fixture for roundtrip tests, so
/// we don't need an image codec dependency just to construct test/default
/// PNGs.
pub fn placeholder_png() -> Vec<u8> {
    let mut out = Vec::new();
    out.extend_from_slice(&PNG_SIGNATURE);

    // IHDR: 1x1, 8-bit grayscale, no interlace.
    let mut ihdr = Vec::new();
    ihdr.extend_from_slice(&1u32.to_be_bytes()); // width
    ihdr.extend_from_slice(&1u32.to_be_bytes()); // height
    ihdr.extend_from_slice(&[8, 0, 0, 0, 0]); // bit depth, color type, compression, filter, interlace
    write_chunk(&mut out, b"IHDR", &ihdr);

    // Minimal valid zlib stream for a single 1x1 grayscale scanline
    // (filter byte 0 + one pixel byte 0x40, a mid-grey dot), deflated with
    // no compression.
    let raw = [0u8, 0x40u8];
    let idat = deflate_stored(&raw);
    write_chunk(&mut out, b"IDAT", &idat);

    write_chunk(&mut out, b"IEND", &[]);
    out
}

/// Encodes `raw` as a zlib stream using stored (uncompressed) deflate
/// blocks, avoiding a dependency on a compression crate just to build the
/// tiny placeholder/test PNGs above.
fn deflate_stored(raw: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    out.push(0x78);
    out.push(0x01); // zlib header (no dict, default compression)

    // One "stored" deflate block containing all of `raw`.
    out.push(0x01); // BFINAL=1, BTYPE=00 (stored)
    let len = raw.len() as u16;
    out.extend_from_slice(&len.to_le_bytes());
    out.extend_from_slice(&(!len).to_le_bytes());
    out.extend_from_slice(raw);

    let adler = adler32(raw);
    out.extend_from_slice(&adler.to_be_bytes());
    out
}

fn adler32(data: &[u8]) -> u32 {
    let mut a: u32 = 1;
    let mut b: u32 = 0;
    for &byte in data {
        a = (a + byte as u32) % 65521;
        b = (b + a) % 65521;
    }
    (b << 16) | a
}

#[cfg(test)]
mod tests {
    use super::*;

    fn minimal_png() -> Vec<u8> {
        placeholder_png()
    }

    #[test]
    fn roundtrip_write_then_read() {
        let png = minimal_png();
        let card_json = r#"{"spec":"chara_card_v2","spec_version":"2.0","data":{"name":"Test Char"}}"#;

        let with_card = write_card_json(&png, card_json).expect("write should succeed");
        let read_back = read_card_json(&with_card).expect("read should succeed");

        assert_eq!(read_back, card_json);
    }

    #[test]
    fn write_replaces_existing_card_chunk() {
        let png = minimal_png();
        let first = write_card_json(&png, r#"{"data":{"name":"First"}}"#).unwrap();
        let second = write_card_json(&first, r#"{"data":{"name":"Second"}}"#).unwrap();

        let read_back = read_card_json(&second).unwrap();
        assert_eq!(read_back, r#"{"data":{"name":"Second"}}"#);

        // Only one card chunk should remain (chara), no leftover ccv3/chara
        // duplicates.
        let chunks = walk_chunks(&second).unwrap();
        let text_chunk_count = chunks
            .iter()
            .filter(|(c, _)| {
                (&c.kind == b"tEXt" || &c.kind == b"iTXt")
                    && c.data.starts_with(b"chara\0")
            })
            .count();
        assert_eq!(text_chunk_count, 1);
    }

    #[test]
    fn read_missing_card_data_errors() {
        let png = minimal_png();
        let err = read_card_json(&png).unwrap_err();
        assert!(matches!(err, PngCardError::NoCardData));
    }

    #[test]
    fn read_bad_signature_errors() {
        let err = read_card_json(b"not a png").unwrap_err();
        assert!(matches!(err, PngCardError::BadSignature));
    }

    #[test]
    fn read_prefers_ccv3_over_chara() {
        let png = minimal_png();
        // Manually craft both chunks: write chara first, then insert a
        // ccv3 chunk with different content ahead of IEND.
        let with_chara = write_card_json(&png, r#"{"data":{"name":"V2 name"}}"#).unwrap();

        let chunks = walk_chunks(&with_chara).unwrap();
        let mut out = Vec::new();
        out.extend_from_slice(&PNG_SIGNATURE);
        let ccv3_data = build_text_chunk_data("ccv3", r#"{"data":{"name":"V3 name"}}"#);
        for (chunk, _) in &chunks {
            if &chunk.kind == b"IEND" {
                write_chunk(&mut out, b"tEXt", &ccv3_data);
            }
            write_chunk(&mut out, &chunk.kind, chunk.data);
        }

        let read_back = read_card_json(&out).unwrap();
        assert_eq!(read_back, r#"{"data":{"name":"V3 name"}}"#);
    }

    #[test]
    fn real_fixture_card_reads_and_roundtrips() {
        let png = std::fs::read("tests/fixtures/dungeon_master_forbidden_mage_paths.png")
            .expect("fixture PNG should be present");

        let card_json = read_card_json(&png).expect("fixture card should be readable");
        let parsed: serde_json::Value =
            serde_json::from_str(&card_json).expect("fixture card JSON should parse");

        assert_eq!(parsed["spec"], "chara_card_v3");
        let name = parsed["data"]["name"].as_str().unwrap();
        assert!(!name.is_empty());

        // Roundtrip: writing the extracted JSON back into a fresh copy of
        // the same PNG must yield back the exact same JSON string.
        let rewritten = write_card_json(&png, &card_json).expect("write should succeed");
        let read_back = read_card_json(&rewritten).expect("read after write should succeed");
        assert_eq!(read_back, card_json);
    }
}
