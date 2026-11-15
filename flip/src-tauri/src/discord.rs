//! Optional Discord Rich Presence.
//!
//! Deliberately vague. A stranger looking at your Discord profile learns that
//! Flip is open and whether a timer is running, nothing else: no task titles,
//! no subject names, no study totals, no files. The feature is on by default
//! and one switch in Settings turns it off, which also closes the connection.
//!
//! Discord only accepts presence from a registered application, so the client
//! id below has to belong to a Discord app you own. Left empty, Flip never
//! opens the IPC socket at all.

use std::sync::mpsc::{self, Sender};
use std::thread;
use std::time::{Duration, Instant};

use discord_rich_presence::activity::{Activity, Button, Timestamps};
use discord_rich_presence::{DiscordIpc, DiscordIpcClient};

use crate::state::Snapshot;
use crate::timer::TimerState;

/// The Discord application that owns this presence. Create one at
/// <https://discord.com/developers/applications> (any name, no bot needed) and
/// paste its Application ID here.
pub const CLIENT_ID: &str = "";

/// The download page, offered as the one button on the presence card.
pub const DOWNLOAD_URL: &str = "https://projectflip.site.je";

/// Discord may not be running yet, so a failed connection is retried quietly.
const RETRY: Duration = Duration::from_secs(20);

/// What the presence should say. Built from the snapshot, so it never contains
/// anything the user typed.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Wanted {
    pub enabled: bool,
    pub running: bool,
    pub focus: bool,
    pub timer: bool,
}

impl Wanted {
    pub fn from_snapshot(snap: &Snapshot) -> Self {
        Self {
            enabled: snap.discord,
            running: matches!(snap.timer.state, TimerState::Running),
            focus: snap.focus_active,
            timer: matches!(snap.mode, crate::state::Mode::Timer),
        }
    }
}

/// Handle the ticker uses to nudge the worker. Cheap to clone and never blocks.
pub struct Presence {
    tx: Sender<Wanted>,
}

impl Presence {
    pub fn update(&self, wanted: Wanted) {
        let _ = self.tx.send(wanted);
    }
}

fn activity(wanted: &Wanted, since: Instant) -> Activity<'static> {
    let mut card = Activity::new();
    if wanted.running {
        card = if wanted.focus {
            card.details("Focus session").state("Timer running")
        } else {
            card.details("Timer").state("Running")
        };
        let started = chrono::Utc::now().timestamp_millis()
            - i64::try_from(since.elapsed().as_millis()).unwrap_or(0);
        card = card.timestamps(Timestamps::new().start(started));
    } else if wanted.timer {
        card = card.details("Timer").state("Idle");
    } else {
        card = card.details("Clock").state("Idle");
    }
    card.buttons(vec![Button::new("Download Flip", DOWNLOAD_URL)])
}

/// Starts the worker thread. It owns the connection, so nothing else has to
/// care whether Discord is installed, running, or closed halfway through.
pub fn spawn() -> Presence {
    let (tx, rx) = mpsc::channel::<Wanted>();

    thread::spawn(move || {
        let mut client: Option<DiscordIpcClient> = None;
        let mut shown: Option<Wanted> = None;
        let mut since = Instant::now();
        let mut last_try = Instant::now() - RETRY;

        /* The last request is kept so a quiet half second can still be used to
        retry a connection, without any wakeup of its own. */
        let mut current = Wanted::default();

        loop {
            match rx.recv_timeout(Duration::from_millis(500)) {
                Ok(next) => {
                    current = next;
                    while let Ok(newer) = rx.try_recv() {
                        current = newer;
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
            run(&mut client, &mut shown, &mut since, &mut last_try, current);
        }
    });

    Presence { tx }
}

/// Applies one request: connect when needed, drop the connection when the user
/// turns the feature off, and only send Discord something that changed.
fn run(
    client: &mut Option<DiscordIpcClient>,
    shown: &mut Option<Wanted>,
    since: &mut Instant,
    last_try: &mut Instant,
    wanted: Wanted,
) {
    if !wanted.enabled || CLIENT_ID.is_empty() {
        if let Some(mut open) = client.take() {
            let _ = open.close();
        }
        *shown = None;
        return;
    }

    if client.is_none() {
        if last_try.elapsed() < RETRY {
            return;
        }
        *last_try = Instant::now();
        let mut fresh = DiscordIpcClient::new(CLIENT_ID);
        match fresh.connect() {
            Ok(()) => {
                *client = Some(fresh);
                *shown = None;
            }
            Err(_) => return,
        }
    }

    if wanted.running && !shown.map(|last| last.running).unwrap_or(false) {
        *since = Instant::now();
    }
    if *shown == Some(wanted) {
        return;
    }

    if let Some(open) = client.as_mut() {
        if open.set_activity(activity(&wanted, *since)).is_ok() {
            *shown = Some(wanted);
        } else {
            /* The pipe usually died with Discord; reconnect on the next pass. */
            let _ = open.close();
            *client = None;
            *shown = None;
        }
    }
}
