//! Phone and desktop sync over the same Wi-Fi.
//!
//! Every copy of Flip hosts one tiny HTTP endpoint and answers one discovery
//! datagram, so pairing needs nothing but a six-digit code: no IP address is
//! ever shown or typed. The phone asks the network "who has code 482913?", the
//! desktop with that code answers with its address, and the two swap boards.
//! Whichever copy carries the later stamp wins, so a sync moves data both ways
//! in one request.

use std::io::{self, Read, Write};
use std::net::{TcpListener, TcpStream, UdpSocket};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::board::{self, Board};
use crate::state::{lock, SharedCore};

/// The port the boards travel over.
pub const PORT: u16 = 47821;
/// The port the pairing code is looked up on.
const FIND_PORT: u16 = 47822;

/// A board is a few kilobytes; this only stops a runaway request.
const MAX_BODY: usize = 4 * 1024 * 1024;
const MAX_HEAD: usize = 64 * 1024;
const TIMEOUT: Duration = Duration::from_secs(4);
/// How long one "who has this code?" question waits for an answer.
const FIND_WAIT: Duration = Duration::from_millis(1200);
/// A found device is reused for this long before looking again.
const CACHE_FOR: Duration = Duration::from_secs(120);

/// The answers shown in the sync panel. Fixed sentences, so the frontend can
/// swap them for Vietnamese.
pub const UP_TO_DATE: &str = "Already up to date.";
pub const SYNCED: &str = "Synced from your other device.";
pub const WRONG_CODE: &str = "Wrong pairing code.";
pub const NO_ANSWER: &str = "No device answered. Check both are on the same Wi-Fi.";
pub const MISSING_CODE: &str = "Type the code from your other device.";
const UNREACHABLE: &str = "Could not reach the other device.";

/// The address last found for a code, with the device name that answered.
static PEER: Mutex<Option<Peer>> = Mutex::new(None);

#[derive(Clone)]
struct Peer {
    code: String,
    address: String,
    name: String,
    at: Instant,
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// True when `incoming` is the copy both devices should keep. The later stamp
/// wins; the device id breaks an exact tie so the two sides always agree.
pub fn newer(local: &Board, incoming: &Board) -> bool {
    (incoming.updated_ms, incoming.updated_by.as_str())
        > (local.updated_ms, local.updated_by.as_str())
}

/// What the sync panel shows about this device.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncInfo {
    pub name: String,
    /// The six digits another device types. The only thing a user ever sees.
    pub code: String,
    /// The code typed here to reach the other device, empty until it is added.
    pub peer_code: String,
    pub auto: bool,
}

/// The answer to one sync.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncResult {
    pub changed: bool,
    pub message: String,
    /// The name of the device on the other end, when it is known.
    pub name: String,
}

impl SyncResult {
    fn unchanged(name: String) -> Self {
        Self {
            changed: false,
            message: UP_TO_DATE.to_string(),
            name,
        }
    }

    fn failed(message: &str) -> Self {
        Self {
            changed: false,
            message: message.to_string(),
            name: String::new(),
        }
    }
}

pub fn info(core: &SharedCore) -> SyncInfo {
    let c = lock(core);
    SyncInfo {
        name: device_name(),
        code: c.settings.sync_code.clone(),
        peer_code: c.settings.peer_code.clone(),
        auto: c.settings.sync_auto,
    }
}

/// The name the other device sees. The computer name is friendlier than an
/// address, and a phone just calls itself a phone.
pub fn device_name() -> String {
    if cfg!(windows) {
        return std::env::var("COMPUTERNAME").unwrap_or_else(|_| "Desktop".into());
    }
    if cfg!(target_os = "android") {
        return "Phone".into();
    }
    std::env::var("HOSTNAME").unwrap_or_else(|_| "Computer".into())
}

/* -------------------------------------------------------------------- host */

