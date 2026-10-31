//! The dev cluster on one port: where it lives, which PostgreSQL binaries run it, and how any number of concurrent
//! callers bring it up and end with one running server.

use std::env::VarError;
use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::str::FromStr;
use std::time::{Duration, Instant};

use sqlx::postgres::{PgConnectOptions, PgConnection};
use sqlx::{ConnectOptions, Connection};

use crate::{DEFAULT_PORT, DbName, PgDevError, READY_DEADLINE, REQUIRED_MAJOR, UpOutcome};

/// How long one connection attempt may take before the port counts as down.
const PROBE_TIMEOUT: Duration = Duration::from_secs(2);
/// The pause between two connection attempts while a peer brings the cluster up.
const POLL_INTERVAL: Duration = Duration::from_millis(250);
/// `pg_ctl start`'s and `stop`'s own wait (`-t`), explicit because its default comes from `PGCTLTIMEOUT`.
const PG_CTL_TIMEOUT_SECS: &str = "60";
/// `pg_ctl status` when no server runs on the data directory.
const PG_CTL_NOT_RUNNING: i32 = 3;
/// `pg_ctl status` when the data directory is not accessible (absent, or not a cluster).
const PG_CTL_NO_DATA_DIR: i32 = 4;
/// How much of `postgres.log` a failure quotes. The log grows for the cluster's whole life, so only its end is read.
const LOG_TAIL_BYTES: u64 = 16 * 1024;
const LOG_TAIL_LINES: usize = 20;

/// One PostgreSQL cluster, identified by its port: its data directory is `<root>/<port>/data` and its server log
/// `<root>/<port>/postgres.log`, so every consumer that names the same port and root shares one cluster.
#[derive(Debug, Clone)]
pub struct DevCluster {
    port: u16,
    root: PathBuf,
    bin: PathBuf,
}

impl DevCluster {
    /// The cluster that `DEV_PG_PORT`, `DEV_PG_ROOT` and `PG_BIN` (or `pg_ctl` on `PATH`) name.
    pub fn from_env() -> Result<DevCluster, PgDevError> {
        DevCluster::from_lookup(env_var)
    }

    /// As [`DevCluster::from_env`], reading each variable through `get`: the test seam, since `std::env::set_var` is
    /// `unsafe` in edition 2024. An empty value counts as unset.
    pub fn from_lookup(get: impl Fn(&str) -> Option<String>) -> Result<DevCluster, PgDevError> {
        let set = |key: &str| get(key).filter(|value| !value.is_empty());
        let port = parse_port(set("DEV_PG_PORT").as_deref())?;
        let root = match set("DEV_PG_ROOT") {
            None => workspace_root().join("target").join("pg"),
            // A cwd-relative root would give two callers on one port two different clusters.
            Some(root) if Path::new(&root).is_absolute() => PathBuf::from(root),
            Some(_) => return Err(PgDevError::BadEnv("DEV_PG_ROOT must be an absolute path")),
        };
        // A given PG_BIN is taken as is: a wrong one fails loudly at the first spawn.
        let bin = match set("PG_BIN") {
            Some(bin) => PathBuf::from(bin),
            None => find_pg_ctl(set("PATH").as_deref()).ok_or(PgDevError::BinariesNotFound)?,
        };
        Ok(DevCluster { port, root, bin })
    }

    /// The cluster port.
    pub fn port(&self) -> u16 {
        self.port
    }

    /// The data directory, `<root>/<port>/data`.
    pub fn data_dir(&self) -> PathBuf {
        self.cluster_dir().join("data")
    }

    /// The directory of `initdb` and `pg_ctl`.
    pub fn bin_dir(&self) -> &Path {
        &self.bin
    }

    /// The admin URL, built and never configured. The explicit `sslmode` makes a stray `PGSSLMODE` harmless.
    pub fn admin_url(&self) -> String {
        format!(
            "postgres://postgres@127.0.0.1:{}/postgres?sslmode=disable",
            self.port
        )
    }

    /// The URL of database `db` on this cluster.
    pub fn database_url(&self, db: &DbName) -> String {
        format!(
            "postgres://postgres@127.0.0.1:{}/{db}?sslmode=disable",
            self.port
        )
    }

