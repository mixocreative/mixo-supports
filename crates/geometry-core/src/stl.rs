use crate::mesh::MeshError;
use crate::weld::{VertexAccumulator, WeldedMesh};

#[derive(Debug, PartialEq, Eq)]
pub enum StlError {
    Format,
    Empty,
    NonFinite,
    Capacity,
}

/// Streams the ASCII STL vertex records into a first-seen welded mesh.
/// ASCII token scanning stays here with the Z-up to Y-up coordinate change.
pub struct AsciiStlStream {
    pending: Vec<u8>,
    welder: VertexAccumulator,
    indices: Vec<u32>,
    rotation: [f64; 16],
}

impl AsciiStlStream {
    pub fn new(file_size: usize) -> Result<Self, StlError> {
        let c = (-std::f64::consts::FRAC_PI_2).cos();
        let s = (-std::f64::consts::FRAC_PI_2).sin();
        Ok(Self {
            pending: Vec::new(),
            welder: VertexAccumulator::new((file_size / 500).min(2048)).map_err(map_mesh_error)?,
            indices: Vec::new(),
            rotation: [1., 0., 0., 0., 0., c, s, 0., 0., -s, c, 0., 0., 0., 0., 1.],
        })
    }

    pub fn push(&mut self, chunk: &[u8]) -> Result<(), StlError> {
        self.pending.extend_from_slice(chunk);
        if let Some(last_newline) = self.pending.iter().rposition(|&byte| byte == b'\n') {
            let tail = self.pending.split_off(last_newline + 1);
            let block = std::mem::replace(&mut self.pending, tail);
            self.process_block(&block)?;
        }
        Ok(())
    }

    pub fn finish(mut self) -> Result<WeldedMesh, StlError> {
        let block = std::mem::take(&mut self.pending);
        self.process_block(&block)?;
        if self.indices.is_empty() {
            return Err(StlError::Empty);
        }
        if self.indices.len() % 3 != 0 {
            return Err(StlError::Format);
        }
        Ok(WeldedMesh {
            positions: self.welder.finish(),
            indices: self.indices,
        })
    }

    fn process_block(&mut self, bytes: &[u8]) -> Result<(), StlError> {
        let line = String::from_utf8_lossy(bytes);
        // Keywords are case-insensitive (owner: every STL must load); ASCII lowercasing keeps byte offsets.
        let lower = line.to_ascii_lowercase();
        let mut search = 0;
        while let Some(found) = lower[search..].find("vertex") {
            let mut at = search + found + "vertex".len();
            let mut values = [0.0; 3];
            let mut complete = true;
            for value in &mut values {
                if let Some((number, next)) = ascii_number_after_space(&line, at) {
                    *value = number;
                    at = next;
                } else {
                    complete = false;
                    break;
                }
            }
            if complete {
                self.vertex(values)?;
                search = at;
            } else {
                search += found + "vertex".len();
            }
        }
        Ok(())
    }

    fn vertex(&mut self, values: [f64; 3]) -> Result<(), StlError> {
        // STLLoader stores ASCII positions in f32 before applying its rotation.
        let raw = values.map(|value| f64::from(value as f32));
        let m = &self.rotation;
        let w = 1.0 / (m[3] * raw[0] + m[7] * raw[1] + m[11] * raw[2] + m[15]);
        let point = [
            ((m[0] * raw[0] + m[4] * raw[1] + m[8] * raw[2] + m[12]) * w) as f32,
            ((m[1] * raw[0] + m[5] * raw[1] + m[9] * raw[2] + m[13]) * w) as f32,
            ((m[2] * raw[0] + m[6] * raw[1] + m[10] * raw[2] + m[14]) * w) as f32,
        ];
        if point.iter().any(|coordinate| !coordinate.is_finite()) {
            return Err(StlError::NonFinite);
        }
        self.indices
            .push(self.welder.add(&point).map_err(map_mesh_error)?);
        Ok(())
    }
}

/// The characters of a JavaScript regex `\s` (what the TS oracle and STLLoader accept between
/// tokens): ASCII whitespace including vertical tab, NBSP, the Unicode space separators, line and
/// paragraph separators and the byte order mark. Not U+0085, which `char::is_whitespace` includes.
fn is_js_whitespace(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{b}' | '\u{c}' | '\r' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'..='\u{200a}'
            | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}'
    )
}

