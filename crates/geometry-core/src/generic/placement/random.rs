//! Deterministic generators the scatter derives per triangle: Bob Jenkins lookup3 `hashword`
//! (initval 13) and the POSIX drand48 family 48-bit LCG.

/// lookup3 `hashword` of two 32-bit words with initval 13: the seed Distribute Points on Faces
/// derives per triangle.
pub fn hash_pair(first: u32, second: u32) -> u32 {
    let init = 0xdead_beefu32.wrapping_add(2 << 2).wrapping_add(13);
    let (mut a, mut b, mut c) = (init, init, init);
    a = a.wrapping_add(first);
    b = b.wrapping_add(second);
    c = (c ^ b).wrapping_sub(b.rotate_left(14));
    a = (a ^ c).wrapping_sub(c.rotate_left(11));
    b = (b ^ a).wrapping_sub(a.rotate_left(25));
    c = (c ^ b).wrapping_sub(b.rotate_left(16));
    a = (a ^ c).wrapping_sub(c.rotate_left(4));
    b = (b ^ a).wrapping_sub(a.rotate_left(14));
    c = (c ^ b).wrapping_sub(b.rotate_left(24));
    c
}

const MASK_48: u64 = (1 << 48) - 1;

/// srand48 seeding; each draw is the top 31 bits scaled to [0, 1) (lrand48() / 2^31, not drand48's
/// full 48-bit fraction), as the scatter uses it.
pub struct Drand48 {
    x: u64,
}

impl Drand48 {
    pub fn new(seed: u32) -> Self {
        Self { x: (u64::from(seed) << 16) | 0x330e }
    }

    #[allow(clippy::should_implement_trait)]
    pub fn next(&mut self) -> f64 {
        self.x = 0x5_deec_e66d_u64.wrapping_mul(self.x).wrapping_add(0xb) & MASK_48;
        (self.x >> 17) as f64 / 2_147_483_648.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn draws_stay_in_the_unit_interval_and_repeat_per_seed() {
        let mut a = Drand48::new(hash_pair(7, 0));
        let mut b = Drand48::new(hash_pair(7, 0));
        for _ in 0..50 {
            let x = a.next();
            assert!((0.0..1.0).contains(&x));
            assert_eq!(x, b.next());
        }
        assert_ne!(hash_pair(1, 0), hash_pair(2, 0));
    }
}
