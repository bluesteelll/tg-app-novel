//! The client's HTTP contract `client/src/api/generated/api.ts` is exactly `ts_bindings()` of the Rust DTOs (K22).

use std::path::{Path, PathBuf};

use server::api::dto::ts_bindings;

/// `client/src/api/generated/api.ts`, found from the server crate.
fn bindings_path() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../client/src/api/generated/api.ts")
}

/// The committed file equals the generated text byte for byte: a DTO changed without regenerating is red here.
#[test]
#[allow(
    clippy::disallowed_methods,
    reason = "a sync test may read files; the lint guards async handlers"
)]
fn bindings_are_fresh() {
    let path = bindings_path();
    let want = ts_bindings();
    // The generated header line names the regenerate command.
    let regenerate = want.lines().next().unwrap_or_default();
    let got = match std::fs::read_to_string(&path) {
        Ok(text) => text,
        Err(e) => panic!("cannot read {}: {e}\n{regenerate}", path.display()),
    };
    if got != want {
        let got_lines: Vec<&str> = got.split('\n').collect();
        let want_lines: Vec<&str> = want.split('\n').collect();
        let len = got_lines.len().max(want_lines.len());
        let at = (0..len)
            .find(|&i| got_lines.get(i) != want_lines.get(i))
            .unwrap_or(len);
        // The declaration the difference falls in, and the generated text from there (a new field shows in it).
        let decl = want_lines
            .iter()
            .take(at + 1)
            .rev()
            .find_map(|line| line.strip_prefix("export type "))
            .and_then(|rest| rest.split(' ').next())
            .unwrap_or("the header");
        let next: Vec<&str> = want_lines.iter().skip(at).take(6).copied().collect();
        panic!(
            "{} is stale in {decl}; first difference at line {}:\n  file:      {:?}\n  generated: {:?}\n  \
             generated from there: {next:?}\n{regenerate}",
            path.display(),
            at + 1,
            got_lines.get(at),
            want_lines.get(at)
        );
    }
}

/// No declaration says `bigint`: every `i64` carries `#[ts(type = "number")]`, which `bindings_are_fresh` cannot see
/// (a regenerated file would hold the `bigint` too).
#[test]
fn bindings_have_no_bigint() {
    let bindings = ts_bindings();
    let offending: Vec<String> = bindings
        .lines()
        .enumerate()
        .filter(|(_, line)| line.contains("bigint"))
        .map(|(i, line)| format!("line {}: {line}", i + 1))
        .collect();
    assert!(
        offending.is_empty(),
        "{} generated lines say bigint (an i64 without #[ts(type = \"number\")]):\n{}",
        offending.len(),
        offending.join("\n")
    );
}

/// Rewrites the generated file: `cargo test -p server --test it bindings::write_bindings -- --ignored --exact`.
#[test]
#[ignore = "writes client/src/api/generated/api.ts; run by hand after a DTO change"]
fn write_bindings() {
    let path = bindings_path();
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, ts_bindings()).unwrap();
}
