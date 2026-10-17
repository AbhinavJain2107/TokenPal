export interface ProcessInfo {
  running: boolean;
  command?: string;
  uptimeSec?: number;
}

export type ProcessChecker = (pid: number) => ProcessInfo;

export type ProcessKiller = (pid: number, signal: NodeJS.Signals) => void;

export interface DaemonStatus {
  running: boolean;
  pid?: number;
  uptimeSec?: number;
  uptimeFormatted?: string;
  stalePidCleaned?: number;
}

export interface DaemonStartResult {
  started: boolean;
  pid?: number;
  alreadyRunning?: boolean;
  error?: string;
}

export interface DaemonStopResult {
  stopped: boolean;
  wasRunning: boolean;
  pid?: number;
  forced?: boolean;
}

export interface DaemonManagerOptions {
  rootDir?: string;
  pidFile?: string;
  logFile?: string;
  rotatedLogFile?: string;
  cliPath?: string;
  processChecker?: ProcessChecker;
  processKiller?: ProcessKiller;
  childProcessFinder?: (pid: number) => number[];
  onStalePid?: (pid: number, reason: string) => void;
}
