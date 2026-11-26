use serde::Serialize;
use std::collections::HashMap;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

pub const METRICS_PROBE_CMD: &str = r#"
echo "===HOST==="; hostname 2>/dev/null; uname -sr 2>/dev/null; cat /proc/uptime 2>/dev/null || echo "0 0"
echo "===CPU==="; head -n 1 /proc/stat 2>/dev/null; nproc 2>/dev/null || echo 1; cat /proc/loadavg 2>/dev/null || echo "0 0 0"
echo "===MEM==="; grep -E '^(MemTotal|MemFree|MemAvailable|Buffers|Cached|SwapTotal|SwapFree):' /proc/meminfo 2>/dev/null
echo "===NET==="; cat /proc/net/dev 2>/dev/null
echo "===DISK==="; df -P -B1 2>/dev/null | tail -n +2
echo "===PROC==="; ps -eo pid,user,%cpu,rss,comm --sort=-%cpu 2>/dev/null | head -n 11
"#;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CpuMetrics {
    pub usage_percent: f64,
    pub cores: u32,
    pub load_avg: [f64; 3],
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryMetrics {
    pub total_bytes: u64,
    pub used_bytes: u64,
    pub free_bytes: u64,
    pub swap_total_bytes: u64,
    pub swap_used_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkInterfaceMetrics {
    pub interface_name: String,
    pub rx_bytes_per_sec: u64,
    pub tx_bytes_per_sec: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskMetrics {
    pub filesystem: String,
    pub mount_point: String,
    pub total_bytes: u64,
    pub used_bytes: u64,
    pub available_bytes: u64,
    pub use_percent: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessMetrics {
    pub pid: u32,
    pub user: String,
    pub cpu_percent: f64,
    pub mem_bytes: u64,
    pub command: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemMetrics {
    pub timestamp: u64,
    pub hostname: String,
    pub os_name: String,
    pub uptime_seconds: u64,
    pub cpu: CpuMetrics,
    pub memory: MemoryMetrics,
    pub network: Vec<NetworkInterfaceMetrics>,
    pub disks: Vec<DiskMetrics>,
    pub top_processes: Vec<ProcessMetrics>,
}

#[derive(Default)]
pub struct MetricsTracker {
    prev_cpu: Option<(u64, u64)>,
    prev_net: HashMap<String, (u64, u64, Instant)>,
}

impl MetricsTracker {
    pub fn parse(&mut self, raw: &str) -> SystemMetrics {
        let mut sections: HashMap<&str, Vec<&str>> = HashMap::new();
        let mut current = "";

        for line in raw.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("===") && trimmed.ends_with("===") && trimmed.len() > 6 {
                current = &trimmed[3..trimmed.len() - 3];
                sections.entry(current).or_default();
            } else if !current.is_empty() && !trimmed.is_empty() {
                sections.entry(current).or_default().push(trimmed);
            }
        }

        // HOST
        let host_lines = sections.get("HOST").map(|v| v.as_slice()).unwrap_or(&[]);
        let hostname = host_lines.first().copied().unwrap_or("unknown").to_string();
        let os_name = host_lines.get(1).copied().unwrap_or("Linux").to_string();
        let uptime_seconds = host_lines
            .get(2)
            .and_then(|l| l.split_whitespace().next())
            .and_then(|s| s.parse::<f64>().ok())
            .unwrap_or(0.0) as u64;

        // CPU
        let cpu_lines = sections.get("CPU").map(|v| v.as_slice()).unwrap_or(&[]);
        let mut usage_percent = 0.0;
        if let Some(stat_line) = cpu_lines.first().filter(|l| l.starts_with("cpu ")) {
            let nums: Vec<u64> = stat_line
                .split_whitespace()
                .skip(1)
                .filter_map(|s| s.parse::<u64>().ok())
                .collect();
            if nums.len() >= 4 {
                let idle = nums[3] + nums.get(4).copied().unwrap_or(0);
                let total: u64 = nums.iter().sum();
                if let Some((prev_total, prev_idle)) = self.prev_cpu {
                    let dt = total.saturating_sub(prev_total);
                    let di = idle.saturating_sub(prev_idle);
                    if dt > 0 {
                        usage_percent = ((dt.saturating_sub(di)) as f64 / dt as f64) * 100.0;
                    }
                }
                self.prev_cpu = Some((total, idle));
            }
        }
        let cores = cpu_lines
            .get(1)
            .and_then(|s| s.parse::<u32>().ok())
            .unwrap_or(1);
        let load_parts: Vec<f64> = cpu_lines
            .get(2)
            .map(|l| {
                l.split_whitespace()
                    .take(3)
                    .filter_map(|s| s.parse::<f64>().ok())
                    .collect()
            })
            .unwrap_or_default();
        let load_avg = [
            load_parts.first().copied().unwrap_or(0.0),
            load_parts.get(1).copied().unwrap_or(0.0),
            load_parts.get(2).copied().unwrap_or(0.0),
        ];

        // MEM
        let mem_lines = sections.get("MEM").map(|v| v.as_slice()).unwrap_or(&[]);
        let mut mem_map: HashMap<&str, u64> = HashMap::new();
        for l in mem_lines {
            let mut parts = l.split_whitespace();
            if let (Some(k), Some(v)) = (parts.next(), parts.next()) {
                if let Ok(kb) = v.parse::<u64>() {
                    mem_map.insert(k.trim_end_matches(':'), kb * 1024);
                }
            }
        }
        let total_bytes = mem_map.get("MemTotal").copied().unwrap_or(0);
        let avail_bytes = mem_map
            .get("MemAvailable")
            .copied()
            .unwrap_or_else(|| {
                mem_map.get("MemFree").copied().unwrap_or(0)
                    + mem_map.get("Buffers").copied().unwrap_or(0)
                    + mem_map.get("Cached").copied().unwrap_or(0)
            });
        let used_bytes = total_bytes.saturating_sub(avail_bytes);
        let swap_total_bytes = mem_map.get("SwapTotal").copied().unwrap_or(0);
        let swap_free_bytes = mem_map.get("SwapFree").copied().unwrap_or(0);
        let swap_used_bytes = swap_total_bytes.saturating_sub(swap_free_bytes);

        // NET
        let net_lines = sections.get("NET").map(|v| v.as_slice()).unwrap_or(&[]);
        let now = Instant::now();
        let mut network = Vec::new();
        for l in net_lines {
            if let Some((iface, rest)) = l.split_once(':') {
                let iface = iface.trim();
                let cols: Vec<u64> = rest
                    .split_whitespace()
                    .filter_map(|s| s.parse::<u64>().ok())
                    .collect();
                if cols.len() >= 9 {
                    let rx = cols[0];
                    let tx = cols[8];
                    let (mut rx_rate, mut tx_rate) = (0u64, 0u64);
                    if let Some((prev_rx, prev_tx, prev_t)) = self.prev_net.get(iface) {
                        let secs = now.duration_since(*prev_t).as_secs_f64();
                        if secs > 0.1 {
                            rx_rate = ((rx.saturating_sub(*prev_rx)) as f64 / secs) as u64;
                            tx_rate = ((tx.saturating_sub(*prev_tx)) as f64 / secs) as u64;
                        }
                    }
                    self.prev_net.insert(iface.to_string(), (rx, tx, now));
                    network.push(NetworkInterfaceMetrics {
                        interface_name: iface.to_string(),
                        rx_bytes_per_sec: rx_rate,
                        tx_bytes_per_sec: tx_rate,
                    });
                }
            }
        }

        // DISK
        let disk_lines = sections.get("DISK").map(|v| v.as_slice()).unwrap_or(&[]);
        let mut disks = Vec::new();
        for l in disk_lines {
            let cols: Vec<&str> = l.split_whitespace().collect();
            if cols.len() >= 6 {
                let fs = cols[0];
                if fs == "tmpfs" || fs == "devtmpfs" || fs == "overlay" {
                    continue;
                }
                let total = cols[1].parse::<u64>().unwrap_or(0);
                let used = cols[2].parse::<u64>().unwrap_or(0);
                let avail = cols[3].parse::<u64>().unwrap_or(0);
                let pct = cols[4].trim_end_matches('%').parse::<f64>().unwrap_or(0.0);
                let mount = cols[5..].join(" ");
                disks.push(DiskMetrics {
                    filesystem: fs.to_string(),
                    mount_point: mount,
                    total_bytes: total,
                    used_bytes: used,
                    available_bytes: avail,
                    use_percent: pct,
                });
            }
        }

        // PROC
        let proc_lines = sections.get("PROC").map(|v| v.as_slice()).unwrap_or(&[]);
        let mut top_processes = Vec::new();
        for l in proc_lines.iter().skip(1) {
            let cols: Vec<&str> = l.split_whitespace().collect();
            if cols.len() >= 5 {
                let pid = cols[0].parse::<u32>().unwrap_or(0);
                let user = cols[1].to_string();
                let cpu_percent = cols[2].parse::<f64>().unwrap_or(0.0);
                let rss_kb = cols[3].parse::<u64>().unwrap_or(0);
                let command = cols[4..].join(" ");
                if command == "ps" {
                    continue;
                }
                top_processes.push(ProcessMetrics {
                    pid,
                    user,
                    cpu_percent,
                    mem_bytes: rss_kb * 1024,
                    command,
                });
            }
        }

        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        SystemMetrics {
            timestamp,
            hostname,
            os_name,
            uptime_seconds,
            cpu: CpuMetrics {
                usage_percent: (usage_percent * 10.0).round() / 10.0,
                cores,
                load_avg,
            },
            memory: MemoryMetrics {
                total_bytes,
                used_bytes,
                free_bytes: avail_bytes,
                swap_total_bytes,
                swap_used_bytes,
            },
            network,
            disks,
            top_processes,
        }
    }
}
