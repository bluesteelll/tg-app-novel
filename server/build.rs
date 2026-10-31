//! Reruns the build when `migrations/` changes. `sqlx::migrate!` embeds each migration file it finds at compile
//! time, but cargo tracks only those files: without this, an incremental build misses a NEW migration and the server
//! starts with the old set (sqlx's documented build script).

fn main() {
    println!("cargo:rerun-if-changed=migrations");
}
