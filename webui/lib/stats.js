'use strict';

const fs = require('fs');
const os = require('os');

// Reads the container's own CPU/RAM usage from cgroup (v2, with a v1 fallback)
// and keeps a short rolling history for charting.

const HISTORY = []; // { t, cpu (0-100), memMB, memMax (MB|null) }
const MAX_POINTS = 120; // ~10 min at 5s
const numCpus = os.cpus().length || 1;

let last = null; // { usageUsec, wallUs }

function readNum(path) {
  try {
    return parseInt(fs.readFileSync(path, 'utf8').trim(), 10);
  } catch {
    return null;
  }
}

function readCpuUsageUsec() {
  // cgroup v2
  try {
    const stat = fs.readFileSync('/sys/fs/cgroup/cpu.stat', 'utf8');
    const m = stat.match(/usage_usec\s+(\d+)/);
    if (m) return parseInt(m[1], 10);
  } catch {
    /* fall through */
  }
  // cgroup v1 (nanoseconds → microseconds)
  const ns = readNum('/sys/fs/cgroup/cpuacct/cpuacct.usage') || readNum('/sys/fs/cgroup/cpu/cpuacct.usage');
  return ns != null ? Math.floor(ns / 1000) : null;
}

function readMem() {
  // cgroup v2
  let cur = readNum('/sys/fs/cgroup/memory.current');
  let max = null;
  try {
    const raw = fs.readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim();
    max = raw === 'max' ? null : parseInt(raw, 10);
  } catch {
    /* v1 fallback below */
  }
  if (cur == null) {
    // cgroup v1
    cur = readNum('/sys/fs/cgroup/memory/memory.usage_in_bytes');
    const lim = readNum('/sys/fs/cgroup/memory/memory.limit_in_bytes');
    // v1 reports a huge sentinel when unlimited
    max = lim && lim < 1 << 62 ? lim : null;
  }
  // If no cgroup limit, fall back to host total as the ceiling for %.
  if (max == null) max = os.totalmem();
  return { cur, max };
}

function sample() {
  const nowUs = Date.now() * 1000;
  const usageUsec = readCpuUsageUsec();
  let cpu = 0;
  if (usageUsec != null && last) {
    const dCpu = usageUsec - last.usageUsec;
    const dWall = nowUs - last.wallUs;
    if (dWall > 0) cpu = Math.max(0, Math.min(100, (dCpu / (dWall * numCpus)) * 100));
  }
  if (usageUsec != null) last = { usageUsec, wallUs: nowUs };

  const { cur, max } = readMem();
  HISTORY.push({
    t: Date.now(),
    cpu: Math.round(cpu * 10) / 10,
    memMB: cur != null ? Math.round(cur / 1048576) : null,
    memMax: max != null ? Math.round(max / 1048576) : null
  });
  while (HISTORY.length > MAX_POINTS) HISTORY.shift();
}

let timer = null;
function start() {
  if (timer) return;
  sample();
  timer = setInterval(sample, 5000);
  if (timer.unref) timer.unref();
}

function history() {
  return HISTORY.slice();
}

function current() {
  return HISTORY[HISTORY.length - 1] || null;
}

module.exports = { start, history, current, numCpus };
