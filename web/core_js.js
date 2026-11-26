/* core_js.js - hand-written JavaScript port of src/core.cpp.
   Same function names and results as the C++ core. The website uses it only when
   core.wasm has not been built yet (see README). No library code is used. */
function makeJsCore() {
  const MAX = 200;
  const EV = { INSERT: 1, HEAPIFY: 2, CMP: 3, SWAP: 4, EXTRACT: 5, REPLACE: 6, REMOVE: 7, DONE: 8 };
  const Q = [], RANK = [];
  for (let i = 0; i < MAX; i++) { Q.push({ head: null, tail: null, count: 0 }); RANK.push(i); }
  let TL = { head: null, tail: null, n: 0 };
  let RECEIVED = 0, ACTIVE = 0, ST = { ins: 0, ext: 0, cmp: 0, alg: 0 };
  let LOG = [], LOGIDX = [], EX = [], BENCH = [0, 0, 0, 0, 0];
  let SP = null, SPcap = 0, SPf = 0, SPr = 0, SPn = 0;
  let seed = 0;

  // Hash table (A1)
  let HT_cap = 128, HT_n = 0;
  let HT_buckets = new Array(HT_cap).fill(null);
  function htHash(key, cap) {
    let x = key >>> 0;
    x = Math.imul((x >>> 16) ^ x, 0x45d9f3b) >>> 0;
    x = Math.imul((x >>> 16) ^ x, 0x45d9f3b) >>> 0;
    x = ((x >>> 16) ^ x) >>> 0;
    return x % cap;
  }
  function htInit(cap = 128) {
    HT_cap = cap; HT_n = 0;
    HT_buckets = new Array(HT_cap).fill(null);
  }
  function htRehash(newCap) {
    const nb = new Array(newCap).fill(null);
    for (let i = 0; i < HT_cap; i++) {
      let p = HT_buckets[i];
      while (p) {
        const nxt = p.next;
        const idx = htHash(p.job, newCap);
        p.next = nb[idx];
        nb[idx] = p;
        p = nxt;
      }
    }
    HT_buckets = nb;
    HT_cap = newCap;
  }
  function htFind(job) {
    const idx = htHash(job, HT_cap);
    for (let p = HT_buckets[idx]; p; p = p.next) {
      if (p.job === job) return p;
    }
    return null;
  }
  function htInsert(job, dept, time, dur = 1, prio = 0) {
    if ((HT_n + 1) * 10 > HT_cap * 7) htRehash(HT_cap * 2);
    const idx = htHash(job, HT_cap);
    HT_buckets[idx] = { job, dept, time, dur, tl_idx: -1, prio, next: HT_buckets[idx] };
    HT_n++;
  }
  function htRemove(job) {
    const idx = htHash(job, HT_cap);
    let prev = null, cur = HT_buckets[idx];
    while (cur) {
      if (cur.job === job) {
        if (prev) prev.next = cur.next; else HT_buckets[idx] = cur.next;
        HT_n--;
        return true;
      }
      prev = cur; cur = cur.next;
    }
    return false;
  }
  function htResetTl() {
    for (let i = 0; i < HT_cap; i++) {
      for (let p = HT_buckets[i]; p; p = p.next) p.tl_idx = -1;
    }
  }

  // Undo / redo stacks (A3)
  let UNDO_ST = [], REDO_ST = [];
  let LAST_OP = null;
  function recordOp(type, dept, job, time, dur, prio, pos) {
    UNDO_ST.push({ type, dept, job, time, dur, prio, pos });
    REDO_ST = [];
  }

  const qPush = (q, job, time, dept) => {
    const n = { job, time, dept, next: null };
    if (q.tail) q.tail.next = n; else q.head = n;
    q.tail = n; q.count++;
  };
  const qRemove = (q, job, out) => {
    let prev = null, cur = q.head, idx = 0;
    while (cur) {
      if (cur.job === job) {
        if (out) { out.pos = idx; out.time = cur.time; }
        if (prev) prev.next = cur.next; else q.head = cur.next;
        if (cur === q.tail) q.tail = prev;
        q.count--; return true;
      }
      prev = cur; cur = cur.next; idx++;
    }
    return false;
  };
  const qInsertAt = (q, pos, job, time, dept) => {
    const n = { job, time, dept, next: null };
    if (pos <= 0 || !q.head) {
      n.next = q.head; q.head = n;
      if (!q.tail) q.tail = n;
      q.count++; return;
    }
    let prev = q.head;
    for (let i = 0; i < pos - 1 && prev.next; i++) prev = prev.next;
    n.next = prev.next; prev.next = n;
    if (!n.next) q.tail = n;
    q.count++;
  };
  const qClear = (q) => { q.head = q.tail = null; q.count = 0; };

  // Linked list merge sort (A2)
  function llMerge(a, b) {
    const dummy = { job: 0, time: 0, dept: 0, next: null };
    let tail = dummy;
    while (a && b) {
      if (a.time <= b.time) { tail.next = a; a = a.next; }
      else { tail.next = b; b = b.next; }
      tail = tail.next;
    }
    tail.next = a ? a : b;
    return dummy.next;
  }
  function llMergesort(head) {
    if (!head || !head.next) return head;
    let slow = head, fast = head.next;
    while (fast && fast.next) { slow = slow.next; fast = fast.next.next; }
    const right = slow.next;
    slow.next = null;
    return llMerge(llMergesort(head), llMergesort(right));
  }
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

  // Loser tree merge (A4)
  function ltBefore(cur, ranks, a, b, st) {
    if (!cur[a]) return false;
    if (!cur[b]) return true;
    st.cmp++;
    if (cur[a].time !== cur[b].time) return cur[a].time < cur[b].time;
    return ranks[a] < ranks[b];
  }
  function mergeLtRun(qs, rank, k, buildTL) {
    const cur = new Array(k), ranks = new Array(k), origD = new Array(k);
    let m = 0;
    const st = { ins: 0, ext: 0, cmp: 0 };
    for (let d = 0; d < k; d++) {
      if (qs[d].head) {
        cur[m] = qs[d].head; ranks[m] = rank[d]; origD[m] = d; st.ins++; m++;
      }
    }
    if (m === 0) return st;
    if (m === 1) {
      for (let p = cur[0]; p; p = p.next) {
        if (buildTL) tlPush(p.job, p.time, origD[0]);
        st.ext++;
      }
      return st;
    }
    const ls = new Array(m), win = new Array(2 * m);
    for (let i = 0; i < m; i++) win[m + i] = i;
    for (let i = m - 1; i >= 1; i--) {
      const a = win[2 * i], b = win[2 * i + 1];
      if (ltBefore(cur, ranks, a, b, st)) { win[i] = a; ls[i] = b; }
      else { win[i] = b; ls[i] = a; }
    }
    ls[0] = win[1];
    while (cur[ls[0]]) {
      let s = ls[0];
      const n = cur[s];
      if (buildTL) tlPush(n.job, n.time, origD[s]);
      st.ext++;
      cur[s] = n.next;
      if (cur[s]) st.ins++;
      let t = (m + s) >> 1;
      while (t > 0) {
        if (ltBefore(cur, ranks, ls[t], s, st)) { const tmp = s; s = ls[t]; ls[t] = tmp; }
        t >>= 1;
      }
      ls[0] = s;
    }
    return st;
  }
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed >>> 8; };

  return {
    name: 'JavaScript port',
    init() {
      for (let d = 0; d < MAX; d++) { qClear(Q[d]); RANK[d] = d; }
      htInit(128);
      UNDO_ST = []; REDO_ST = []; LAST_OP = null;
      tlFree(); LOG = []; LOGIDX = []; EX = [];
      RECEIVED = ACTIVE = 0; ST = { ins: 0, ext: 0, cmp: 0, alg: 0 };
    },
    set_rank(d, r) { if (d >= 0 && d < MAX) RANK[d] = r; },
    add_job(d, time, job) {
      if (d < 0 || d >= MAX) return 2;
      if (time < 0) return 3;
      if (htFind(job)) return 4;
      if (Q[d].tail && time < Q[d].tail.time) return 1;
      const pos = Q[d].count;
      qPush(Q[d], job, time, d); htInsert(job, d, time);
      recordOp(1, d, job, time, 1, 0, pos);
      return 0;
    },
    delete_job(d, job) {
      if (d < 0 || d >= MAX) return 0;
      const e = htFind(job);
      const dur = e ? e.dur : 1, prio = e ? e.prio : 0;
      const out = { pos: 0, time: 0 };
      if (qRemove(Q[d], job, out)) {
        htRemove(job);
        recordOp(2, d, job, out.time, dur, prio, out.pos);
        return 1;
      }
      return 0;
    },
    clear_queue(d) {
      if (d >= 0 && d < MAX) {
        for (let p = Q[d].head; p; p = p.next) htRemove(p.job);
        qClear(Q[d]);
        UNDO_ST = []; REDO_ST = [];
      }
    },
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
      ST = { ins: m.ins, ext: m.ext, cmp: m.cmp, alg: 0 };
      return TL.n;
    },
    tl_len() { return TL.n; },
    stat(i) { return [RECEIVED, TL.n, ST.ins, ST.ext, ST.cmp, ACTIVE, ST.alg][i] || 0; },
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
      BENCH[1] = cmp;
      const ltSt = mergeLtRun(qs, ranks, k, false);
      BENCH[4] = ltSt.cmp;
      return 1;
    },
    bench_stat(i) { return (i >= 0 && i < 5) ? BENCH[i] : 0; },
    job_exists(job) { return htFind(job) ? 1 : 0; },
    job_dept(job) { const e = htFind(job); return e ? e.dept : -1; },
    job_time(job) { const e = htFind(job); return e ? e.time : -1; },
    set_duration(job, dur) {
      if (dur < 1) return 0;
      const e = htFind(job);
      if (!e) return 0;
      e.dur = dur; return 1;
    },
    get_duration(job) { const e = htFind(job); return e ? e.dur : -1; },
    add_job_raw(d, time, job) {
      if (d < 0 || d >= MAX) return 2;
      if (time < 0) return 3;
      if (htFind(job)) return 4;
      const pos = Q[d].count;
      qPush(Q[d], job, time, d); htInsert(job, d, time);
      recordOp(1, d, job, time, 1, 0, pos);
      return 0;
    },
    sort_queue(d) {
      if (d < 0 || d >= MAX) return -1;
      if (Q[d].head && Q[d].head.next) {
        Q[d].head = llMergesort(Q[d].head);
        let p = Q[d].head, cnt = 0, last = null;
        while (p) { last = p; cnt++; p = p.next; }
        Q[d].tail = last;
        Q[d].count = cnt;
      }
      return Q[d].count;
    },
    is_sorted(d) {
      if (d < 0 || d >= MAX) return 0;
      for (let p = Q[d].head; p && p.next; p = p.next) {
        if (p.time > p.next.time) return 0;
      }
      return 1;
    },
    undo() {
      if (UNDO_ST.length === 0) return 0;
      const op = UNDO_ST.pop();
      if (op.type === 1) {
        const e = htFind(op.job);
        if (e) { op.dur = e.dur; op.prio = e.prio; }
        const out = { pos: 0, time: 0 };
        qRemove(Q[op.dept], op.job, out);
        op.pos = out.pos;
        htRemove(op.job);
      } else {
        qInsertAt(Q[op.dept], op.pos, op.job, op.time, op.dept);
        htInsert(op.job, op.dept, op.time, op.dur, op.prio);
      }
      REDO_ST.push(op);
      LAST_OP = op;
      return 1;
    },
    redo() {
      if (REDO_ST.length === 0) return 0;
      const op = REDO_ST.pop();
      if (op.type === 1) {
        qInsertAt(Q[op.dept], op.pos, op.job, op.time, op.dept);
        htInsert(op.job, op.dept, op.time, op.dur, op.prio);
      } else {
        const e = htFind(op.job);
        if (e) { op.dur = e.dur; op.prio = e.prio; }
        const out = { pos: 0, time: 0 };
        qRemove(Q[op.dept], op.job, out);
        op.pos = out.pos;
        htRemove(op.job);
      }
      UNDO_ST.push(op);
      LAST_OP = op;
      return 1;
    },
    undo_count() { return UNDO_ST.length; },
    redo_count() { return REDO_ST.length; },
    op_field(f) {
      if (!LAST_OP) return -1;
      if (f === 0) return LAST_OP.type;
      if (f === 1) return LAST_OP.dept;
      if (f === 2) return LAST_OP.job;
      if (f === 3) return LAST_OP.time;
      return -1;
    },
    merge_lt(logOn) {
      tlFree(); LOG = []; LOGIDX = [];
      RECEIVED = ACTIVE = 0;
      for (let d = 0; d < MAX; d++) { RECEIVED += Q[d].count; if (Q[d].count) ACTIVE++; }
      const st = mergeLtRun(Q, RANK, MAX, true);
      ST = { ins: st.ins, ext: st.ext, cmp: st.cmp, alg: 1 };
      return TL.n;
    },
    merge_naive() {
      tlFree(); LOG = []; LOGIDX = [];
      RECEIVED = ACTIVE = 0;
      const cur = new Array(MAX);
      for (let d = 0; d < MAX; d++) {
        cur[d] = Q[d].head; RECEIVED += Q[d].count; if (Q[d].count) ACTIVE++;
      }
      let ins = ACTIVE, ext = 0, cmp = 0;
      for (;;) {
        let best = -1;
        for (let d = 0; d < MAX; d++) {
          if (!cur[d]) continue;
          if (best < 0) { best = d; continue; }
          cmp++;
          if (cur[d].time < cur[best].time ||
              (cur[d].time === cur[best].time && RANK[d] < RANK[best])) {
            best = d;
          }
        }
        if (best < 0) break;
        const n = cur[best];
        tlPush(n.job, n.time, best);
        ext++;
        cur[best] = n.next;
        if (cur[best]) ins++;
      }
      ST = { ins, ext, cmp, alg: 2 };
      return TL.n;
    },
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