    /// Brings the cluster up, safe for any number of concurrent callers on one port, and says what that took:
    /// 1. a ready server of [`REQUIRED_MAJOR`] answers: [`UpOutcome::AlreadyUp`], nothing spawned;
    /// 2. no data directory: initdb into a private temp directory, renamed to `data`. A rename onto an existing
    ///    directory fails, so of two cold starters exactly one result lands;
    /// 3. `pg_ctl start`, through a launcher that hands this process's handles to no long-lived process;
    /// 4. a failed start means a peer's server holds the data directory (or crash recovery outlasts the start
    ///    timeout): wait for it, up to [`READY_DEADLINE`].
    pub async fn ensure_up(&self) -> Result<UpOutcome, PgDevError> {
        match self.probe().await? {
            Probe::Ready => return Ok(UpOutcome::AlreadyUp),
            // Starting, recovering or stopping: a server owns the data directory, so neither initdb nor start.
            Probe::Wait => {
                self.wait_ready("a server was starting or stopping".to_owned())
                    .await?;
                return Ok(UpOutcome::JoinedPeer);
            }
            Probe::Down => {}
        }
        let bin = self.bin.clone();
        blocking(move || check_version(&bin)).await??;
        let dir = self.cluster_dir();
        tokio::fs::create_dir_all(&dir)
            .await
            .map_err(|e| at(&dir, e))?;
        let initdb = self.init_if_absent().await?;
        let exit = self.start().await?;
        let context = match exit {
            Some(code) => format!("pg_ctl start exited with {code}"),
            None => "pg_ctl start ended without an exit code".to_owned(),
        };
        self.wait_ready(context).await?;
        Ok(if exit == Some(0) {
            UpOutcome::Started { initdb }
        } else {
            UpOutcome::JoinedPeer
        })
    }

    /// Stops the cluster (`pg_ctl stop -m fast`): a no-op when there is no data directory or no server runs on it.
    pub fn down(&self) -> Result<(), PgDevError> {
        let data = self.data_dir();
        if !data.is_dir() || !server_runs(&self.bin, &data)? {
            return Ok(());
        }
        let output = Command::new(tool(&self.bin, "pg_ctl"))
            .args(["stop", "-m", "fast", "-w", "-t", PG_CTL_TIMEOUT_SECS, "-D"])
            .arg(&data)
            .stdin(Stdio::null())
            .output()
            .map_err(spawn_error)?;
        if output.status.success() {
            Ok(())
        } else {
            Err(failed("pg_ctl stop", &data, &output))
        }
    }

