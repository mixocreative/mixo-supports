use crate::mesh::MeshError;
use crate::weld::{VertexAccumulator, WeldedMesh};

#[derive(Debug, PartialEq, Eq)]
pub enum StlError {
    Format,
    Empty,
    NonFinite,
    Capacity,
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
    use super::{BinaryStlStream, StlError};

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
