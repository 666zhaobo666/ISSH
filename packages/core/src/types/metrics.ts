export interface CpuMetrics {
  usagePercent: number;
  cores: number;
  loadAvg: [number, number, number];
}

export interface MemoryMetrics {
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
  swapTotalBytes: number;
  swapUsedBytes: number;
}

export interface NetworkInterfaceMetrics {
  interfaceName: string;
  rxBytesPerSec: number;
  txBytesPerSec: number;
}

export interface DiskMetrics {
  filesystem: string;
  mountPoint: string;
  totalBytes: number;
  usedBytes: number;
  availableBytes: number;
  usePercent: number;
}

export interface ProcessMetrics {
  pid: number;
  user: string;
  cpuPercent: number;
  memBytes: number;
  command: string;
}

export interface SystemMetrics {
  timestamp: number;
  hostname: string;
  osName: string;
  uptimeSeconds: number;
  cpu: CpuMetrics;
  memory: MemoryMetrics;
  network: NetworkInterfaceMetrics[];
  disks: DiskMetrics[];
  topProcesses: ProcessMetrics[];
}