    /// [`DevCluster::down`], then deletes `<root>/<port>/data` and nothing else: never after a failed stop, and never
    /// a `data.init-*` temp directory, which may be a peer's initdb in progress.
    pub fn reset(&self) -> Result<(), PgDevError> {
        self.down()?;
        let data = self.data_dir();
        match std::fs::remove_dir_all(&data) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(at(&data, e)),
        }
    }

    /// `<root>/<port>`: the data directory, the server log and the initdb temp directories.
    fn cluster_dir(&self) -> PathBuf {
        self.root.join(self.port.to_string())
    }

    /// `<root>/<port>/postgres.log`, the server's own log (pg_ctl `-l`).
    fn log_file(&self) -> PathBuf {
        self.cluster_dir().join("postgres.log")
    }

    /// One connection, never a pool: a pool retries `57P03` by itself, and the probe must see it.
    async fn admin(&self) -> Result<PgConnection, sqlx::Error> {
        PgConnectOptions::from_str(&self.admin_url())?
            .connect()
            .await
    }

    /// Step 1: one connection attempt, classified.
    async fn probe(&self) -> Result<Probe, PgDevError> {
        let failure = match tokio::time::timeout(PROBE_TIMEOUT, self.admin()).await {
            Ok(Ok(mut conn)) => {
                let checked = check_server(&mut conn).await;
                let closed = conn.close().await;
                checked?;
                closed?;
                return Ok(Probe::Ready);
            }
            Ok(Err(e)) => ConnectFailure::Sqlx(e),
            Err(_elapsed) => ConnectFailure::TimedOut,
        };
        match classify(&failure) {
            ConnectClass::Wait => Ok(Probe::Wait),
            ConnectClass::Down => Ok(Probe::Down),
            ConnectClass::Refused(detail) => Err(PgDevError::Refused {
                port: self.port,
                detail,
            }),
        }
    }

    /// Step 2: initdb into `data.init-<pid>-<8 hex>`, then a rename to `data`. Returns whether this caller's initdb
    /// landed. The loser of a rename race deletes only its own copy.
    async fn init_if_absent(&self) -> Result<bool, PgDevError> {
        let data = self.data_dir();
        if is_dir(&data).await {
            return Ok(false);
        }
        let temp = self.cluster_dir().join(format!(
            "data.init-{}-{:08x}",
            std::process::id(),
            crate::random_u32()
        ));
        let (bin, dir) = (self.bin.clone(), temp.clone());
        if let Err(e) = blocking(move || run_initdb(&bin, &dir)).await? {
            discard(&temp).await;
            return Err(e);
        }
        match tokio::fs::rename(&temp, &data).await {
            Ok(()) => Ok(true),
            // Windows reports a directory renamed onto an existing one as ACCESS_DENIED or DIR_NOT_EMPTY, depending on
            // the path std takes, so a lost race is told by `data` existing now, not by the error kind.
            Err(_) if is_dir(&data).await => {
                discard(&temp).await;
                Ok(false)
            }
            Err(e) => {
                discard(&temp).await;
                Err(at(&temp, e))
            }
        }
    }

    /// Step 3: `pg_ctl start -w`, with every setting on the command line so none is ever stale. Returns pg_ctl's exit
    /// code.
    async fn start(&self) -> Result<Option<i32>, PgDevError> {
        let pg_ctl = std::path::absolute(tool(&self.bin, "pg_ctl"))?;
        let (data, log, cwd) = (self.data_dir(), self.log_file(), self.cluster_dir());
        let options = server_options(self.port);
        blocking(move || launch_start(&pg_ctl, &data, &log, &options, &cwd)).await?
    }

    /// Step 4: poll until a ready server answers, for up to [`READY_DEADLINE`]. Then `NotReady` if a server runs
    /// (it may be serving the slot's other consumers, so never `reset` advice), else `Start` with `context` and the
    /// end of the server log.
    async fn wait_ready(&self, context: String) -> Result<(), PgDevError> {
        let waiting = Instant::now();
        loop {
            if matches!(self.probe().await?, Probe::Ready) {
                return Ok(());
            }
            if waiting.elapsed() >= READY_DEADLINE {
                break;
            }
            tokio::time::sleep(POLL_INTERVAL).await;
        }
        let log = self.log_file();
        let (bin, data) = (self.bin.clone(), self.data_dir());
        if blocking(move || server_runs(&bin, &data)).await?? {
            return Err(PgDevError::NotReady {
                port: self.port,
                waited_secs: READY_DEADLINE.as_secs(),
                log: log.display().to_string(),
            });
        }
        let tail = {
            let log = log.clone();
            blocking(move || log_tail(&log)).await?
        };
        Err(PgDevError::Start {
            data: self.data_dir().display().to_string(),
            detail: format!("{context}; the end of {}:\n{tail}", log.display()),
        })
    }
}

/// The outcome of one connection attempt.
enum Probe {
    /// A server of the required major answered.
    Ready,
    /// `57P03`: a server is starting, recovering or stopping.
    Wait,
    /// Nothing answered.
    Down,
}

/// Why one connection attempt failed.
#[derive(Debug)]
enum ConnectFailure {
    /// No answer within [`PROBE_TIMEOUT`].
    TimedOut,
    /// The driver's error.
    Sqlx(sqlx::Error),
}

/// What a failed connection attempt means for `ensure_up`.
#[derive(Debug, PartialEq, Eq)]
enum ConnectClass {
    /// A server owns the data directory and is starting, recovering or stopping: wait, never start.
    Wait,
    /// Nothing listens, or nothing answers in time: start the cluster.
    Down,
    /// Something answers, but not as a server pgdev can use: an error at once, not after a wait.
    Refused(String),
}

/// An environment variable; a value that is not Unicode is passed on lossily, so a port check refuses it instead of
/// treating it as unset.
fn env_var(key: &str) -> Option<String> {
    match std::env::var(key) {
        Ok(value) => Some(value),
        Err(VarError::NotPresent) => None,
        Err(VarError::NotUnicode(raw)) => Some(raw.to_string_lossy().into_owned()),
    }
}

/// `DEV_PG_PORT`: unset gives [`DEFAULT_PORT`]; anything but a decimal port 1..=65535 is an error, never a silent
/// fallback to another slot's port.
fn parse_port(text: Option<&str>) -> Result<u16, PgDevError> {
    match text {
        None => Ok(DEFAULT_PORT),
        Some(text) => text
            .parse::<u16>()
            .ok()
            // `u16::from_str` also takes a leading `+`.
            .filter(|&port| port != 0 && text.bytes().all(|b| b.is_ascii_digit()))
            .ok_or(PgDevError::BadEnv(
                "DEV_PG_PORT must be a port number 1..=65535",
            )),
    }
}

