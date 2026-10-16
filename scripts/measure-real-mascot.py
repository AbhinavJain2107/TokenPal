#!/usr/bin/env python3
import subprocess
import time
import os
import sys
import json
import re

def parse_top_output(top_text):
    # Find all occurrences of the table header
    lines = top_text.split('\n')
    # Use the last sample's table (the second sample in top -l 2)
    header_indices = [i for i, line in enumerate(lines) if 'PID' in line and '%CPU' in line]
    if not header_indices:
        return 0.0, 0.0

    last_header_idx = header_indices[-1]
    total_cpu = 0.0
    total_rss_mb = 0.0

    for line in lines[last_header_idx + 1:]:
        m = re.match(r"^\s*(\d+)\s+([\d\.]+)\s+([\d\.]+)([KMGkmg]?)\+?", line)
        if m:
            try:
                cpu = float(m.group(2))
                val = float(m.group(3))
                unit = m.group(4).upper()
                if unit == 'K':
                    mem_mb = val / 1024.0
                elif unit == 'G':
                    mem_mb = val * 1024.0
                elif unit == 'M':
                    mem_mb = val
                else:
                    mem_mb = val / (1024.0 * 1024.0)
                total_cpu += cpu
                total_rss_mb += mem_mb
            except Exception:
                pass
    return total_cpu, total_rss_mb

def main():
    duration = int(sys.argv[1]) if len(sys.argv) > 1 else 30
    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    overlay_entry = os.path.join(repo_root, 'packages/overlay/dist/main.js')

    print(f"=== Measuring Real Mascot Overlay and Watcher for {duration} seconds ===")
    print(f"Overlay Entry: {overlay_entry}")

    env = os.environ.copy()
    env["TOKENPAL_OVERLAY_INITIAL"] = json.dumps({
        "state": "red",
        "rule": "context_growth",
        "reason": "Context is 5.1x initial (125,405 tokens)",
        "advice": "Start fresh with handoff",
        "contextTokens": 125405,
        "turnCount": 4,
        "model": "gpt-6-astra"
    })

    # Start overlay
    print("Launching real Electron mascot overlay...")
    overlay_proc = subprocess.Popen(
        ["npx", "--yes", "electron", overlay_entry],
        cwd=repo_root,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True
    )

    # Start tokenpal watch in background
    cli_entry = os.path.join(repo_root, 'packages/cli/dist/index.js')
    print("Launching 'tokenpal watch' process...")
    watch_proc = subprocess.Popen(
        ["node", cli_entry, "watch", "--no-ui"],
        cwd=repo_root,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True
    )

    time.sleep(5) # Let processes initialize and animation start

    electron_samples_cpu = []
    electron_samples_rss = []
    watch_samples_rss = []
    fps_logs = []

    start_time = time.time()
    end_time = start_time + duration

    try:
        while time.time() < end_time:
            # Find all Electron PIDs
            res = subprocess.run(["pgrep", "-P", str(overlay_proc.pid)], capture_output=True, text=True)
            child_pids = res.stdout.strip().split()
            all_electron_pids = [str(overlay_proc.pid)] + child_pids

            for cpid in list(child_pids):
                sub_res = subprocess.run(["pgrep", "-P", cpid], capture_output=True, text=True)
                for scpid in sub_res.stdout.strip().split():
                    if scpid and scpid not in all_electron_pids:
                        all_electron_pids.append(scpid)

            # Build top command for electron processes using one method: top -l 2 -stats pid,cpu,rsize
            top_args = ["top", "-l", "2", "-stats", "pid,cpu,rsize"]
            for p in all_electron_pids:
                top_args.extend(["-pid", p])

            top_run = subprocess.run(top_args, capture_output=True, text=True)
            cpu, rss = parse_top_output(top_run.stdout)
            electron_samples_cpu.append(cpu)
            electron_samples_rss.append(rss)

            # Measure watch process memory using the same top method
            watch_run = subprocess.run(["top", "-l", "2", "-stats", "pid,cpu,rsize", "-pid", str(watch_proc.pid)], capture_output=True, text=True)
            w_cpu, watch_rss = parse_top_output(watch_run.stdout)
            watch_samples_rss.append(watch_rss)

            print(f"Sample @ {int(time.time() - start_time)}s: Electron Total CPU={cpu:.1f}%, Total RSS={rss:.1f} MB (Across {len(all_electron_pids)} processes) | Watcher RSS={watch_rss:.1f} MB")
            time.sleep(5)

    finally:
        print("\nStopping processes...")
        try:
            overlay_proc.terminate()
            overlay_proc.kill()
        except:
            pass
        try:
            watch_proc.terminate()
            watch_proc.kill()
        except:
            pass

    print("\n=== SUMMARY OF REAL MASCOT OVERLAY & WATCHER MEASUREMENT ===")
    print(f"Total Duration: {duration} seconds")
    if electron_samples_cpu:
        print(f"Electron Overlay Instantaneous CPU (% summed across all processes): Min={min(electron_samples_cpu):.1f}%, Avg={sum(electron_samples_cpu)/len(electron_samples_cpu):.1f}%, Max={max(electron_samples_cpu):.1f}%")
        print(f"Electron Overlay Total RSS (MB summed across all processes):        Min={min(electron_samples_rss):.1f} MB, Avg={sum(electron_samples_rss)/len(electron_samples_rss):.1f} MB, Max={max(electron_samples_rss):.1f} MB")
    if watch_samples_rss:
        print(f"TokenPal Watcher Process RSS (MB):                                  Min={min(watch_samples_rss):.1f} MB, Avg={sum(watch_samples_rss)/len(watch_samples_rss):.1f} MB, Max={max(watch_samples_rss):.1f} MB")

if __name__ == '__main__':
    main()
