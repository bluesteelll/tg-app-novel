//! The `server` binary: `server serve` (the default) runs the HTTP server, with the built client from `STATIC_DIR`
//! when it is set; `server setup` registers the bot's webhook, command menus and menu button with Telegram, once per
//! deploy (no database, no content).

#![forbid(unsafe_code)]

use std::process::ExitCode;

use server::api::static_files::{self, StaticDir};
use server::config::Config;
use server::telegram::gateway::FrankensteinGateway;
use server::telegram::setup;
use server::{AppState, build_router, db};
use tokio::net::TcpListener;
use tracing::{error, info};
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> ExitCode {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    tracing_subscriber::fmt().with_env_filter(filter).init();

    match std::env::args().nth(1).as_deref() {
        None | Some("serve") => serve().await,
        Some("setup") => bot_setup().await,
        Some(other) => {
            error!(
                command = other,
                "unknown command; usage: server [serve|setup]"
            );
            ExitCode::FAILURE
        }
    }
}

/// `server setup`: the configuration, the production gateway on it, then the one setup call. Opens no database.
async fn bot_setup() -> ExitCode {
    let cfg = match Config::from_env() {
        Ok(cfg) => cfg,
        Err(e) => {
            error!("{e}");
            return ExitCode::FAILURE;
        }
    };
    let gateway = match FrankensteinGateway::from_config(&cfg) {
        Ok(gateway) => gateway,
        Err(e) => {
            error!("bot api client: {e}");
            return ExitCode::FAILURE;
        }
    };
    match setup::run(&gateway, &cfg).await {
        Ok(()) => {
            info!(
                webhook = %setup::app_url(&cfg.public_app_url, "telegram/webhook"),
                "bot set up"
            );
            ExitCode::SUCCESS
        }
        Err(e) => {
            error!("setup failed: {e}");
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
    // Principle 0 before anything else is opened: a STATIC_DIR that could serve paid content refuses the start.
    let static_dir = match &cfg.static_dir {
        None => None,
        Some(dir) => match static_files::check(dir, &cfg.content_dir).await {
            Ok(dir) => Some(dir),
            Err(e) => {
                error!("static dir refused: {e}");
                return ExitCode::FAILURE;
            }
        },
    };
    // The target only (host:port/database): DATABASE_URL may hold a password, so it is never logged.
    info!(database = %db::database_target(&cfg.database_url), "opening database");
    let listen_addr = cfg.listen_addr;
    let state = match AppState::new(cfg).await {
        Ok(state) => state,
        Err(e) => {
            error!("startup failed: {e}");
            return ExitCode::FAILURE;
        }
    };
    let repo = state.repo.clone();
    let result = run(listen_addr, state, static_dir.as_ref()).await;
    // The pool lives until the server has stopped; close it so the pool closes its connections.
    repo.close().await;
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            error!("server failed: {e}");
            ExitCode::FAILURE
        }
    }
}

async fn run(
    listen_addr: std::net::SocketAddr,
    state: AppState,
    static_dir: Option<&StaticDir>,
) -> std::io::Result<()> {
    let app = build_router(state);
    let app = match static_dir {
        Some(dir) => static_files::with_static(app, dir),
        None => app,
    };
    let listener = TcpListener::bind(listen_addr).await?;
    info!(addr = %listener.local_addr()?, "listening");
    axum::serve(listener, app)
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
