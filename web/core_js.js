/* core_js.js - hand-written JavaScript port of src/core.cpp.
   Same function names and results as the C++ core. The website uses it only when
   core.wasm has not been built yet (see README). No library code is used. */
function makeJsCore() {
  const MAX = 200;
  const EV = { INSERT: 1, HEAPIFY: 2, CMP: 3, SWAP: 4, EXTRACT: 5, REPLACE: 6, REMOVE: 7, DONE: 8 };
  const Q = [], RANK = [];
  for (let i = 0; i < MAX; i++) { Q.push({ head: null, tail: null, count: 0 }); RANK.push(i); }
  let TL = { head: null, tail: null, n: 0 };
  let RECEIVED = 0, ACTIVE = 0, ST = { ins: 0, ext: 0, cmp: 0 };
  let LOG = [], LOGIDX = [], EX = [], BENCH = [0, 0, 0, 0];
  let SP = null, SPcap = 0, SPf = 0, SPr = 0, SPn = 0;
  let seed = 0;

  const qPush = (q, job, time, dept) => {
    const n = { job, time, dept, next: null };
    if (q.tail) q.tail.next = n; else q.head = n;
    q.tail = n; q.count++;
  };
  const qRemove = (q, job) => {
    let prev = null, cur = q.head;
    while (cur) {
      if (cur.job === job) {
        if (prev) prev.next = cur.next; else q.head = cur.next;
        if (cur === q.tail) q.tail = prev;
        q.count--; return true;
      }
      prev = cur; cur = cur.next;
    }
    return false;
  };
  const qClear = (q) => { q.head = q.tail = null; q.count = 0; };
  const tlFree = () => { TL = { head: null, tail: null, n: 0 }; };
  const tlPush = (job, time, dept) => {
    const n = { job, time, dept, next: null };
    if (TL.tail) TL.tail.next = n; else TL.head = n;
    TL.tail = n; TL.n++;
  };

  function newMerger(qs, rank, k, logOn, buildTL) {
    return { qs, rank, k, cur: new Array(MAX).fill(null), pos: new Array(MAX).fill(0),
             heap: new Array(MAX).fill(0), hn: 0, ins: 0, ext: 0, cmp: 0, logOn, buildTL };
  }
  function ev(m, type, a, b, c, d) {
    if (!m.logOn) return;
    LOGIDX.push(LOG.length);
    LOG.push(type, a, b, c, d, m.hn);
    for (let i = 0; i < m.hn; i++) { const x = m.cur[m.heap[i]]; LOG.push(m.heap[i], x.job, x.time); }
  }
  function before(m, x, y) {
    const p = m.cur[m.heap[x]], q = m.cur[m.heap[y]];
    m.cmp++;
    const tie = p.time === q.time;
    const r = tie ? m.rank[m.heap[x]] < m.rank[m.heap[y]] : p.time < q.time;
    ev(m, EV.CMP, x, y, r ? 1 : 0, tie ? 1 : 0);
    return r;
  }
  function siftDown(m, i) {
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      if (l >= m.hn) return;
      let c = l;
      if (r < m.hn && before(m, r, l)) c = r;
      if (!before(m, c, i)) return;
      const t = m.heap[c]; m.heap[c] = m.heap[i]; m.heap[i] = t;
      ev(m, EV.SWAP, i, c, 0, 0);
      i = c;
    }
  }
  function mergeRun(m) {
    m.hn = 0; m.ins = m.ext = m.cmp = 0;
    for (let d = 0; d < m.k; d++) {
      m.cur[d] = m.qs[d].head; m.pos[d] = 0;
      if (m.cur[d]) { m.heap[m.hn++] = d; m.ins++; ev(m, EV.INSERT, d, m.hn - 1, 0, 0); }
    }
    for (let i = (m.hn >> 1) - 1; i >= 0; i--) { ev(m, EV.HEAPIFY, i, 0, 0, 0); siftDown(m, i); }
    while (m.hn > 0) {
      const d = m.heap[0], n = m.cur[d];
      if (m.buildTL) tlPush(n.job, n.time, d);
      ev(m, EV.EXTRACT, d, n.job, n.time, m.ext);
      m.ext++;
      if (n.next) {
        m.cur[d] = n.next; m.pos[d]++; m.ins++;
        ev(m, EV.REPLACE, d, m.pos[d], n.next.job, n.next.time);
      } else {
        m.cur[d] = null; m.hn--; m.heap[0] = m.heap[m.hn];
        ev(m, EV.REMOVE, d, m.qs[d].count, 0, 0);
      }
      if (m.hn > 1) siftDown(m, 0);
    }
    ev(m, EV.DONE, 0, 0, 0, 0);
  }
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed >>> 8; };

  return {
    name: 'JavaScript port',
    init() {
      for (let d = 0; d < MAX; d++) { qClear(Q[d]); RANK[d] = d; }
      tlFree(); LOG = []; LOGIDX = []; EX = [];
      RECEIVED = ACTIVE = 0; ST = { ins: 0, ext: 0, cmp: 0 };
    },
    set_rank(d, r) { if (d >= 0 && d < MAX) RANK[d] = r; },
    add_job(d, time, job) {
      if (d < 0 || d >= MAX) return 2;
      if (time < 0) return 3;
      if (Q[d].tail && time < Q[d].tail.time) return 1;
      qPush(Q[d], job, time, d); return 0;
    },
    delete_job(d, job) { return (d >= 0 && d < MAX && qRemove(Q[d], job)) ? 1 : 0; },
    clear_queue(d) { if (d >= 0 && d < MAX) qClear(Q[d]); },
    q_count(d) { return (d >= 0 && d < MAX) ? Q[d].count : 0; },
    export_queue(d) {
      EX = [];
      if (d < 0 || d >= MAX) return 0;
      for (let p = Q[d].head; p; p = p.next) EX.push(p.job, p.time, p.dept);
      return Q[d].count;
    },
    export_timeline() { EX = []; for (let p = TL.head; p; p = p.next) EX.push(p.job, p.time, p.dept); return TL.n; },
    exp_job(i) { return (i >= 0 && 3 * i < EX.length) ? EX[3 * i] : -1; },
    exp_time(i) { return (i >= 0 && 3 * i < EX.length) ? EX[3 * i + 1] : -1; },
    exp_dept(i) { return (i >= 0 && 3 * i < EX.length) ? EX[3 * i + 2] : -1; },
    merge(logOn) {
      tlFree(); LOG = []; LOGIDX = [];
      const m = newMerger(Q, RANK, MAX, logOn !== 0, true);
      RECEIVED = ACTIVE = 0;
      for (let d = 0; d < MAX; d++) { RECEIVED += Q[d].count; if (Q[d].count) ACTIVE++; }
      mergeRun(m);
      ST = { ins: m.ins, ext: m.ext, cmp: m.cmp };
      return TL.n;
    },
    tl_len() { return TL.n; },
    stat(i) { return [RECEIVED, TL.n, ST.ins, ST.ext, ST.cmp, ACTIVE][i] || 0; },
    verify_timeline() {
      if (TL.n !== RECEIVED) return 0;
      for (let p = TL.head; p && p.next; p = p.next) {
        const q = p.next;
        if (p.time > q.time) return 0;
        if (p.time === q.time) {
          if (p.dept !== q.dept) { if (RANK[p.dept] > RANK[q.dept]) return 0; }
          else if (p.job > q.job) return 0;
        }
      }
      return 1;
    },
    log_len() { return LOGIDX.length; },
    log_field(i, f) {
      if (i < 0 || i >= LOGIDX.length) return -1;
      const idx = LOGIDX[i] + f;
      return idx < LOG.length ? LOG[idx] : -1;
    },
    spool_init(cap) {
      if (cap < 1) cap = 1;
      SP = new Array(cap).fill(-1); SPcap = cap; SPf = SPr = SPn = 0;
    },
    spool_enqueue(job) {
      if (!SP || SPn === SPcap) return 0;
      SP[SPr] = job; SPr = (SPr + 1) % SPcap; SPn++; return 1;
    },
    spool_dequeue() {
      if (!SP || SPn === 0) return -1;
      const j = SP[SPf]; SP[SPf] = -1; SPf = (SPf + 1) % SPcap; SPn--; return j;
    },
    spool_size() { return SPn; }, spool_front() { return SPf; }, spool_rear() { return SPr; },
    spool_cap() { return SPcap; },
    spool_slot(i) { return (SP && i >= 0 && i < SPcap) ? SP[i] : -1; },
    bench(k, n) {
      if (k < 1 || k > MAX || n < 0) return 0;
      const qs = [], ranks = [], last = [];
      for (let d = 0; d < k; d++) { qs.push({ head: null, tail: null, count: 0 }); ranks.push(d); last.push(0); }
      seed = 12345;
      for (let j = 0; j < n; j++) {
        const d = rnd() % k;
        last[d] += rnd() % 4;
        qPush(qs[d], j, last[d], d);
      }
      const m = newMerger(qs, ranks, k, false, false);
      mergeRun(m);
      BENCH[0] = m.cmp; BENCH[2] = m.ins; BENCH[3] = m.ext;
      const cur = qs.map((q) => q.head); let cmp = 0;
      for (;;) {
        let best = -1;
        for (let d = 0; d < k; d++) {
          if (!cur[d]) continue;
          if (best < 0) { best = d; continue; }
          cmp++;
          if (cur[d].time < cur[best].time) best = d;
        }
        if (best < 0) break;
        cur[best] = cur[best].next;
      }
      BENCH[1] = cmp; return 1;
    },
    bench_stat(i) { return (i >= 0 && i < 4) ? BENCH[i] : 0; },
    // Day-1 stubs
    job_exists(job) { return 0; },
    job_dept(job) { return -1; },
    job_time(job) { return -1; },
    set_duration(job, dur) { return 1; },
    get_duration(job) { return -1; },
    add_job_raw(d, time, job) {
      if (d < 0 || d >= MAX) return 2;
      if (time < 0) return 3;
      qPush(Q[d], job, time, d); return 0;
    },
    sort_queue(d) { return (d < 0 || d >= MAX) ? -1 : Q[d].count; },
    is_sorted(d) { return 1; },
    undo() { return 0; },
    redo() { return 0; },
    undo_count() { return 0; },
    redo_count() { return 0; },
    op_field(f) { return -1; },
    merge_lt(logOn) { return this.merge(0); },
    merge_naive() { return this.merge(0); },
    tl_job(i) { return -1; },
    tl_time(i) { return -1; },
    tl_dept(i) { return -1; },
    tl_lower_bound(t) { return 0; },
    tl_upper_bound(t) { return 0; },
    find_in_timeline(job) { return -1; },
    sched_run(printers) { return -1; },
    sched_count() { return 0; },
    sched_job(i) { return -1; },
    sched_printer(i) { return -1; },
    sched_start(i) { return -1; },
    sched_end(i) { return -1; },
    sched_load(p) { return 0; },
    spool_cancel(job) { return 0; },
    spool_pause(flag) {},
    spool_paused() { return 0; },
  };
}
if (typeof module !== 'undefined') module.exports = { makeJsCore };
