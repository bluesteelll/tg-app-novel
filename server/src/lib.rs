//! The tg-app-novel server: initData auth, saves, entitlements, Stars payments and paid-content delivery.

// Also set by `[workspace.lints.rust]`; the attribute holds even for a member that forgets `[lints] workspace`.
#![forbid(unsafe_code)]

pub mod config;
pub mod error;
