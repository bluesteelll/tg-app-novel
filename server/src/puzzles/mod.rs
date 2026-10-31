//! Puzzles (PUZZLES-PLAN X5-X7, META-PLAN M21): the server checks every answer against the content's solution,
//! behind a per-(user, puzzle) attempt window, and serves a hint's text only for a tier the user unlocked.

/// The length of an attempt window, in seconds (X5).
pub const ATTEMPT_WINDOW_SECS: i64 = 600;

/// The attempts a window counts with their answers applied; later ones in the window are 429 (X5: a 4-digit code
/// then takes days to brute-force).
pub const ATTEMPT_WINDOW_MAX: i64 = 20;

/// The most answer entries a request may carry, whatever the puzzle.
pub const MAX_ANSWER_LEN: usize = 16;