/// The workspace root, fixed at compile time (two levels above `server/pgdev`), so the default root does not depend
/// on the working directory.
fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .expect("invariant: server/pgdev lies two levels below the workspace root")
        .to_path_buf()
}

/// The first `PATH` directory that holds `pg_ctl`.
fn find_pg_ctl(path: Option<&str>) -> Option<PathBuf> {
    let pg_ctl = format!("pg_ctl{}", std::env::consts::EXE_SUFFIX);
    std::env::split_paths(path?).find(|dir| dir.join(&pg_ctl).is_file())
}

/// The major version in `pg_ctl --version`'s output (`pg_ctl (PostgreSQL) 18.6`), which must be
/// [`REQUIRED_MAJOR`]: initdb and the server come from the same directory, so their major is the same.
fn pg_major(stdout: &str) -> Result<u32, PgDevError> {
    let text = stdout.trim();
    let version = text.rsplit(char::is_whitespace).next().unwrap_or(text);
    let digits = version.bytes().take_while(u8::is_ascii_digit).count();
    match version[..digits].parse::<u32>() {
        Ok(REQUIRED_MAJOR) => Ok(REQUIRED_MAJOR),
        Ok(_) => Err(PgDevError::WrongMajor {
            found: version.to_owned(),
        }),
        Err(_) => Err(PgDevError::WrongMajor {
            found: text.to_owned(),
        }),
    }
}

/// One pure rule for every failed connection attempt.
fn classify(failure: &ConnectFailure) -> ConnectClass {
    match failure {
        ConnectFailure::TimedOut => ConnectClass::Down,
        ConnectFailure::Sqlx(sqlx::Error::Database(e)) if e.code().as_deref() == Some("57P03") => {
            ConnectClass::Wait
        }
        ConnectFailure::Sqlx(sqlx::Error::Io(e))
            if matches!(
                e.kind(),
                io::ErrorKind::ConnectionRefused
                    | io::ErrorKind::ConnectionReset
                    | io::ErrorKind::ConnectionAborted
                    | io::ErrorKind::TimedOut
            ) =>
        {
            ConnectClass::Down
        }
        ConnectFailure::Sqlx(e) => ConnectClass::Refused(e.to_string()),
    }
}

/// A connected server must be the required major: a stray service on the port is caught here.
async fn check_server(conn: &mut PgConnection) -> Result<(), PgDevError> {
    let (num, version): (i32, String) = sqlx::query_as(
        "SELECT current_setting('server_version_num')::int4, current_setting('server_version')",
    )
    .fetch_one(&mut *conn)
    .await?;
    if u32::try_from(num / 10_000) == Ok(REQUIRED_MAJOR) {
        Ok(())
    } else {
        Err(PgDevError::WrongMajor { found: version })
    }
}

/// The server settings, passed at every start.
fn server_options(port: u16) -> String {
    format!(
        "-p {port} -c listen_addresses=127.0.0.1 -c max_connections=150 -c shared_buffers=32MB \
         -c max_wal_size=512MB -c timezone=UTC"
    )
}

/// `bin/<name>` with the platform's executable suffix.
fn tool(bin: &Path, name: &str) -> PathBuf {
    bin.join(format!("{name}{}", std::env::consts::EXE_SUFFIX))
}

/// A PostgreSQL tool that is not there is a configuration error with a remedy, not an I/O error.
fn spawn_error(e: io::Error) -> PgDevError {
    if e.kind() == io::ErrorKind::NotFound {
        PgDevError::BinariesNotFound
    } else {
        PgDevError::Io(e)
    }
}

/// `e`, naming the path it concerns.
fn at(path: &Path, e: io::Error) -> PgDevError {
    PgDevError::Io(io::Error::new(e.kind(), format!("{}: {e}", path.display())))
}

/// A short-lived pg_ctl command that exited non-zero.
fn failed(what: &str, data: &Path, output: &Output) -> PgDevError {
    PgDevError::Io(io::Error::other(format!(
        "{what} -D {}: {}",
        data.display(),
        describe(output)
    )))
}

/// A finished child's exit status and its stderr.
fn describe(output: &Output) -> String {
    format!(
        "{}: {}",
        output.status,
        String::from_utf8_lossy(&output.stderr).trim()
    )
}

async fn is_dir(path: &Path) -> bool {
    tokio::fs::metadata(path)
        .await
        .is_ok_and(|meta| meta.is_dir())
}

