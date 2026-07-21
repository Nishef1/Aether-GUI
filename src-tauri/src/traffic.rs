use serde::Serialize;

#[derive(Serialize, Clone, Copy, Debug, Default)]
pub struct TrafficStats {
    pub received_bytes: u64,
    pub sent_bytes: u64,
}

const TUN_INTERFACE_NAME: &str = "aether-tun";

pub fn current() -> TrafficStats {
    #[cfg(windows)]
    {
        return windows_current();
    }
    #[cfg(unix)]
    {
        return unix_current();
    }
    #[allow(unreachable_code)]
    TrafficStats::default()
}

#[cfg(windows)]
fn windows_current() -> TrafficStats {
    use std::ptr::{null_mut, slice_from_raw_parts};
    use windows_sys::Win32::NetworkManagement::IpHelper::{
        FreeMibTable, GetIfTable2, MIB_IF_TABLE2,
    };

    let mut table: *mut MIB_IF_TABLE2 = null_mut();
    if unsafe { GetIfTable2(&mut table) } != 0 || table.is_null() {
        return TrafficStats::default();
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
                String::from_utf16_lossy(&row.Alias[..length]) == TUN_INTERFACE_NAME
            })
            .map(|row| TrafficStats {
                // The OS reports counters from the interface perspective:
                // incoming octets are downloads, outgoing octets are uploads.
                received_bytes: row.InOctets,
                sent_bytes: row.OutOctets,
            })
            .unwrap_or_default()
    };
    unsafe { FreeMibTable(table.cast()) };
    stats
}

#[cfg(unix)]
fn unix_current() -> TrafficStats {
    let Ok(content) = std::fs::read_to_string("/proc/net/dev") else {
        return TrafficStats::default();
    };
    content
        .lines()
        .filter_map(|line| {
            let (interface, values) = line.split_once(':')?;
            if interface.trim() != TUN_INTERFACE_NAME {
                return None;
            }
            let values = values
                .split_whitespace()
                .map(str::parse::<u64>)
                .collect::<Result<Vec<_>, _>>()?;
            Some(TrafficStats {
                // /proc/net/dev has receive bytes at index 0 and transmit
                // bytes at index 8.
                received_bytes: *values.first()?,
                sent_bytes: *values.get(8)?,
            })
        })
        .next()
        .unwrap_or_default()
}
