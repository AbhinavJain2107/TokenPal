import { spawn, execSync } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const overlayDist = path.join(rootDir, 'packages/overlay/dist/main.js');

const possibleElectronPaths = [
  path.join(rootDir, 'packages/overlay/node_modules/.bin/electron'),
  path.join(rootDir, 'node_modules/.bin/electron'),
  path.join(rootDir, 'node_modules/.pnpm/electron@33.4.11/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
];
const electronCmd = possibleElectronPaths.find(p => fs.existsSync(p)) || 'electron';

console.log('='.repeat(70));
console.log(' TokenPal Overlay Resource Measurement');
console.log(' Measuring CPU (%) and RSS (MB) across 3 states:');
console.log('   1. Mascot Visible (active 18 fps animation)');
console.log('   2. Mascot Hidden (faded-out, animation stopped)');
console.log('   3. Low-Power Mode (animation throttled/paused)');
console.log('='.repeat(70));

const child = spawn(electronCmd, [overlayDist], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: {
    ...process.env,
    TOKENPAL_PARENT_PID: process.pid.toString()
  }
});

let isExiting = false;
function cleanup() {
  if (isExiting) return;
  isExiting = true;
  try {
    child.kill('SIGTERM');
  } catch {}
}
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('exit', cleanup);

await new Promise((r) => setTimeout(r, 3000));

function getAllPids(rootPid) {
  const pids = [rootPid];
  try {
    const out = execSync(`pgrep -P ${rootPid}`, { encoding: 'utf-8' });
    const lines = out.trim().split('\n').map((l) => parseInt(l.trim(), 10)).filter(Boolean);
    for (const p of lines) {
      pids.push(...getAllPids(p));
    }
  } catch {}
  return [...new Set(pids)];
}

function sampleMetrics(pids) {
  if (pids.length === 0) return { cpu: 0, rssMb: 0 };
  const pidArgs = pids.map((p) => `-pid ${p}`).join(' ');
  try {
    const topOut = execSync(`top -l 2 -stats pid,cpu,rsize ${pidArgs}`, { encoding: 'utf-8' });
    const blocks = topOut.split('Processes:');
    const targetBlock = blocks.length >= 3 ? blocks[blocks.length - 1] : topOut;

    let totalCpu = 0;
    let totalRssMb = 0;

    for (const line of targetBlock.split('\n')) {
      const match = line.trim().match(/^(\d+)\s+([\d\.]+)\s+([\d\.]+)([KMGkmg]?)\+?/);
      if (match) {
        const cpu = parseFloat(match[2]);
        const memVal = parseFloat(match[3]);
        const unit = (match[4] || '').toUpperCase();
        let memMb = memVal;
        if (unit === 'K') memMb = memVal / 1024;
        else if (unit === 'G') memMb = memVal * 1024;
        else if (unit === 'M') memMb = memVal;
        else memMb = memVal / (1024 * 1024);

        totalCpu += cpu;
        totalRssMb += memMb;
      }
    }
    return { cpu: totalCpu, rssMb: totalRssMb };
  } catch {
    return { cpu: 0, rssMb: 0 };
  }
}

async function measureState(stateName, durationSec) {
  console.log(`\n>>> Measuring: ${stateName} (${durationSec} seconds)...`);
  const samples = [];
  const start = Date.now();
  const end = start + durationSec * 1000;

  while (Date.now() < end) {
    const pids = getAllPids(child.pid);
    const m = sampleMetrics(pids);
    if (m.rssMb > 0) {
      samples.push(m);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }

  const cpus = samples.map((s) => s.cpu);
  const mems = samples.map((s) => s.rssMb);

  const avgCpu = cpus.length ? (cpus.reduce((a, b) => a + b, 0) / cpus.length).toFixed(1) : '0.0';
  const maxCpu = cpus.length ? Math.max(...cpus).toFixed(1) : '0.0';
  const minCpu = cpus.length ? Math.min(...cpus).toFixed(1) : '0.0';

  const avgMem = mems.length ? (mems.reduce((a, b) => a + b, 0) / mems.length).toFixed(1) : '0.0';
  const maxMem = mems.length ? Math.max(...mems).toFixed(1) : '0.0';
  const minMem = mems.length ? Math.min(...mems).toFixed(1) : '0.0';

  console.log(`   CPU (% instantaneous) : Min ${minCpu}%, Avg ${avgCpu}%, Max ${maxCpu}%`);
  console.log(`   Memory (RSS MB total)  : Min ${minMem} MB, Avg ${avgMem} MB, Max ${maxMem} MB`);
  return { avgCpu, maxCpu, minCpu, avgMem, maxMem, minMem, samplesCount: samples.length };
}

// 1. Visible Mode (18 fps active animation)
child.stdin.write(JSON.stringify({
  type: 'SHOW_ALERT',
  payload: {
    state: 'green',
    animationOverride: 'walk',
    meter: { usedPercent: 24, timeToResetFormatted: '5d', planType: 'prolite' }
  }
}) + '\n');
const visibleStats = await measureState('1. Visible (18 FPS active)', 10);

// 2. Hidden Mode (frontmost app switch / faded-out, animation stopped)
child.stdin.write(JSON.stringify({
  type: 'SET_VISIBILITY',
  payload: { visible: false }
}) + '\n');
const hiddenStats = await measureState('2. Hidden (Animation stopped)', 10);

// 3. Low-Power Mode (throttled/paused)
child.stdin.write(JSON.stringify({
  type: 'SET_LOW_POWER',
  payload: { enabled: true }
}) + '\n');
const lowPowerStats = await measureState('3. Low-Power Mode', 10);

cleanup();

console.log('\n' + '='.repeat(70));
console.log(' SUMMARY TABLE: OVERLAY RESOURCE PROFILE');
console.log('='.repeat(70));
console.log(' State             | Avg CPU (%) | Max CPU (%) | Avg RSS (MB) | Max RSS (MB)');
console.log('-'.repeat(70));
console.log(` Visible (18 FPS)  | ${visibleStats.avgCpu.padStart(10)}% | ${visibleStats.maxCpu.padStart(10)}% | ${visibleStats.avgMem.padStart(11)} MB | ${visibleStats.maxMem.padStart(11)} MB`);
console.log(` Hidden            | ${hiddenStats.avgCpu.padStart(10)}% | ${hiddenStats.maxCpu.padStart(10)}% | ${hiddenStats.avgMem.padStart(11)} MB | ${hiddenStats.maxMem.padStart(11)} MB`);
console.log(` Low-Power Mode    | ${lowPowerStats.avgCpu.padStart(10)}% | ${lowPowerStats.maxCpu.padStart(10)}% | ${lowPowerStats.avgMem.padStart(11)} MB | ${lowPowerStats.maxMem.padStart(11)} MB`);
console.log('='.repeat(70) + '\n');
process.exit(0);