fn ascii_number_after_space(line: &str, start: usize) -> Option<(f64, usize)> {
    let bytes = line.as_bytes();
    let mut at = start;
    for (offset, c) in line[start..].char_indices() {
        if !is_js_whitespace(c) {
            break;
        }
        at = start + offset + c.len_utf8();
    }
    if at == start {
        return None;
    }
    let number_start = at;
    if at < bytes.len() && (bytes[at] == b'+' || bytes[at] == b'-') {
        at += 1;
    }
    while at < bytes.len() && bytes[at].is_ascii_digit() {
        at += 1;
    }
    if at < bytes.len() && bytes[at] == b'.' {
        at += 1;
        while at < bytes.len() && bytes[at].is_ascii_digit() {
            at += 1;
        }
    }
    if at < bytes.len() && (bytes[at] == b'e' || bytes[at] == b'E') {
        let mut exponent = at + 1;
        if exponent < bytes.len() && (bytes[exponent] == b'+' || bytes[exponent] == b'-') {
            exponent += 1;
        }
        let digits = exponent;
        while exponent < bytes.len() && bytes[exponent].is_ascii_digit() {
            exponent += 1;
        }
        if exponent > digits {
            at = exponent;
        }
    }
    let value = line[number_start..at].parse::<f64>().unwrap_or(f64::NAN);
    Some((value, at))
}

pub struct BinaryStlStream {
    total_corners: usize,
    corners: usize,
    header_remaining: usize,
    record: [u8; 50],
    record_len: usize,
    welder: VertexAccumulator,
    indices: Vec<u32>,
    rotation: [f64; 16],
}

impl BinaryStlStream {
    pub fn new(triangles: u32) -> Result<Self, StlError> {
        let total_corners = (triangles as usize)
            .checked_mul(3)
            .ok_or(StlError::Capacity)?;
        let c = (-std::f64::consts::FRAC_PI_2).cos();
        let s = (-std::f64::consts::FRAC_PI_2).sin();
        Ok(Self {
            total_corners,
            corners: 0,
            header_remaining: 84,
            record: [0; 50],
            record_len: 0,
            welder: VertexAccumulator::new(total_corners.min(2048)).map_err(map_mesh_error)?,
            indices: Vec::with_capacity(total_corners.min(4096)),
            rotation: [1., 0., 0., 0., 0., c, s, 0., 0., -s, c, 0., 0., 0., 0., 1.],
        })
    }

    pub fn push(&mut self, chunk: &[u8]) -> Result<(), StlError> {
        let skipped = self.header_remaining.min(chunk.len());
        self.header_remaining -= skipped;
        let mut bytes = &chunk[skipped..];
        while self.corners < self.total_corners && !bytes.is_empty() {
            if self.record_len > 0 || bytes.len() < 50 {
                let take = (50 - self.record_len).min(bytes.len());
                self.record[self.record_len..self.record_len + take]
                    .copy_from_slice(&bytes[..take]);
                self.record_len += take;
                bytes = &bytes[take..];
                if self.record_len < 50 {
                    break;
                }
                let record = self.record;
                self.process_record(&record)?;
                self.record_len = 0;
            } else {
                self.process_record(&bytes[..50])?;
                bytes = &bytes[50..];
            }
        }
        Ok(())
    }

    pub fn finish(self) -> Result<WeldedMesh, StlError> {
        if self.corners < self.total_corners {
            return Err(StlError::Format);
        }
        if self.total_corners == 0 {
            return Err(StlError::Empty);
        }
        Ok(WeldedMesh {
            positions: self.welder.finish(),
            indices: self.indices,
        })
    }

    fn process_record(&mut self, bytes: &[u8]) -> Result<(), StlError> {
        for vertex in 0..3 {
            let at = 12 + vertex * 12;
            let raw = [0, 4, 8].map(|axis| {
                f64::from(f32::from_le_bytes(
                    bytes[at + axis..at + axis + 4].try_into().unwrap(),
                ))
            });
            let m = &self.rotation;
            let w = 1.0 / (m[3] * raw[0] + m[7] * raw[1] + m[11] * raw[2] + m[15]);
            let point = [
                ((m[0] * raw[0] + m[4] * raw[1] + m[8] * raw[2] + m[12]) * w) as f32,
                ((m[1] * raw[0] + m[5] * raw[1] + m[9] * raw[2] + m[13]) * w) as f32,
                ((m[2] * raw[0] + m[6] * raw[1] + m[10] * raw[2] + m[14]) * w) as f32,
            ];
            if point.iter().any(|coordinate| !coordinate.is_finite()) {
                return Err(StlError::NonFinite);
            }
            self.indices
                .push(self.welder.add(&point).map_err(map_mesh_error)?);
            self.corners += 1;
        }
        Ok(())
    }
}

fn map_mesh_error(error: MeshError) -> StlError {
    match error {
        MeshError::NonFinite => StlError::NonFinite,
        MeshError::Capacity => StlError::Capacity,
        _ => StlError::Format,
    }
}

#[cfg(test)]
mod tests {
    use super::{AsciiStlStream, BinaryStlStream, StlError};

