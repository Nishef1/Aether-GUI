use serde::Serialize;

#[derive(Serialize, Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct TrafficStats {
    pub received_bytes: u64,
    pub sent_bytes: u64,
}

pub fn current(interface_name: &str) -> Option<TrafficStats> {
    #[cfg(windows)]
    {
        return windows_current(interface_name);
    }
    #[cfg(target_os = "linux")]
    {
        return linux_current(interface_name);
    }
    #[cfg(target_os = "macos")]
    {
        return macos_current(interface_name);
    }
    #[allow(unreachable_code)]
    None
}

#[cfg(windows)]
fn windows_current(interface_name: &str) -> Option<TrafficStats> {
    use std::ptr::{null_mut, slice_from_raw_parts};
    use windows_sys::Win32::NetworkManagement::IpHelper::{
        FreeMibTable, GetIfTable2, MIB_IF_TABLE2,
    };

    let mut table: *mut MIB_IF_TABLE2 = null_mut();
    if unsafe { GetIfTable2(&mut table) } != 0 || table.is_null() {
        return None;
    }
    let stats = unsafe {
        let table_ref = &*table;
        let rows = &*slice_from_raw_parts(table_ref.Table.as_ptr(), table_ref.NumEntries as usize);
        rows.iter()
            .find(|row| {
                let length = row
                    .Alias
                    .iter()
                    .position(|character| *character == 0)
                    .unwrap_or(row.Alias.len());
                String::from_utf16_lossy(&row.Alias[..length]) == interface_name
            })
            .map(|row| TrafficStats {
                received_bytes: row.InOctets,
                sent_bytes: row.OutOctets,
            })
    };
    unsafe { FreeMibTable(table.cast()) };
    stats
}

#[cfg(target_os = "linux")]
fn linux_current(interface_name: &str) -> Option<TrafficStats> {
    let Ok(content) = std::fs::read_to_string("/proc/net/dev") else {
        return None;
    };
    content.lines().find_map(|line| {
        let (interface, values) = line.split_once(':')?;
        if interface.trim() != interface_name {
            return None;
        }
        let values = values
            .split_whitespace()
            .map(str::parse::<u64>)
            .collect::<Result<Vec<_>, _>>()
            .ok()?;
        Some(TrafficStats {
            received_bytes: *values.first()?,
            sent_bytes: *values.get(8)?,
        })
    })
}

#[cfg(target_os = "macos")]
fn macos_current(interface_name: &str) -> Option<TrafficStats> {
    let output = std::process::Command::new("netstat")
        .args(["-ibn", "-I", interface_name])
        .output();
    let Ok(output) = output else {
        return None;
    };
    let text = String::from_utf8_lossy(&output.stdout);
    let mut lines = text.lines();
    let Some(header) = lines.find(|line| line.split_whitespace().any(|field| field == "Ibytes"))
    else {
        return None;
    };
    let columns = header.split_whitespace().collect::<Vec<_>>();
    let Some(received_index) = columns.iter().position(|field| *field == "Ibytes") else {
        return None;
    };
    let Some(sent_index) = columns.iter().position(|field| *field == "Obytes") else {
        return None;
    };

    lines
        .filter_map(|line| {
            let values = line.split_whitespace().collect::<Vec<_>>();
            if values.first().copied()? != interface_name {
                return None;
            }
            Some(TrafficStats {
                received_bytes: values.get(received_index)?.parse().ok()?,
                sent_bytes: values.get(sent_index)?.parse().ok()?,
            })
        })
        .max_by_key(|stats| stats.received_bytes.saturating_add(stats.sent_bytes))
}