/// Starts the board endpoint. Called on every platform, so either device can
/// host a sync; a busy port only means another copy of Flip already holds it.
pub fn spawn(app: AppHandle, core: SharedCore) {
    std::thread::spawn(move || {
        let listener = match TcpListener::bind(("0.0.0.0", PORT)) {
            Ok(listener) => listener,
            Err(e) => {
                eprintln!("flip: sync is not listening on port {PORT}: {e}");
                return;
            }
        };
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else {
                continue;
            };
            let app = app.clone();
            let core = Arc::clone(&core);
            std::thread::spawn(move || {
                if let Err(e) = serve(&mut stream, &app, &core) {
                    eprintln!("flip: sync request failed: {e}");
                }
            });
        }
    });
}

fn serve(stream: &mut TcpStream, app: &AppHandle, core: &SharedCore) -> io::Result<()> {
    stream.set_read_timeout(Some(TIMEOUT))?;
    stream.set_write_timeout(Some(TIMEOUT))?;
    let (method, target, body) = match read_request(stream) {
        Ok(parts) => parts,
        Err(e) => {
            let _ = respond(stream, "400 Bad Request", "text/plain", "Bad request.");
            return Err(e);
        }
    };
    let (path, query) = match target.split_once('?') {
        Some((path, query)) => (path, query),
        None => (target.as_str(), ""),
    };
    match path {
        "/flip/ping" => {
            let body = serde_json::json!({
                "app": "flip",
                "name": device_name(),
                "version": env!("CARGO_PKG_VERSION"),
            })
            .to_string();
            respond(stream, "200 OK", "application/json", &body)
        }
        "/flip/sync" => {
            let ours = lock(core).settings.sync_code.clone();
            if !ours.is_empty() && !code_matches(query, &ours) {
                return respond(stream, "403 Forbidden", "text/plain", WRONG_CODE);
            }
            if method != "POST" {
                return respond(stream, "405 Method Not Allowed", "text/plain", "Use POST.");
            }
            match merge(app, core, &body) {
                Ok(json) => respond(stream, "200 OK", "application/json", &json),
                Err(message) => respond(stream, "400 Bad Request", "text/plain", &message),
            }
        }
        _ => respond(stream, "404 Not Found", "text/plain", "Not Flip."),
    }
}

/// Answers "who has code 482913?" on the local network, so the other device
/// never has to be told an address. Only a matching code gets an answer.
pub fn spawn_finder(core: SharedCore) {
    spawn_finder_on(core, FIND_PORT);
}

fn spawn_finder_on(core: SharedCore, port: u16) {
    std::thread::spawn(move || {
        let socket = match UdpSocket::bind(("0.0.0.0", port)) {
            Ok(socket) => socket,
            Err(e) => {
                eprintln!("flip: sync lookup is off: {e}");
                return;
            }
        };
        let mut buffer = [0u8; 512];
        loop {
            let Ok((n, from)) = socket.recv_from(&mut buffer) else {
                continue;
            };
            let text = String::from_utf8_lossy(&buffer[..n]).to_string();
            let Some(asked) = text.trim().strip_prefix("FLIP-FIND ") else {
                continue;
            };
            let ours = lock(&core).settings.sync_code.clone();
            if asked.trim() != ours {
                continue;
            }
            let reply = format!("FLIP-HERE {ours} {PORT} {}", device_name());
            let _ = socket.send_to(reply.as_bytes(), from);
        }
    });
}

/// Takes the other device's board and answers with the one both sides keep.
fn merge(app: &AppHandle, core: &SharedCore, body: &[u8]) -> Result<String, String> {
    let mut incoming: Board =
        serde_json::from_slice(body).map_err(|_| "That was not a Flip board.")?;
    incoming.sanitize();
    if apply_remote(core, incoming) {
        if let Err(e) = app.emit("board-changed", ()) {
            eprintln!("flip: could not emit board-changed: {e}");
        }
    }
    let c = lock(core);
    serde_json::to_string(&c.board).map_err(|e| e.to_string())
}

/// Keeps the incoming board when it is the newer copy, writes it and answers
/// whether anything changed. The old undo history belonged to a board that is
/// no longer here, so it goes with it.
pub fn apply_remote(core: &SharedCore, incoming: Board) -> bool {
    let mut c = lock(core);
    if !newer(&c.board, &incoming) {
        return false;
    }
    c.board = incoming;
    c.undo_stack.clear();
    c.redo_stack.clear();
    let path = c.board_path.clone();
    let saved = c.board.clone();
    drop(c);
    board::save(&path, &saved);
    true
}