    #[test]
    fn ascii_stream_welds_split_vertices_and_rotates_to_y_up() {
        let file = b"solid aligner\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 0 1\nendloop\nendfacet\nendsolid\n";
        let mut stream = AsciiStlStream::new(file.len()).unwrap();
        for chunk in file.chunks(7) {
            stream.push(chunk).unwrap();
        }
        let mesh = stream.finish().unwrap();
        assert_eq!(mesh.indices, [0, 1, 2]);
        assert_eq!(&mesh.positions[..6], &[0., 0., 0., 1., 0., 0.]);
        assert!((mesh.positions[7] - 1.).abs() < 1e-6);
    }

    #[test]
    fn ascii_stream_rejects_empty_incomplete_and_nonfinite_vertices() {
        let mut empty = AsciiStlStream::new(20).unwrap();
        empty.push(b"solid x\nendsolid x\n").unwrap();
        assert!(matches!(empty.finish(), Err(StlError::Empty)));

        let mut short = AsciiStlStream::new(64).unwrap();
        short.push(b"solid x\nvertex 0 0 0\nvertex 1 0 0").unwrap();
        assert!(matches!(short.finish(), Err(StlError::Format)));

        let mut invalid = AsciiStlStream::new(64).unwrap();
        assert!(matches!(
            invalid.push(b"solid x\nvertex 1e999 0 0\n"),
            Err(StlError::NonFinite)
        ));
    }

    #[test]
    fn ascii_stream_accepts_unicode_and_vertical_tab_whitespace_like_javascript() {
        let mut stream = AsciiStlStream::new(0).unwrap();
        let text = "solid x\nvertex\u{a0}0\u{2003}0\u{3000}0\nvertex\u{b}1 0 0\nvertex 0 0 1\n";
        stream.push(text.as_bytes()).unwrap();
        assert_eq!(stream.finish().unwrap().indices, [0, 1, 2]);
    }

    #[test]
    fn ascii_stream_accepts_vertex_coordinates_across_lines_in_one_chunk() {
        let file = b"solid x\nvertex 0\n 0 0\nvertex 1 0 0\nvertex 0 0 1\n";
        let mut stream = AsciiStlStream::new(file.len()).unwrap();
        stream.push(file).unwrap();
        assert_eq!(stream.finish().unwrap().indices, [0, 1, 2]);
    }

    #[test]
    fn ascii_keywords_are_case_insensitive() {
        let mut stream = AsciiStlStream::new(100).unwrap();
        stream.push(b"SOLID X
FACET NORMAL 0 0 1
OUTER LOOP
VERTEX 0 0 0
Vertex 1 0 0
vertex 0 0 1
ENDLOOP
ENDFACET
ENDSOLID X
").unwrap();
        assert_eq!(stream.finish().unwrap().indices.len(), 3);
    }

    fn one_triangle() -> Vec<u8> {
        let mut file = vec![0; 84 + 50];
        file[80..84].copy_from_slice(&1_u32.to_le_bytes());
        for (index, value) in [0., 0., 0., 1., 0., 0., 0., 0., 1.].into_iter().enumerate() {
            file[84 + 12 + index * 4..84 + 16 + index * 4]
                .copy_from_slice(&f32::to_le_bytes(value));
        }
        file
    }

    #[test]
    fn parses_split_records_and_rotates_to_y_up() {
        let file = one_triangle();
        let mut stream = BinaryStlStream::new(1).unwrap();
        for chunk in file.chunks(17) {
            stream.push(chunk).unwrap();
        }
        let mesh = stream.finish().unwrap();
        assert_eq!(mesh.indices, [0, 1, 2]);
        assert_eq!(mesh.positions[0..6], [0., 0., 0., 1., 0., 0.]);
        assert!((mesh.positions[7] - 1.).abs() < 1e-6);
    }

    #[test]
    fn rejects_truncated_empty_and_nonfinite_records() {
        let file = one_triangle();
        let mut short = BinaryStlStream::new(1).unwrap();
        short.push(&file[..file.len() - 1]).unwrap();
        assert!(matches!(short.finish(), Err(StlError::Format)));
        let mut empty = BinaryStlStream::new(0).unwrap();
        empty.push(&file[..84]).unwrap();
        assert!(matches!(empty.finish(), Err(StlError::Empty)));
        let mut bad = file;
        bad[96..100].copy_from_slice(&f32::NAN.to_le_bytes());
        let mut stream = BinaryStlStream::new(1).unwrap();
        assert!(matches!(stream.push(&bad), Err(StlError::NonFinite)));
    }

    #[test]
    fn ignores_padding_after_the_declared_triangle_count() {
        let mut file = one_triangle();
        file.extend_from_slice(&[9; 13]);
        let mut stream = BinaryStlStream::new(1).unwrap();
        stream.push(&file).unwrap();
        assert_eq!(stream.finish().unwrap().indices, [0, 1, 2]);
    }
}
