//! `GET /dev/launch`: initData for a dev user, signed with the dev bot token through the validator's own
//! data-check-string and key, handed to the client in the URL hash the way Telegram opens a Mini App.

use axum::Router;
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::http::header::{CACHE_CONTROL, LOCATION};
use axum::response::IntoResponse;
use axum::routing::get;
use hmac::{Hmac, KeyInit, Mac};
use serde::{Deserialize, Serialize};
use server::AppState;
use server::auth::{data_check_string, secret_key};
use sha2::Sha256;
use tracing::info;

/// `tgWebAppVersion`: the Mini App API version the dev launch claims (R1 §5b).
const VERSION: &str = "9.6";
/// `tgWebAppPlatform`: the platform the prototype's load budget is set for.
const PLATFORM: &str = "android";

/// `tgWebAppThemeParams`: a fixed dark theme, the base keys plus `secondary_bg_color`, each `#rrggbb`.
const THEME_PARAMS: &str = r##"{"bg_color":"#17212b","text_color":"#f5f5f5","hint_color":"#708499","link_color":"#6ab3f3","button_color":"#5288c1","button_text_color":"#ffffff","secondary_bg_color":"#232e3c"}"##;

/// The `/dev/launch` route.
pub fn routes() -> Router<AppState> {
    Router::new().route("/dev/launch", get(launch))
}

/// `?uid=&lang=&name=`: the dev user to sign for; each absent parameter takes the default user's value.
#[derive(Deserialize)]
struct LaunchQuery {
    uid: Option<i64>,
    lang: Option<String>,
    name: Option<String>,
}

/// The `user` field of the signed initData, in Telegram's field names.
#[derive(Serialize)]
struct DevUser {
    id: i64,
    first_name: String,
    language_code: String,
}

/// `302` to `/#tgWebAppData=<initData>&tgWebAppVersion=…&tgWebAppPlatform=…&tgWebAppThemeParams=…`: relative, so
/// behind Vite's proxy the browser stays on the Vite origin. The redirect carries a signed `auth_date`, so it is never
/// cached. A `uid` that is not an integer is axum's 400.
async fn launch(State(st): State<AppState>, Query(q): Query<LaunchQuery>) -> impl IntoResponse {
    let user = DevUser {
        id: q.uid.unwrap_or(1001),
        first_name: q.name.unwrap_or_else(|| "Dev".to_owned()),
        language_code: q.lang.unwrap_or_else(|| "ru".to_owned()),
    };
    info!(uid = user.id, "dev launch");
    // The validator's clock: the dev app and `POST /api/auth` agree on what is fresh.
    let init_data = signed_init_data(&st.cfg.bot_token, &user, st.clock.now());
    // A second encoding layer: every `&` segment of the hash holds exactly one `=`, as Telegram's script expects
    // (it keeps only the text between the first and the second `=`).
    let hash = form_urlencoded::Serializer::new(String::new())
        .append_pair("tgWebAppData", &init_data)
        .append_pair("tgWebAppVersion", VERSION)
        .append_pair("tgWebAppPlatform", PLATFORM)
        .append_pair("tgWebAppThemeParams", THEME_PARAMS)
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
