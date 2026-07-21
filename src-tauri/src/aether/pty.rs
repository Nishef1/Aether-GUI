use super::profiles::ConnectionProfile;
use super::prompts::{looks_like_choice_prompt, PROMPT_TABLE};
use crate::error::AetherError;
use crate::events::{now_millis, LogEvent};
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use std::collections::HashSet;
use std::io::{Read, Write};
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

    pub fn kill(&mut self) {
        // Only block in wait after the termination signal was accepted. If the
        // kill itself fails, waiting could otherwise block forever on a live child.
        if self.child.kill().is_ok() {
            let _ = self.child.wait();
        }
    }
}

fn read_cli_help(binary: &Path) -> Option<String> {
    let mut command = std::process::Command::new(binary);
    command.arg("--help");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let output = command.output().ok()?;
    if !output.status.success() {
        return None;
    }
    let mut help = String::from_utf8_lossy(&output.stdout).to_string();
    if !output.stderr.is_empty() {
        help.push('\n');
        help.push_str(&String::from_utf8_lossy(&output.stderr));
    }
    (!help.trim().is_empty()).then_some(help)
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
    let help = read_cli_help(binary);
    for argument in profile.as_args_for_help(help.as_deref()) {
        command.arg(argument);
    }
    command.env(
        "AETHER_MASQUE_HTTP2",
        if profile.masque_http2 { "1" } else { "0" },
    );

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
    let prompts_done = Arc::new(AtomicBool::new(false));
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

fn read_loop(
    reader: &mut dyn Read,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    profile: ConnectionProfile,
    log_tx: Sender<LogEvent>,
    prompts_done: Arc<AtomicBool>,
) {
    let mut answered: HashSet<&'static str> = HashSet::new();
    let mut current_section: Option<&'static str> = None;
    let mut line_buffer = String::new();
    let mut byte_buffer = [0u8; 4096];

    loop {
        let count = match reader.read(&mut byte_buffer) {
            Ok(0) | Err(_) => break,
            Ok(count) => count,
        };
        line_buffer.push_str(&String::from_utf8_lossy(&byte_buffer[..count]));

        for raw_line in drain_lines(&mut line_buffer) {
            let line = sanitize_terminal_output(&raw_line);
            if line.is_empty() {
                continue;
            }
            for rule in PROMPT_TABLE {
                if (rule.header_matches)(&line) {
                    current_section = Some(rule.id);
                    answered.remove(rule.id);
                }
            }
            let _ = log_tx.send(LogEvent {
                line,
                timestamp: now_millis(),
            });
        }

        let partial = sanitize_terminal_output(&line_buffer);
        if looks_like_choice_prompt(&partial)
            && !PROMPT_TABLE
                .iter()
                .any(|rule| (rule.header_matches)(&partial))
        {
            if let Some(section) = current_section {
                if !answered.contains(section) {
                    if let Some(rule) = PROMPT_TABLE.iter().find(|rule| rule.id == section) {
                        let answer = (rule.answer)(&profile);
                        if let Ok(mut output) = writer.lock() {
                            let _ = output.write_all(answer.as_bytes());
                            let _ = output.write_all(b"\r\n");
                            let _ = output.flush();
                        }
                        let _ = log_tx.send(LogEvent {
                            line: format!("[gui] answered {section} → {answer}"),
                            timestamp: now_millis(),
                        });
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

fn drain_lines(buffer: &mut String) -> Vec<String> {
    let mut lines = Vec::new();
    while let Some(position) = buffer.find(['\r', '\n']) {
        let end = if buffer.as_bytes()[position] == b'\n' {
            position
        } else {
            let mut run_end = position;
            while run_end < buffer.len() && buffer.as_bytes()[run_end] == b'\r' {
                run_end += 1;
            }
            if run_end == buffer.len() {
                break;
            }
            if buffer.as_bytes()[run_end] != b'\n' {
                buffer.drain(..run_end);
                continue;
            }
            run_end
        };
        let line: String = buffer.drain(..=end).collect();
        lines.push(line.trim_end_matches(['\r', '\n']).to_string());
    }
    if buffer.len() > MAX_PARTIAL {
        let mut cut = buffer.len() - MAX_PARTIAL;
        while !buffer.is_char_boundary(cut) {
            cut += 1;
        }
        buffer.drain(..cut);
    }
    lines
}

/// Strip terminal presentation/control sequences before they reach the WebView
/// or structured diagnostics. Aether runs inside a PTY, so it can emit both CSI
/// color sequences (`ESC [ ...`) and OSC title sequences (`ESC ] ... BEL/ST`).
/// Keeping this at the PTY boundary gives prompts, live logs and diagnostics the
/// same clean source of truth.
fn strip_terminal_sequences(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut characters = value.chars().peekable();

    while let Some(character) = characters.next() {
        if character == '\u{1b}' {
            match characters.peek().copied() {
                // CSI: ESC [ parameters/intermediates final-byte
                Some('[') => {
                    characters.next();
                    for escaped in characters.by_ref() {
                        if ('@'..='~').contains(&escaped) {
                            break;
                        }
                    }
                }
                // OSC: ESC ] payload BEL  OR  ESC ] payload ESC \
                Some(']') => {
                    characters.next();
                    let mut previous_escape = false;
                    for escaped in characters.by_ref() {
                        if escaped == '\u{7}' {
                            break;
                        }
                        if previous_escape && escaped == '\\' {
                            break;
                        }
                        previous_escape = escaped == '\u{1b}';
                    }
                }
                // Other short ESC sequences are presentation controls as well.
                Some(_) => {
                    characters.next();
                }
                None => {}
            }
            continue;
        }

        // Newlines are already consumed by drain_lines. Drop the remaining C0
        // controls (BEL, NUL, etc.) while preserving tabs and all printable Unicode.
        if character.is_control() && character != '\t' {
            continue;
        }
        output.push(character);
    }

    output
}

fn normalize_timestamp_level_spacing(mut value: String) -> String {
    // Some Rust log formatters place ANSI style boundaries between the RFC3339
    // timestamp and level without a literal space. Once styling is stripped this
    // becomes `...ZINFO`. Make only that narrow, predictable boundary readable.
    for level in ["TRACE", "DEBUG", "INFO", "WARN", "ERROR"] {
        let needle = format!("Z{level}");
        if let Some(index) = value.find(&needle) {
            value.insert(index + 1, ' ');
            break;
        }
    }
    value
}

fn sanitize_terminal_output(value: &str) -> String {
    normalize_timestamp_level_spacing(strip_terminal_sequences(value))
        .trim()
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn feed(buffer: &mut String, chunk: &str) -> Vec<String> {
        buffer.push_str(chunk);
        drain_lines(buffer)
    }

    #[test]
    fn plain_newlines() {
        let mut buffer = String::new();
        assert_eq!(feed(&mut buffer, "a\nb\nc"), ["a", "b"]);
        assert_eq!(buffer, "c");
    }

    #[test]
    fn crlf_and_double_cr() {
        let mut buffer = String::new();
        assert_eq!(feed(&mut buffer, "a\r\nb\r\r\n"), ["a", "b"]);
        assert_eq!(buffer, "");
    }

    #[test]
    fn cr_overwrite_drops_spinner_frames() {
        let mut buffer = String::new();
        assert_eq!(
            feed(&mut buffer, "scan 1%\rscan 2%\rscan 3%"),
            Vec::<String>::new()
        );
        assert_eq!(buffer, "scan 3%");
        assert_eq!(feed(&mut buffer, "\rscan done\n"), ["scan done"]);
    }

    #[test]
    fn unterminated_tail_is_bounded() {
        let mut buffer = String::new();
        let large = "é".repeat(MAX_PARTIAL);
        assert_eq!(feed(&mut buffer, &large), Vec::<String>::new());
        assert!(buffer.len() <= MAX_PARTIAL + 1);
        assert!(buffer.chars().all(|character| character == 'é'));
    }

    #[test]
    fn strips_csi_colors_without_damaging_text() {
        assert_eq!(
            sanitize_terminal_output("\u{1b}[31mERROR\u{1b}[0m café"),
            "ERROR café"
        );
    }

    #[test]
    fn strips_osc_window_title_sequences() {
        assert_eq!(
            sanitize_terminal_output("\u{1b}]0;C:\\Users\\PC\\aether.exe\u{7}"),
            ""
        );
        assert_eq!(
            sanitize_terminal_output("before\u{1b}]0;title\u{1b}\\after"),
            "beforeafter"
        );
    }

    #[test]
    fn normalizes_level_spacing_after_ansi_removal() {
        assert_eq!(
            sanitize_terminal_output("[2026-07-21T14:37:46.285Z\u{1b}[32mINFO\u{1b}[0m  aether]"),
            "[2026-07-21T14:37:46.285Z INFO  aether]"
        );
    }
}
