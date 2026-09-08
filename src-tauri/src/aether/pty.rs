use super::orphan;
use super::profiles::{ConnectionProfile, ZeroTrustAuth};
use super::prompts::{looks_like_choice_prompt, PROMPT_TABLE};
use crate::error::AetherError;
use crate::events::{now_millis, should_forward_log, LogEvent};
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use std::collections::HashSet;
use std::io::{Read, Write};
use std::net::SocketAddr;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};

pub struct PtySession {
    child: Box<dyn Child + Send + Sync>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    prompts_done: Arc<AtomicBool>,
    _master: Box<dyn MasterPty + Send>,
}

impl PtySession {
    pub fn pid(&self) -> u32 {
        self.child.process_id().unwrap_or(0)
    }

    pub fn prompts_done(&self) -> bool {
        self.prompts_done.load(Ordering::Relaxed)
    }

    pub fn try_wait(&mut self) -> Option<portable_pty::ExitStatus> {
        self.child.try_wait().ok().flatten()
    }

    pub fn send_ctrl_c(&self) {
        if let Ok(mut writer) = self.writer.lock() {
            let _ = writer.write_all(&[0x03]);
            let _ = writer.flush();
        }
    }

    pub fn send_access_code(&self, code: &str) -> Result<(), AetherError> {
        let code = code.trim();
        if code.is_empty() || code.len() > 512 || code.contains(['\r', '\n']) {
            return Err(AetherError::Internal(
                "invalid Zero Trust access code".into(),
            ));
        }
        let mut writer = self
            .writer
            .lock()
            .map_err(|_| AetherError::Internal("Aether input is unavailable".into()))?;
        writer
            .write_all(code.as_bytes())
            .and_then(|_| writer.write_all(b"\r\n"))
            .and_then(|_| writer.flush())
            .map_err(|error| {
                AetherError::Internal(format!("sending Zero Trust access code: {error}"))
            })
    }

    pub fn kill(&mut self) {
        orphan::terminate_process_tree(self.pid());
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

pub fn spawn(
    binary: &Path,
    cwd: &Path,
    profile: ConnectionProfile,
    log_tx: Sender<LogEvent>,
) -> Result<PtySession, AetherError> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 40,
            cols: 120,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| AetherError::SpawnFailed(error.to_string()))?;

    let mut command = CommandBuilder::new(binary);
    command.cwd(cwd);
    for arg in profile.as_args() {
        command.arg(arg);
    }

    command.env(
        "AETHER_MASQUE_HTTP2",
        if profile.masque_http2 { "1" } else { "0" },
    );
    command.env(
        "AETHER_ROUTE_SNIFF",
        if profile.route_sniff { "1" } else { "0" },
    );
    command.env(
        "AETHER_ROUTE_SNIFF_MS",
        profile.route_sniff_ms.clamp(50, 5_000).to_string(),
    );
    command.env(
        "AETHER_REPROVISION",
        if profile.auto_reprovision { "1" } else { "0" },
    );
    if !profile.upstream.trim().is_empty() {
        // Upstream URLs may contain credentials. Keep them out of argv/process
        // listings and out of the persisted successful profile.
        command.env("AETHER_UPSTREAM", profile.upstream.trim());
    }

    match profile.zero_trust_auth {
        ZeroTrustAuth::Service
            if !profile.access_client_id.trim().is_empty()
                && !profile.access_client_secret.trim().is_empty() =>
        {
            command.env("AETHER_ACCESS_CLIENT_ID", profile.access_client_id.trim());
            command.env(
                "AETHER_ACCESS_CLIENT_SECRET",
                profile.access_client_secret.trim(),
            );
        }
        _ => {
            if let Some((key, value)) = profile.zero_trust_env() {
                command.env(key, value);
            }
        }
    }

    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| AetherError::SpawnFailed(error.to_string()))?;
    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| AetherError::SpawnFailed(error.to_string()))?;
    let raw_writer = pair
        .master
        .take_writer()
        .map_err(|error| AetherError::SpawnFailed(error.to_string()))?;
    let writer = Arc::new(Mutex::new(raw_writer));
    let writer_for_thread = Arc::clone(&writer);

    // Aether 1.9 GUI launches are fully specified by CLI flags/environment.
    // Interactive setup menus are a compatibility fallback only, so the
    // route-search UI must not wait for prompts that normally never appear.
    let prompts_done = Arc::new(AtomicBool::new(true));
    let prompts_done_for_thread = Arc::clone(&prompts_done);

    std::thread::spawn(move || {
        read_loop(
            reader.as_mut(),
            writer_for_thread,
            profile,
            log_tx,
            prompts_done_for_thread,
        );
    });

    Ok(PtySession {
        child,
        writer,
        prompts_done,
        _master: pair.master,
    })
}

