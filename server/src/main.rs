//! The `server` binary: `server serve` (the default) runs the HTTP server. L9 adds `server setup`.

#![forbid(unsafe_code)]

use std::process::ExitCode;

use server::config::Config;
use server::{AppState, build_router};
use tokio::net::TcpListener;
use tracing::{error, info};
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> ExitCode {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    tracing_subscriber::fmt().with_env_filter(filter).init();

    match std::env::args().nth(1).as_deref() {
        None | Some("serve") => serve().await,
        Some(other) => {
            error!(command = other, "unknown command; usage: server [serve]");
            ExitCode::FAILURE
        }
    }
}

async fn serve() -> ExitCode {
    let cfg = match Config::from_env() {
        Ok(cfg) => cfg,
        Err(e) => {
            error!("{e}");
            return ExitCode::FAILURE;
        }
    };
    // A relative DATABASE_PATH resolves against the working directory; the absolute path in the log shows which
    // file a start from the wrong directory created.
    let database =
        std::path::absolute(&cfg.database_path).unwrap_or_else(|_| cfg.database_path.clone());
    info!(database = %database.display(), "opening database");
    let listen_addr = cfg.listen_addr;
    let state = match AppState::new(cfg).await {
        Ok(state) => state,
        Err(e) => {
            error!("startup failed: {e}");
            return ExitCode::FAILURE;
        }
    };
    let repo = state.repo.clone();
    let result = run(listen_addr, state).await;
    // The pool lives until the server has stopped; close it so WAL is checkpointed and the files released.
    repo.close().await;
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            error!("server failed: {e}");
            ExitCode::FAILURE
        }
    }
}

async fn run(listen_addr: std::net::SocketAddr, state: AppState) -> std::io::Result<()> {
    let listener = TcpListener::bind(listen_addr).await?;
    info!(addr = %listener.local_addr()?, "listening");
    axum::serve(listener, build_router(state))
        .with_graceful_shutdown(shutdown_signal())
        .await
}

async fn shutdown_signal() {
    if let Err(e) = tokio::signal::ctrl_c().await {
        // Without a Ctrl+C handler the server keeps running instead of shutting down at once.
        error!("cannot listen for Ctrl+C: {e}");
        std::future::pending::<()>().await;
    }
    info!("shutting down");
}