/// `?code=482913` must carry exactly the host's code.
fn code_matches(query: &str, code: &str) -> bool {
    query.split('&').any(|pair| match pair.split_once('=') {
        Some(("code", value)) => value.trim() == code,
        _ => false,
    })
}

/* ------------------------------------------------------------------ client */

/// Asks the network for the device holding `code`. The answer's source address
/// is used directly, which is why no address is ever shown to anyone.
fn discover(code: &str) -> Option<(String, String)> {
    ask("255.255.255.255", FIND_PORT, code)
}

/// Sends one question and waits for the reply that carries the same code.
fn ask(target: &str, port: u16, code: &str) -> Option<(String, String)> {
    let socket = UdpSocket::bind(("0.0.0.0", 0)).ok()?;
    socket.set_broadcast(true).ok()?;
    socket.set_read_timeout(Some(FIND_WAIT)).ok()?;
    let question = format!("FLIP-FIND {code}");
    socket.send_to(question.as_bytes(), (target, port)).ok()?;
    let mut buffer = [0u8; 512];
    loop {
        let (n, from) = socket.recv_from(&mut buffer).ok()?;
        let text = String::from_utf8_lossy(&buffer[..n]).to_string();
        let mut parts = text.trim().splitn(4, ' ');
        if parts.next() != Some("FLIP-HERE") {
            continue;
        }
        if parts.next() != Some(code) {
            continue;
        }
        let port = parts.next().unwrap_or("").parse::<u16>().unwrap_or(PORT);
        let name = parts.next().unwrap_or("").trim().to_string();
        return Some((format!("{}:{port}", from.ip()), name));
    }
}

fn remember(code: &str, address: &str, name: &str) {
    if let Ok(mut peer) = PEER.lock() {
        *peer = Some(Peer {
            code: code.to_string(),
            address: address.to_string(),
            name: name.to_string(),
            at: Instant::now(),
        });
    }
}

fn forget(code: &str) {
    if let Ok(mut peer) = PEER.lock() {
        if peer.as_ref().is_some_and(|peer| peer.code == code) {
            *peer = None;
        }
    }
}

fn cached(code: &str) -> Option<(String, String)> {
    let peer = PEER.lock().ok()?;
    let peer = peer.as_ref()?;
    if peer.code != code || peer.at.elapsed() > CACHE_FOR {
        return None;
    }
    Some((peer.address.clone(), peer.name.clone()))
}

/// The address to talk to, from the short-lived cache or a fresh lookup.
fn resolve(code: &str) -> Result<(String, String), String> {
    if let Some(found) = cached(code) {
        return Ok(found);
    }
    let (address, name) = discover(code).ok_or_else(|| NO_ANSWER.to_string())?;
    remember(code, &address, &name);
    Ok((address, name))
}

/// One round trip: find the other device by its code, send this board, keep the
/// newer of the two answers.
pub fn sync_once(app: &AppHandle, core: &SharedCore) -> Result<SyncResult, String> {
    let code = lock(core).settings.peer_code.clone();
    if code.is_empty() {
        return Err(MISSING_CODE.to_string());
    }
    let body = {
        let c = lock(core);
        serde_json::to_string(&c.board).map_err(|e| e.to_string())?
    };
    let path = format!("/flip/sync?code={code}");
    let (mut address, mut name) = resolve(&code)?;
    let mut answer = post(&address, &path, &body);
    /* A stale cache is the one likely reason a known device stops answering. */
    if matches!(answer, Err(ref message) if message == UNREACHABLE) {
        forget(&code);
        let (fresh, fresh_name) = discover(&code).ok_or_else(|| UNREACHABLE.to_string())?;
        remember(&code, &fresh, &fresh_name);
        address = fresh;
        name = fresh_name;
        answer = post(&address, &path, &body);
    }
    let remote: Board = serde_json::from_str(&answer?)
        .map_err(|_| "That device did not answer like Flip.".to_string())?;
    if !apply_remote(core, remote) {
        return Ok(SyncResult::unchanged(name));
    }
    if let Err(e) = app.emit("board-changed", ()) {
        eprintln!("flip: could not emit board-changed: {e}");
    }
    Ok(SyncResult {
        changed: true,
        message: SYNCED.to_string(),
        name,
    })
}