fn forward_log(log_tx: &Sender<LogEvent>, line: String) {
    if !should_forward_log(&line) {
        return;
    }
    let _ = log_tx.send(LogEvent {
        line,
        timestamp: now_millis(),
    });
}

fn endpoint_token(text: &str) -> Option<&str> {
    let endpoint = text.split_whitespace().next()?.trim();
    endpoint.parse::<SocketAddr>().ok()?;
    Some(endpoint)
}

fn selected_path_marker(line: &str, profile: &ConnectionProfile) -> Option<String> {
    if let Some((_, rest)) = line.split_once("selected MASQUE gateway ") {
        let endpoint = endpoint_token(rest)?;
        let transport = if profile.masque_http2 { "h2" } else { "h3" };
        return Some(format!(
            "[gui] path selected transport={transport} endpoint={endpoint}"
        ));
    }

    if let Some((_, rest)) = line.split_once("selected WireGuard endpoint ") {
        let endpoint = endpoint_token(rest)?;
        return Some(format!(
            "[gui] path selected transport=wg endpoint={endpoint}"
        ));
    }

    if let Some((_, rest)) = line.split_once("using cloudflare edge ") {
        let (outer, inner_rest) = rest.split_once(" (outer) and ")?;
        let inner = inner_rest.split_once(" (inner)")?.0.trim();
        let outer = outer.trim();
        outer.parse::<SocketAddr>().ok()?;
        inner.parse::<SocketAddr>().ok()?;
        return Some(format!(
            "[gui] path selected transport=gool endpoint={outer}>{inner}"
        ));
    }

    None
}

fn read_loop(
    reader: &mut dyn Read,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    profile: ConnectionProfile,
    log_tx: Sender<LogEvent>,
    prompts_done: Arc<AtomicBool>,
) {
    let mut answered: HashSet<&'static str> = HashSet::new();
    let mut current_section: Option<&'static str> = None;
    let mut line_buf = String::new();
    let mut byte_buf = [0u8; 4096];
    let mut code_prompt_visible = false;

    loop {
        let read = match reader.read(&mut byte_buf) {
            Ok(0) => break,
            Ok(read) => read,
            Err(_) => break,
        };
        line_buf.push_str(&String::from_utf8_lossy(&byte_buf[..read]));

        for raw_line in drain_lines(&mut line_buf) {
            let line = strip_terminal_sequences(&raw_line);
            if line.is_empty() {
                continue;
            }
            for rule in PROMPT_TABLE {
                if (rule.header_matches)(&line) {
                    current_section = Some(rule.id);
                    answered.remove(rule.id);
                }
            }
            if let Some(marker) = selected_path_marker(&line, &profile) {
                forward_log(&log_tx, marker);
            }
            forward_log(&log_tx, line);
        }

        let partial = strip_terminal_sequences(&line_buf);
        let access_code_prompt = partial.contains("Enter the code:");
        if access_code_prompt && !code_prompt_visible {
            forward_log(
                &log_tx,
                "[gui] Zero Trust access code required".into(),
            );
        }
        code_prompt_visible = access_code_prompt;
        if looks_like_choice_prompt(&partial)
            && !PROMPT_TABLE
                .iter()
                .any(|rule| (rule.header_matches)(&partial))
        {
            if let Some(section) = current_section {
                if !answered.contains(section) {
                    if let Some(rule) = PROMPT_TABLE.iter().find(|rule| rule.id == section) {
                        let answer = (rule.answer)(&profile);
                        if let Ok(mut writer) = writer.lock() {
                            let _ = writer.write_all(answer.as_bytes());
                            let _ = writer.write_all(b"\r\n");
                            let _ = writer.flush();
                        }
                        forward_log(&log_tx, format!("[gui] answered {section} → {answer}"));
                        answered.insert(section);
                        if answered.len() == PROMPT_TABLE.len() {
                            prompts_done.store(true, Ordering::Relaxed);
                        }
                    }
                }
            }
        }
    }
}

