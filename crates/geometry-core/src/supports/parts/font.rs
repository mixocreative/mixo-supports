//! Label font data: Inter Regular glyph outlines, triangulated, exported by tools/fonts/export_label_font.py
//! (Inter, Copyright (c) 2016 The Inter Project Authors, SIL Open Font License 1.1). The one data
//! file lives in this crate (`labelFont.json`, written by tools/fonts/export_label_font.py), embedded at build time.

use std::collections::HashMap;
use std::sync::OnceLock;

const FONT_JSON: &str = include_str!("labelFont.json");

pub struct Glyph {
    pub advance: f64,
    pub vertices: Vec<[f64; 2]>,
    pub triangles: Vec<[u32; 3]>,
}

pub struct Font {
    pub cap_height: f64,
    pub glyphs: HashMap<char, Glyph>,
}

/// The font, parsed on first use.
pub fn font() -> &'static Font {
    static FONT: OnceLock<Font> = OnceLock::new();
    FONT.get_or_init(|| parse(FONT_JSON).expect("labelFont.json is valid"))
}

enum Value {
    Num(f64),
    Arr(Vec<Value>),
    Obj(Vec<(String, Value)>),
    Other,
}

struct Reader<'a> {
    text: &'a [u8],
    at: usize,
}

impl Reader<'_> {
    fn skip(&mut self) {
        while self.at < self.text.len() && self.text[self.at].is_ascii_whitespace() {
            self.at += 1;
        }
    }
    fn string(&mut self) -> Option<String> {
        self.at += 1;
        let start = self.at;
        while *self.text.get(self.at)? != b'"' {
            self.at += if self.text[self.at] == b'\\' { 2 } else { 1 };
        }
        let s = String::from_utf8_lossy(&self.text[start..self.at]).into_owned();
        self.at += 1;
        Some(s)
    }
    fn value(&mut self) -> Option<Value> {
        self.skip();
        match *self.text.get(self.at)? {
            b'{' => {
                self.at += 1;
                let mut items = Vec::new();
                loop {
                    self.skip();
                    if self.text[self.at] == b'}' {
                        self.at += 1;
                        return Some(Value::Obj(items));
                    }
                    if self.text[self.at] == b',' {
                        self.at += 1;
                        continue;
                    }
                    let key = self.string()?;
                    self.skip();
                    self.at += 1; // ':'
                    items.push((key, self.value()?));
                }
            }
            b'[' => {
                self.at += 1;
                let mut items = Vec::new();
                loop {
                    self.skip();
                    if self.text[self.at] == b']' {
                        self.at += 1;
                        return Some(Value::Arr(items));
                    }
                    if self.text[self.at] == b',' {
                        self.at += 1;
                        continue;
                    }
                    items.push(self.value()?);
                }
            }
            b'"' => {
                self.string()?;
                Some(Value::Other)
            }
            _ => {
                let start = self.at;
                while self.at < self.text.len() && !matches!(self.text[self.at], b',' | b']' | b'}') && !self.text[self.at].is_ascii_whitespace() {
                    self.at += 1;
                }
                Some(std::str::from_utf8(&self.text[start..self.at]).ok()?.parse().map_or(Value::Other, Value::Num))
            }
        }
    }
}

fn number(value: &Value) -> Option<f64> {
    if let Value::Num(n) = value { Some(*n) } else { None }
}

fn field<'a>(value: &'a Value, name: &str) -> Option<&'a Value> {
    if let Value::Obj(items) = value { items.iter().find(|(k, _)| k == name).map(|(_, v)| v) } else { None }
}

fn parse(text: &str) -> Option<Font> {
    let root = Reader { text: text.as_bytes(), at: 0 }.value()?;
    let cap_height = number(field(&root, "capHeight")?)?;
    let Value::Obj(entries) = field(&root, "glyphs")? else { return None };
    let mut glyphs = HashMap::new();
    for (name, glyph) in entries {
        let Value::Arr(vertices) = field(glyph, "vertices")? else { return None };
        let Value::Arr(triangles) = field(glyph, "triangles")? else { return None };
        let pair = |v: &Value| -> Option<[f64; 2]> {
            let Value::Arr(a) = v else { return None };
            Some([number(a.first()?)?, number(a.get(1)?)?])
        };
        let triple = |v: &Value| -> Option<[u32; 3]> {
            let Value::Arr(a) = v else { return None };
            Some([number(a.first()?)? as u32, number(a.get(1)?)? as u32, number(a.get(2)?)? as u32])
        };
        glyphs.insert(
            name.chars().next()?,
            Glyph {
                advance: number(field(glyph, "advance")?)?,
                vertices: vertices.iter().map(pair).collect::<Option<_>>()?,
                triangles: triangles.iter().map(triple).collect::<Option<_>>()?,
            },
        );
    }
    Some(Font { cap_height, glyphs })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn font_has_letters_digits_and_the_dash() {
        let f = font();
        for c in "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-".chars() {
            assert!(f.glyphs.get(&c).is_some_and(|g| !g.triangles.is_empty() && g.advance > 0.0), "glyph {c}");
        }
        assert!((f.cap_height - 0.50871).abs() < 1e-9);
    }
}