fn post(host: &str, path: &str, body: &str) -> Result<String, String> {
    let mut stream = TcpStream::connect(host).map_err(|_| UNREACHABLE.to_string())?;
    stream
        .set_read_timeout(Some(TIMEOUT))
        .and_then(|_| stream.set_write_timeout(Some(TIMEOUT)))
        .map_err(|_| UNREACHABLE.to_string())?;
    let request = format!(
        "POST {path} HTTP/1.1\r\nHost: {host}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    stream
        .write_all(request.as_bytes())
        .map_err(|_| UNREACHABLE.to_string())?;
    let mut response = Vec::new();
    stream
        .read_to_end(&mut response)
        .map_err(|_| UNREACHABLE.to_string())?;
    let text = String::from_utf8_lossy(&response).to_string();
    let (head, rest) = text
        .split_once("\r\n\r\n")
        .ok_or_else(|| UNREACHABLE.to_string())?;
    let status = head.lines().next().unwrap_or("");
    if status.contains(" 200") {
        return Ok(rest.to_string());
    }
    if status.contains(" 403") {
        return Err(WRONG_CODE.to_string());
    }
    Err(UNREACHABLE.to_string())
}

fn respond(stream: &mut TcpStream, status: &str, kind: &str, body: &str) -> io::Result<()> {
    let head = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {kind}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    stream.write_all(head.as_bytes())?;
    stream.write_all(body.as_bytes())
}

fn read_request(stream: &mut TcpStream) -> io::Result<(String, String, Vec<u8>)> {
    let mut buffer = Vec::new();
    let mut chunk = [0u8; 4096];
    let mut end = None;
    while end.is_none() {
        let n = stream.read(&mut chunk)?;
        if n == 0 {
            break;
        }
        buffer.extend_from_slice(&chunk[..n]);
        if buffer.len() > MAX_HEAD {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "headers too large",
            ));
        }
        end = buffer
            .windows(4)
            .position(|window| window == b"\r\n\r\n")
            .map(|at| at + 4);
    }
    let end = end.ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "no headers"))?;
    let head = String::from_utf8_lossy(&buffer[..end]).to_string();
    let mut lines = head.lines();
    let first = lines.next().unwrap_or("");
    let mut parts = first.split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let target = parts.next().unwrap_or("/").to_string();
    let mut length = 0usize;
    for line in lines {
        if let Some((key, value)) = line.split_once(':') {
            if key.trim().eq_ignore_ascii_case("content-length") {
                length = value.trim().parse().unwrap_or(0);
            }
        }
    }
    if length > MAX_BODY {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "body too large"));
    }
    let mut body = buffer[end..].to_vec();
    while body.len() < length {
        let n = stream.read(&mut chunk)?;
        if n == 0 {
            break;
        }
        body.extend_from_slice(&chunk[..n]);
    }
    body.truncate(length.min(body.len()));
    Ok((method, target, body))
}

/* -------------------------------------------------------------------- watch */