const MAX_PARTIAL: usize = 16 * 1024;

fn drain_lines(buf: &mut String) -> Vec<String> {
    let mut lines = Vec::new();
    while let Some(pos) = buf.find(['\r', '\n']) {
        let end = if buf.as_bytes()[pos] == b'\n' {
            pos
        } else {
            let mut run_end = pos;
            while run_end < buf.len() && buf.as_bytes()[run_end] == b'\r' {
                run_end += 1;
            }
            if run_end == buf.len() {
                break;
            }
            if buf.as_bytes()[run_end] != b'\n' {
                buf.drain(..run_end);
                continue;
            }
            run_end
        };
        let line: String = buf.drain(..=end).collect();
        lines.push(line.trim_end_matches(['\r', '\n']).to_string());
    }
    if buf.len() > MAX_PARTIAL {
        let mut cut = buf.len() - MAX_PARTIAL;
        while !buf.is_char_boundary(cut) {
            cut += 1;
        }
        buf.drain(..cut);
    }
    lines
}

fn strip_terminal_sequences(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();

    while let Some(character) = chars.next() {
        if character != '\u{1b}' {
            if !character.is_control() || character == '\t' {
                output.push(character);
            }
            continue;
        }

        match chars.peek().copied() {
            Some('[') => {
                chars.next();
                for next in chars.by_ref() {
                    if ('@'..='~').contains(&next) {
                        break;
                    }
                }
            }
            Some(']') => {
                chars.next();
                let mut saw_escape = false;
                for next in chars.by_ref() {
                    if next == '\u{7}' || (saw_escape && next == '\\') {
                        break;
                    }
                    saw_escape = next == '\u{1b}';
                }
            }
            Some(_) => {
                chars.next();
            }
            None => {}
        }
    }

    output
}

#[cfg(test)]
mod tests {
    use super::*;

    fn feed(buf: &mut String, chunk: &str) -> Vec<String> {
        buf.push_str(chunk);
        drain_lines(buf)
    }

    #[test]
    fn plain_newlines() {
        let mut buf = String::new();
        assert_eq!(feed(&mut buf, "a\nb\nc"), ["a", "b"]);
        assert_eq!(buf, "c");
    }

    #[test]
    fn crlf_and_onlcr_double_cr() {
        let mut buf = String::new();
        assert_eq!(feed(&mut buf, "a\r\nb\r\r\n"), ["a", "b"]);
        assert_eq!(buf, "");
    }

    #[test]
    fn cr_overwrite_drops_spinner_frames() {
        let mut buf = String::new();
        assert_eq!(
            feed(&mut buf, "scan 1%\rscan 2%\rscan 3%"),
            Vec::<String>::new()
        );
        assert_eq!(buf, "scan 3%");
        assert_eq!(feed(&mut buf, "\rscan done\n"), ["scan done"]);
        assert_eq!(buf, "");
    }

    #[test]
    fn lone_cr_at_end_waits_for_possible_lf() {
        let mut buf = String::new();
        assert_eq!(feed(&mut buf, "abc\r"), Vec::<String>::new());
        assert_eq!(buf, "abc\r");
        assert_eq!(feed(&mut buf, "\n"), ["abc"]);
        assert_eq!(buf, "");
    }

    #[test]
    fn unterminated_tail_is_capped() {
        let mut buf = String::new();
        let big = "é".repeat(MAX_PARTIAL);
        assert_eq!(feed(&mut buf, &big), Vec::<String>::new());
        assert!(buf.len() <= MAX_PARTIAL + 1);
        assert!(buf.chars().all(|character| character == 'é'));
    }

    #[test]
    fn strips_csi_color_sequences() {
        assert_eq!(
            strip_terminal_sequences("[time] \u{1b}[32mINFO\u{1b}[0m aether"),
            "[time] INFO aether"
        );
    }

    #[test]
    fn strips_windows_terminal_title_osc() {
        assert_eq!(
            strip_terminal_sequences("\u{1b}]0;C:\\Users\\PC\\aether.exe\u{7}[time] INFO aether"),
            "[time] INFO aether"
        );
    }

    #[test]
    fn strips_osc_terminated_by_string_terminator() {
        assert_eq!(
            strip_terminal_sequences("\u{1b}]0;title\u{1b}\\ready"),
            "ready"
        );
    }
}