/// Deletes this caller's own initdb temp directory. A failure is printed, not returned: the cluster is fine either
/// way, and `pgdev status` lists leftovers.
async fn discard(temp: &Path) {
    if let Err(e) = tokio::fs::remove_dir_all(temp).await
        && e.kind() != io::ErrorKind::NotFound
    {
        eprintln!("pgdev: cannot delete {}: {e}", temp.display());
    }
}

/// Runs blocking work (a child process, a file read) off the async workers: tokio has no `process` feature here.
async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> T + Send + 'static,
) -> Result<T, PgDevError> {
    match tokio::task::spawn_blocking(work).await {
        Ok(value) => Ok(value),
        Err(e) if e.is_panic() => std::panic::resume_unwind(e.into_panic()),
        Err(e) => Err(PgDevError::Io(io::Error::other(format!(
            "a blocking pgdev task was cancelled: {e}"
        )))),
    }
}

/// `pg_ctl --version` must report [`REQUIRED_MAJOR`]; checked before the first initdb or start.
fn check_version(bin: &Path) -> Result<(), PgDevError> {
    let output = Command::new(tool(bin, "pg_ctl"))
        .arg("--version")
        .stdin(Stdio::null())
        .output()
        .map_err(spawn_error)?;
    if !output.status.success() {
        return Err(PgDevError::Io(io::Error::other(format!(
            "pg_ctl --version: {}",
            describe(&output)
        ))));
    }
    pg_major(&String::from_utf8_lossy(&output.stdout)).map(drop)
}

/// initdb into `dir`: trust auth (the cluster listens on loopback only), UTF-8, the builtin C.UTF-8 locale.
fn run_initdb(bin: &Path, dir: &Path) -> Result<(), PgDevError> {
    let output = Command::new(tool(bin, "initdb"))
        .arg("-D")
        .arg(dir)
        .args([
            "-U",
            "postgres",
            "--auth=trust",
            "-E",
            "UTF8",
            "--locale-provider=builtin",
            "--builtin-locale=C.UTF-8",
        ])
        .stdin(Stdio::null())
        .output()
        .map_err(spawn_error)?;
    if output.status.success() {
        Ok(())
    } else {
        Err(PgDevError::Initdb(describe(&output)))
    }
}

/// Whether `pg_ctl status` sees a server on `data`.
fn server_runs(bin: &Path, data: &Path) -> Result<bool, PgDevError> {
    let output = Command::new(tool(bin, "pg_ctl"))
        .arg("status")
        .arg("-D")
        .arg(data)
        .stdin(Stdio::null())
        .output()
        .map_err(spawn_error)?;
    match output.status.code() {
        Some(0) => Ok(true),
        Some(PG_CTL_NOT_RUNNING | PG_CTL_NO_DATA_DIR) => Ok(false),
        _ => Err(failed("pg_ctl status", data, &output)),
    }
}

/// The last [`LOG_TAIL_LINES`] lines of the server log, from its last [`LOG_TAIL_BYTES`]. Decoded lossily: the cut
/// may split a character, and the server writes in its message locale's encoding.
fn log_tail(log: &Path) -> String {
    let read = || -> io::Result<String> {
        let mut file = File::open(log)?;
        let len = file.metadata()?.len();
        file.seek(SeekFrom::Start(len.saturating_sub(LOG_TAIL_BYTES)))?;
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes)?;
        Ok(String::from_utf8_lossy(&bytes).into_owned())
    };
    match read() {
        Ok(text) => {
            let lines: Vec<&str> = text.lines().collect();
            lines[lines.len().saturating_sub(LOG_TAIL_LINES)..].join("\n")
        }
        Err(e) => format!("({} unreadable: {e})", log.display()),
    }
}