/// Keeps the two boards level while both apps are open, a few seconds apart.
/// Nothing leaves the device until a code has been typed.
pub fn watch(app: AppHandle, core: SharedCore) {
    std::thread::spawn(move || {
        let mut ticks: u32 = 0;
        loop {
            std::thread::sleep(Duration::from_secs(2));
            ticks = ticks.wrapping_add(1);
            if !ticks.is_multiple_of(2) {
                continue;
            }
            let (code, auto) = {
                let c = lock(&core);
                (c.settings.peer_code.clone(), c.settings.sync_auto)
            };
            if code.is_empty() || !auto {
                continue;
            }
            let result = match sync_once(&app, &core) {
                Ok(result) => result,
                Err(message) => SyncResult::failed(&message),
            };
            if let Err(e) = app.emit("sync-status", &result) {
                eprintln!("flip: could not emit sync-status: {e}");
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stamped(ms: u64, by: &str) -> Board {
        Board {
            updated_ms: ms,
            updated_by: by.to_string(),
            ..Board::default()
        }
    }

    fn scratch_core(name: &str) -> (SharedCore, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!("flip-sync-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let core = crate::state::Core::new(
            crate::state::Mode::Clock,
            crate::timer::Timer::new(300),
            crate::settings::Settings::default(),
            dir.join("settings.json"),
            Board::default(),
            dir.join("board.json"),
        );
        (Arc::new(Mutex::new(core)), dir)
    }

    #[test]
    fn the_later_board_wins_and_a_tie_breaks_on_the_device_id() {
        assert!(newer(&stamped(10, "a"), &stamped(11, "a")));
        assert!(!newer(&stamped(11, "a"), &stamped(10, "a")));
        assert!(newer(&stamped(11, "a"), &stamped(11, "b")));
        assert!(!newer(&stamped(11, "b"), &stamped(11, "a")));
        assert!(!newer(&stamped(11, "a"), &stamped(11, "a")));
    }

    #[test]
    fn a_newer_board_is_adopted_and_an_older_one_is_left_alone() {
        let (core, dir) = scratch_core("adopt");

        let mut newer_board = Board {
            break_minutes: 42,
            ..Board::default()
        };
        newer_board.updated_ms = 5_000;
        newer_board.updated_by = "phone".into();
        assert!(apply_remote(&core, newer_board));
        assert_eq!(lock(&core).board.break_minutes, 42);
        /* The adopted board reached the disk, so a restart keeps it. */
        assert_eq!(board::load(&dir.join("board.json")).break_minutes, 42);

        let mut older_board = Board {
            break_minutes: 7,
            ..Board::default()
        };
        older_board.updated_ms = 4_000;
        assert!(!apply_remote(&core, older_board));
        assert_eq!(lock(&core).board.break_minutes, 42);

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// The real socket path, both halves: the request one device writes is the
    /// request the other one reads, and the answer comes back intact.
    #[test]
    fn a_request_and_a_response_travel_over_a_socket() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let (method, target, body) = read_request(&mut stream).unwrap();
            assert_eq!(method, "POST");
            assert_eq!(target, "/flip/sync?code=482913");
            assert_eq!(body, b"{\"x\":1}".to_vec());
            respond(&mut stream, "200 OK", "application/json", "{\"ok\":true}").unwrap();
        });

        let answer = post(
            &format!("127.0.0.1:{port}"),
            "/flip/sync?code=482913",
            "{\"x\":1}",
        )
        .expect("the answer comes back");
        assert_eq!(answer, "{\"ok\":true}");
        server.join().unwrap();
    }

    /// The code lookup a phone relies on: the device holding the code answers,
    /// and a device holding a different one stays quiet.
    #[test]
    fn the_finder_answers_only_the_matching_code() {
        let (core, dir) = scratch_core("finder");
        lock(&core).settings.sync_code = "482913".into();
        spawn_finder_on(Arc::clone(&core), 47899);
        std::thread::sleep(Duration::from_millis(150));

        let (address, name) = ask("127.0.0.1", 47899, "482913").expect("an answer from the host");
        assert!(address.starts_with("127.0.0.1:"), "address was {address}");
        assert!(!name.is_empty());
        assert!(ask("127.0.0.1", 47899, "000000").is_none());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_code_has_to_match_exactly() {
        assert!(code_matches("code=482913", "482913"));
        assert!(code_matches("x=1&code=482913", "482913"));
        assert!(!code_matches("code=482914", "482913"));
        assert!(!code_matches("", "482913"));
        assert!(!code_matches("nocode=482913", "482913"));
    }

    #[test]
    fn a_found_device_is_reused_for_a_while_and_dropped_on_request() {
        remember("111111", "10.0.0.9:47821", "NAUTILL");
        assert_eq!(
            cached("111111"),
            Some(("10.0.0.9:47821".to_string(), "NAUTILL".to_string()))
        );
        /* Another code never reuses that answer. */
        assert_eq!(cached("222222"), None);
        forget("222222");
        assert!(cached("111111").is_some());
        forget("111111");
        assert_eq!(cached("111111"), None);
    }
}
