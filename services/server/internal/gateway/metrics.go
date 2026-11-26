package gateway

import (
	"strconv"
	"strings"
	"time"
)

const metricsProbeCmd = `echo "===HOST==="; hostname; echo "===OS==="; grep -m1 '^PRETTY_NAME=' /etc/os-release 2>/dev/null | cut -d= -f2- | tr -d '"' || uname -sr; echo "===UPTIME==="; cat /proc/uptime; echo "===CPU==="; head -n 1 /proc/stat; nproc; cat /proc/loadavg; echo "===MEM==="; cat /proc/meminfo; echo "===NET==="; cat /proc/net/dev; echo "===DISK==="; df -P -B1 2>/dev/null || df -P -k; echo "===PROC==="; ps -eo pid,user:20,%cpu,rss,args --sort=-%cpu 2>/dev/null | head -n 15`

type metricsTracker struct {
	prevCPUTotal uint64
	prevCPUIdle  uint64
	prevNet      map[string][2]uint64
	prevTime     time.Time
}

func newMetricsTracker() *metricsTracker {
	return &metricsTracker{prevNet: map[string][2]uint64{}}
}

func (mt *metricsTracker) parse(raw string) map[string]any {
	now := time.Now()
	dt := now.Sub(mt.prevTime).Seconds()
	if mt.prevTime.IsZero() || dt <= 0.05 {
		dt = 0
	}

	sections := map[string][]string{}
	cur := ""
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimRight(line, "\r")
		if strings.HasPrefix(line, "===") && strings.HasSuffix(line, "===") {
			cur = strings.Trim(line, "=")
			continue
		}
		if cur != "" {
			sections[cur] = append(sections[cur], line)
		}
	}

	hostname := ""
	if l := sections["HOST"]; len(l) > 0 {
		hostname = strings.TrimSpace(l[0])
	}
	osName := ""
	if l := sections["OS"]; len(l) > 0 {
		osName = strings.TrimSpace(l[0])
	}
	var uptimeSec uint64
	if l := sections["UPTIME"]; len(l) > 0 {
		fields := strings.Fields(l[0])
		if len(fields) > 0 {
			if f, err := strconv.ParseFloat(fields[0], 64); err == nil {
				uptimeSec = uint64(f)
			}
		}
	}

	// CPU
	var usagePercent float64
	cores := 1
	loadAvg := [3]float64{0, 0, 0}
	if cpuLines := sections["CPU"]; len(cpuLines) > 0 {
		for _, line := range cpuLines {
			if strings.HasPrefix(line, "cpu ") {
				fields := strings.Fields(line)
				var total, idle uint64
				for i := 1; i < len(fields); i++ {
					v, _ := strconv.ParseUint(fields[i], 10, 64)
					total += v
					if i == 4 || i == 5 {
						idle += v
					}
				}
				if mt.prevCPUTotal > 0 && total > mt.prevCPUTotal {
					dTotal := total - mt.prevCPUTotal
					dIdle := uint64(0)
					if idle > mt.prevCPUIdle {
						dIdle = idle - mt.prevCPUIdle
					}
					if dTotal > 0 {
						usagePercent = float64(dTotal-dIdle) / float64(dTotal) * 100.0
					}
				}
				mt.prevCPUTotal = total
				mt.prevCPUIdle = idle
			}
		}
		if len(cpuLines) >= 2 {
			if n, err := strconv.Atoi(strings.TrimSpace(cpuLines[1])); err == nil && n > 0 {
				cores = n
			}
		}
		if len(cpuLines) >= 3 {
			lf := strings.Fields(cpuLines[2])
			for i := 0; i < 3 && i < len(lf); i++ {
				loadAvg[i], _ = strconv.ParseFloat(lf[i], 64)
			}
		}
	}

	// Memory
	memMap := map[string]uint64{}
	for _, line := range sections["MEM"] {
		parts := strings.SplitN(line, ":", 2)
		if len(parts) != 2 {
			continue
		}
		key := strings.TrimSpace(parts[0])
		f := strings.Fields(parts[1])
		if len(f) > 0 {
			kb, _ := strconv.ParseUint(f[0], 10, 64)
			memMap[key] = kb * 1024
		}
	}
	memTotal := memMap["MemTotal"]
	memAvail := memMap["MemAvailable"]
	if memAvail == 0 {
		memAvail = memMap["MemFree"] + memMap["Buffers"] + memMap["Cached"]
	}
	memUsed := uint64(0)
	if memTotal > memAvail {
		memUsed = memTotal - memAvail
	}
	swapTotal := memMap["SwapTotal"]
	swapFree := memMap["SwapFree"]
	swapUsed := uint64(0)
	if swapTotal > swapFree {
		swapUsed = swapTotal - swapFree
	}

	// Network
	netOut := []map[string]any{}
	for _, line := range sections["NET"] {
		if !strings.Contains(line, ":") {
			continue
		}
		parts := strings.SplitN(line, ":", 2)
		iface := strings.TrimSpace(parts[0])
		if iface == "" || iface == "lo" {
			continue
		}
		f := strings.Fields(parts[1])
		if len(f) < 9 {
			continue
		}
		rx, _ := strconv.ParseUint(f[0], 10, 64)
		tx, _ := strconv.ParseUint(f[8], 10, 64)
		var rxRate, txRate float64
		if prev, ok := mt.prevNet[iface]; ok && dt > 0 {
			if rx >= prev[0] {
				rxRate = float64(rx-prev[0]) / dt
			}
			if tx >= prev[1] {
				txRate = float64(tx-prev[1]) / dt
			}
		}
		mt.prevNet[iface] = [2]uint64{rx, tx}
		netOut = append(netOut, map[string]any{
			"interfaceName": iface,
			"rxBytesPerSec": rxRate,
			"txBytesPerSec": txRate,
		})
	}
	mt.prevTime = now

	// Disks
	disks := []map[string]any{}
	for i, line := range sections["DISK"] {
		if i == 0 {
			continue
		}
		f := strings.Fields(line)
		if len(f) < 6 {
			continue
		}
		fs := f[0]
		if !strings.HasPrefix(fs, "/") {
			continue
		}
		totalB, _ := strconv.ParseUint(f[1], 10, 64)
		usedB, _ := strconv.ParseUint(f[2], 10, 64)
		availB, _ := strconv.ParseUint(f[3], 10, 64)
		pctStr := strings.TrimSuffix(f[4], "%")
		pct, _ := strconv.ParseFloat(pctStr, 64)
		disks = append(disks, map[string]any{
			"filesystem":     fs,
			"mountPoint":     f[5],
			"totalBytes":     totalB,
			"usedBytes":      usedB,
			"availableBytes": availB,
			"usePercent":     pct,
		})
	}

	// Top Processes (skip our own transient ps probe)
	procs := []map[string]any{}
	for i, line := range sections["PROC"] {
		if i == 0 {
			continue
		}
		f := strings.Fields(line)
		if len(f) < 5 {
			continue
		}
		cmd := strings.Join(f[4:], " ")
		if strings.Contains(cmd, "ps -eo pid,user") {
			continue
		}
		pid, _ := strconv.Atoi(f[0])
		cpuP, _ := strconv.ParseFloat(f[2], 64)
		rssKB, _ := strconv.ParseUint(f[3], 10, 64)
		procs = append(procs, map[string]any{
			"pid":        pid,
			"user":       f[1],
			"cpuPercent": cpuP,
			"memBytes":   rssKB * 1024,
			"command":    cmd,
		})
		if len(procs) >= 10 {
			break
		}
	}

	return map[string]any{
		"timestamp":     now.UnixMilli(),
		"hostname":      hostname,
		"osName":        osName,
		"uptimeSeconds": uptimeSec,
		"cpu": map[string]any{
			"usagePercent": usagePercent,
			"cores":        cores,
			"loadAvg":      loadAvg,
		},
		"memory": map[string]any{
			"totalBytes":     memTotal,
			"usedBytes":      memUsed,
			"freeBytes":      memAvail,
			"swapTotalBytes": swapTotal,
			"swapUsedBytes":  swapUsed,
		},
		"network":      netOut,
		"disks":        disks,
		"topProcesses": procs,
	}
}
