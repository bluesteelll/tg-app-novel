//! `GET /dev/launch`: initData for a dev user, signed with the dev bot token through the validator's own
//! data-check-string and key, handed to the client in the URL hash the way Telegram opens a Mini App.

use axum::Router;
use axum::extract::State;
use axum::http::StatusCode;
use axum::http::header::{CACHE_CONTROL, LOCATION};
use axum::response::IntoResponse;
use axum::routing::get;
use hmac::{Hmac, KeyInit, Mac};
use serde::Serialize;
use server::AppState;
use server::auth::{data_check_string, secret_key};
use sha2::Sha256;
use tracing::info;

/// The `/dev/launch` route.
pub fn routes() -> Router<AppState> {
    Router::new().route("/dev/launch", get(launch))
}

/// The `user` field of the signed initData, in Telegram's field names.
#[derive(Serialize)]
struct DevUser {
    id: i64,
    first_name: String,
    language_code: String,
}

/// `302` to `/#tgWebAppData=<initData>`: relative, so behind Vite's proxy the browser stays on the Vite origin.
/// The redirect carries a signed `auth_date`, so it is never cached.
async fn launch(State(st): State<AppState>) -> impl IntoResponse {
    let user = DevUser {
        id: 1001,
        first_name: "Dev".to_owned(),
        language_code: "ru".to_owned(),
    };
    info!(uid = user.id, "dev launch");
    // The validator's clock: the dev app and `POST /api/auth` agree on what is fresh.
    let init_data = signed_init_data(&st.cfg.bot_token, &user, st.clock.now());
    // A second encoding layer: every `&` segment of the hash holds exactly one `=`, as Telegram's script expects
    // (it keeps only the text between the first and the second `=`).
    let hash = form_urlencoded::Serializer::new(String::new())
        .append_pair("tgWebAppData", &init_data)
        .finish();
    (
        StatusCode::FOUND,
        [(CACHE_CONTROL, "no-store")],
        [(LOCATION, format!("/#{hash}"))],
    )
}

/// initData (`auth_date`, `user`, `hash`) as Telegram signs it: `hash` = hex HMAC-SHA256 under
/// `secret_key(bot_token)` over the server's own data-check-string of the other pairs. No `signature` field: a
/// locally minted initData cannot carry Telegram's Ed25519 signature, and the server does not require one.
fn signed_init_data(bot_token: &str, user: &DevUser, auth_date: i64) -> String {
    let user_json =
        serde_json::to_string(user).expect("invariant: an integer and strings always serialize");
    let mut pairs = vec![
        ("auth_date".to_owned(), auth_date.to_string()),
        ("user".to_owned(), user_json),
    ];
    let mut mac = Hmac::<Sha256>::new_from_slice(&secret_key(bot_token))
        .expect("invariant: HMAC accepts keys of any length");
    mac.update(data_check_string(&pairs).as_bytes());
    pairs.push(("hash".to_owned(), hex::encode(mac.finalize().into_bytes())));
    form_urlencoded::Serializer::new(String::new())
        .extend_pairs(&pairs)
        .finish()
}