/// `CREATE_NO_WINDOW`: PowerShell gets no console of its own.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Runs `pg_ctl start` so that no long-lived process holds this process's handles.
///
/// std creates every child with handle inheritance on (no handle list), and pg_ctl passes what it inherits on to
/// cmd.exe and the postmaster, which would hold the caller's pipes for the cluster's whole life: a piped `pgdev up`
/// would never see EOF, and a gate's log would stay open. `Start-Process` creates pg_ctl through ShellExecuteEx,
/// which inherits nothing; PowerShell itself holds the inherited handles only until pg_ctl exits. `-Wait` is not
/// used: it waits for the whole process tree, the postmaster included. Reading `Handle` once keeps the process
/// handle open, so `ExitCode` stays readable after the exit.
///
/// The working directory is `cwd` (`<root>/<port>`): pg_ctl's cmd.exe stays the postmaster's parent and keeps it for
/// the cluster's life, so it must never be the caller's directory, which may be a worktree that has to stay
/// removable.
#[cfg(windows)]
fn launch_start(
    pg_ctl: &Path,
    data: &Path,
    log: &Path,
    options: &str,
    cwd: &Path,
) -> Result<Option<i32>, PgDevError> {
    use std::os::windows::process::CommandExt;

    let args = format!(
        "start -w -t {PG_CTL_TIMEOUT_SECS} -D \"{}\" -l \"{}\" -o \"{options}\"",
        crt_quotable(data)?,
        crt_quotable(log)?
    );
    let script = format!(
        "$ErrorActionPreference = 'Stop'; \
         $p = Start-Process -FilePath {} -ArgumentList {} -WorkingDirectory {} -WindowStyle Hidden -PassThru; \
         $null = $p.Handle; $p.WaitForExit(); exit $p.ExitCode",
        ps_literal(unicode(pg_ctl)?),
        ps_literal(&args),
        ps_literal(unicode(cwd)?)
    );
    let utf16le: Vec<u8> = script.encode_utf16().flat_map(u16::to_le_bytes).collect();
    let status = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-EncodedCommand"])
        .arg(base64(&utf16le))
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .status()
        .map_err(|e| PgDevError::Io(io::Error::new(e.kind(), format!("powershell.exe: {e}"))))?;
    Ok(status.code())
}

/// Unverified: no Unix host runs the gates yet. There std marks every descriptor but stdio close-on-exec, so the
/// null stdio below is all a long-lived postmaster could inherit.
#[cfg(not(windows))]
fn launch_start(
    pg_ctl: &Path,
    data: &Path,
    log: &Path,
    options: &str,
    cwd: &Path,
) -> Result<Option<i32>, PgDevError> {
    let status = Command::new(pg_ctl)
        .args(["start", "-w", "-t", PG_CTL_TIMEOUT_SECS, "-D"])
        .arg(data)
        .arg("-l")
        .arg(log)
        .arg("-o")
        .arg(options)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(spawn_error)?;
    Ok(status.code())
}

#[cfg(windows)]
fn unicode(path: &Path) -> Result<&str, PgDevError> {
    path.to_str().ok_or(PgDevError::BadEnv(
        "the PostgreSQL paths must be valid Unicode",
    ))
}

/// `path` as the body of a double-quoted pg_ctl argument. pg_ctl splits its command line by the C runtime's rules,
/// so a `"` inside would end the argument; the paths end in `data` or `postgres.log`, never in a backslash.
#[cfg(windows)]
fn crt_quotable(path: &Path) -> Result<&str, PgDevError> {
    let text = unicode(path)?;
    if text.contains('"') {
        Err(PgDevError::BadEnv(
            "DEV_PG_ROOT must not contain a double quote",
        ))
    } else {
        Ok(text)
    }
}

/// `text` as a PowerShell single-quoted literal, in which nothing is expanded. PowerShell takes U+2018-U+201B as
/// single quotes too; each quote is escaped by doubling it.
#[cfg(windows)]
fn ps_literal(text: &str) -> String {
    let mut literal = String::with_capacity(text.len() + 2);
    literal.push('\'');
    for c in text.chars() {
        if matches!(c, '\'' | '\u{2018}'..='\u{201b}') {
            literal.push(c);
        }
        literal.push(c);
    }
    literal.push('\'');
    literal
}

/// Standard base64 with padding (RFC 4648 section 4), for `-EncodedCommand`.
#[cfg(windows)]
fn base64(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let byte = |i: usize| u32::from(chunk.get(i).copied().unwrap_or(0));
        let group = (byte(0) << 16) | (byte(1) << 8) | byte(2);
        for i in 0..4 {
            if i <= chunk.len() {
                out.push(char::from(
                    ALPHABET[((group >> (18 - 6 * i)) & 63) as usize],
                ));
            } else {
                out.push('=');
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn report(failures: &[String]) {
        assert!(
            failures.is_empty(),
            "{} failures:\n{}",
            failures.len(),
            failures.join("\n")
        );
    }

    /// A lookup over fixed pairs: nothing is read from the process environment.
    fn vars<'a>(pairs: &'a [(&'a str, &'a str)]) -> impl Fn(&str) -> Option<String> + 'a {
        move |key| {
            pairs
                .iter()
                .find(|(name, _)| *name == key)
                .map(|(_, value)| (*value).to_owned())
        }
    }

    #[test]
    fn dev_cluster_env_defaults_and_errors() {
        const BIN: &str = "pg-bin-taken-as-given";
        let mut failures = Vec::new();

        for (case, pairs) in [
            ("unset", &[("PG_BIN", BIN)][..]),
            (
                "empty",
                &[("PG_BIN", BIN), ("DEV_PG_PORT", ""), ("DEV_PG_ROOT", "")][..],
            ),
        ] {
            let cluster = match DevCluster::from_lookup(vars(pairs)) {
                Ok(cluster) => cluster,
                Err(e) => {
                    failures.push(format!("{case}: expected Ok, got {e}"));
                    continue;
                }
            };
            if cluster.port() != 5487 {
                failures.push(format!(
                    "{case}: port expected 5487, got {}",
                    cluster.port()
                ));
            }
            if cluster.bin_dir() != Path::new(BIN) {
                failures.push(format!(
                    "{case}: bin expected {BIN}, got {}",
                    cluster.bin_dir().display()
                ));
            }
            // The default root is `<workspace>/target/pg`: checked against the files that mark the workspace, not
            // against a second computation of the same path.
            let root = &cluster.root;
            if !root.is_absolute() || !root.ends_with(Path::new("target").join("pg")) {
                failures.push(format!(
                    "{case}: root expected an absolute <workspace>/target/pg, got {}",
                    root.display()
                ));
            }
            let workspace = root.parent().and_then(Path::parent).unwrap_or(root);
            for manifest in ["Cargo.toml", "server/pgdev/Cargo.toml"] {
                let file = workspace.join(manifest);
                if !file.is_file() {
                    failures.push(format!("{case}: {} expected a file", file.display()));
                }
            }
            if cluster.data_dir() != root.join("5487").join("data") {
                failures.push(format!(
                    "{case}: data dir expected <root>/5487/data, got {}",
                    cluster.data_dir().display()
                ));
            }
        }

        match DevCluster::from_lookup(vars(&[("PG_BIN", BIN), ("DEV_PG_PORT", "5497")])) {
            Ok(cluster) if cluster.port() == 5497 => {}
            Ok(cluster) => failures.push(format!(
                "DEV_PG_PORT \"5497\": expected 5497, got {}",
                cluster.port()
            )),
            Err(e) => failures.push(format!("DEV_PG_PORT \"5497\": expected Ok, got {e}")),
        }
        for port in ["0", "65536", " 5497", "+5497", "abc"] {
            match DevCluster::from_lookup(vars(&[("PG_BIN", BIN), ("DEV_PG_PORT", port)])) {
                Err(PgDevError::BadEnv(_)) => {}
                Err(e) => failures.push(format!("DEV_PG_PORT {port:?}: expected BadEnv, got {e}")),
                Ok(cluster) => failures.push(format!(
                    "DEV_PG_PORT {port:?}: expected Err, got Ok({})",
                    cluster.port()
                )),
            }
        }

        let own_root = concat!(env!("CARGO_MANIFEST_DIR"), "/pg-root-override");
        match DevCluster::from_lookup(vars(&[("PG_BIN", BIN), ("DEV_PG_ROOT", own_root)])) {
            Ok(cluster) if cluster.data_dir() == Path::new(own_root).join("5487").join("data") => {}
            Ok(cluster) => failures.push(format!(
                "DEV_PG_ROOT {own_root}: data dir expected under it, got {}",
                cluster.data_dir().display()
            )),
            Err(e) => failures.push(format!("DEV_PG_ROOT {own_root}: expected Ok, got {e}")),
        }
        match DevCluster::from_lookup(vars(&[("PG_BIN", BIN), ("DEV_PG_ROOT", "target/pg")])) {
            Err(PgDevError::BadEnv(_)) => {}
            Err(e) => failures.push(format!("relative DEV_PG_ROOT: expected BadEnv, got {e}")),
            Ok(cluster) => failures.push(format!(
                "relative DEV_PG_ROOT: expected Err, got Ok({})",
                cluster.root.display()
            )),
        }

        // A PATH that exists but holds no pg_ctl: this crate's own directory.
        let no_pg_ctl = env!("CARGO_MANIFEST_DIR");
        for (case, pairs) in [
            ("no PG_BIN, no PATH", &[][..]),
            ("no PG_BIN, no pg_ctl on PATH", &[("PATH", no_pg_ctl)][..]),
        ] {
            match DevCluster::from_lookup(vars(pairs)) {
                Err(PgDevError::BinariesNotFound) => {}
                Err(e) => failures.push(format!("{case}: expected BinariesNotFound, got {e}")),
                Ok(cluster) => failures.push(format!(
                    "{case}: expected BinariesNotFound, got bin {}",
                    cluster.bin_dir().display()
                )),
            }
        }
        report(&failures);
    }

    #[test]
    fn pg_version_parse() {
        let mut failures = Vec::new();
        for text in [
            "pg_ctl (PostgreSQL) 18.6",
            "pg_ctl (PostgreSQL) 18.6\r\n",
            "pg_ctl (PostgreSQL) 18beta1",
        ] {
            match pg_major(text) {
                Ok(18) => {}
                Ok(other) => failures.push(format!("{text:?}: expected 18, got {other}")),
                Err(e) => failures.push(format!("{text:?}: expected 18, got {e}")),
            }
        }
        for (text, found) in [
            ("17.11", "17.11"),
            ("pg_ctl (PostgreSQL) 17.11", "17.11"),
            ("pg_ctl (PostgreSQL) 180.1", "180.1"),
            ("not a version", "not a version"),
            ("", ""),
        ] {
            match pg_major(text) {
                Err(PgDevError::WrongMajor { found: got }) if got == found => {}
                Err(e) => {
                    failures.push(format!("{text:?}: expected WrongMajor({found:?}), got {e}"))
                }
                Ok(major) => {
                    failures.push(format!("{text:?}: expected WrongMajor, got Ok({major})"))
                }
            }
        }
        report(&failures);
    }

    /// A server error with only a SQLSTATE, as the driver hands it over.
    #[derive(Debug)]
    struct ServerError(&'static str);

    impl std::fmt::Display for ServerError {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            write!(f, "server error {}", self.0)
        }
    }

    impl std::error::Error for ServerError {}

    impl sqlx::error::DatabaseError for ServerError {
        fn message(&self) -> &str {
            "server error"
        }

        fn code(&self) -> Option<std::borrow::Cow<'_, str>> {
            Some(self.0.into())
        }

        fn as_error(&self) -> &(dyn std::error::Error + Send + Sync + 'static) {
            self
        }

        fn as_error_mut(&mut self) -> &mut (dyn std::error::Error + Send + Sync + 'static) {
            self
        }

        fn into_error(self: Box<Self>) -> Box<dyn std::error::Error + Send + Sync + 'static> {
            self
        }

        fn kind(&self) -> sqlx::error::ErrorKind {
            sqlx::error::ErrorKind::Other
        }
    }

    #[test]
    fn connect_error_classes() {
        let server =
            |code| ConnectFailure::Sqlx(sqlx::Error::Database(Box::new(ServerError(code))));
        let io = |kind| ConnectFailure::Sqlx(sqlx::Error::Io(io::Error::from(kind)));
        let cases = [
            ("57P03 cannot_connect_now", server("57P03"), "wait"),
            ("28P01 invalid_password", server("28P01"), "refused"),
            ("28000 invalid_authorization", server("28000"), "refused"),
            ("3D000 no such database", server("3D000"), "refused"),
            ("XX000 internal_error", server("XX000"), "refused"),
            (
                "io ConnectionRefused",
                io(io::ErrorKind::ConnectionRefused),
                "down",
            ),
            (
                "io ConnectionReset",
                io(io::ErrorKind::ConnectionReset),
                "down",
            ),
            (
                "io ConnectionAborted",
                io(io::ErrorKind::ConnectionAborted),
                "down",
            ),
            ("io TimedOut", io(io::ErrorKind::TimedOut), "down"),
            ("the 2 s connect timeout", ConnectFailure::TimedOut, "down"),
            (
                "io PermissionDenied",
                io(io::ErrorKind::PermissionDenied),
                "refused",
            ),
            (
                "a protocol error",
                ConnectFailure::Sqlx(sqlx::Error::Protocol("not PostgreSQL".to_owned())),
                "refused",
            ),
            (
                "a TLS error",
                ConnectFailure::Sqlx(sqlx::Error::Tls("handshake".into())),
                "refused",
            ),
        ];
        let mut failures = Vec::new();
        for (case, failure, expected) in cases {
            let got = match classify(&failure) {
                ConnectClass::Wait => "wait",
                ConnectClass::Down => "down",
                ConnectClass::Refused(_) => "refused",
            };
            if got != expected {
                failures.push(format!("{case}: expected {expected}, got {got}"));
            }
        }
        report(&failures);
    }
}
