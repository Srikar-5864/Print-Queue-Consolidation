/* tests/parity.js - runs the same 50 seeded scenarios on web/core_js.js
   and prints checksum lines matching `pqc_tests --parity`. */
const { makeJsCore } = require('../web/core_js.js');

function mixHash(h, v) {
  h = (h ^ (v | 0)) >>> 0;
  h = Math.imul(h, 16777619) >>> 0;
  return h;
}

const c = makeJsCore();
let seed = 0;
function rnd() {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed >>> 8;
}

for (let sc = 0; sc < 50; sc++) {
  c.init();
  seed = (10000 + sc * 7919) >>> 0;
  const k = 2 + (rnd() % 15);
  const perm = [];
  for (let d = 0; d < k; d++) perm.push(d);
  for (let d = k - 1; d > 0; d--) {
    const j = rnd() % (d + 1);
    const t = perm[d]; perm[d] = perm[j]; perm[j] = t;
  }
  for (let d = 0; d < k; d++) c.set_rank(d, perm[d]);

  const ops = 30 + (rnd() % 150);
  const active = [];
  let nextId = 1;
  for (let i = 0; i < ops; i++) {
    const act = rnd() % 10;
    if (act < 6 || active.length === 0) {
      const d = rnd() % k;
      const t = rnd() % 40;
      const jid = nextId++;
      if (c.add_job_raw(d, t, jid) === 0) {
        if ((rnd() % 3) === 0) c.set_duration(jid, 1 + (rnd() % 5));
        active.push(jid);
      }
    } else if (act < 8) {
      const pick = rnd() % active.length;
      const jid = active[pick];
      c.delete_job(c.job_dept(jid), jid);
      active[pick] = active[active.length - 1];
      active.pop();
    } else if (act === 8) {
      c.undo();
    } else {
      c.redo();
    }
  }
  for (let d = 0; d < k; d++) c.sort_queue(d);

  let h = 2166136261 >>> 0;
  const n1 = c.merge(0);
  const cHeap = c.stat(4);
  h = mixHash(h, n1); h = mixHash(h, cHeap);
  for (let i = 0; i < n1; i++) {
    h = mixHash(h, c.tl_job(i));
    h = mixHash(h, c.tl_time(i));
    h = mixHash(h, c.tl_dept(i));
  }
  h = mixHash(h, c.tl_lower_bound(15));
  h = mixHash(h, c.tl_upper_bound(15));
  if (n1 > 0) h = mixHash(h, c.find_in_timeline(c.tl_job((n1 / 2) | 0)));

  const n2 = c.merge_lt(0);
  const cLt = c.stat(4);
  h = mixHash(h, n2); h = mixHash(h, cLt);
  for (let i = 0; i < n2; i++) h = mixHash(h, c.tl_job(i));

  const n3 = c.merge_naive();
  const cNaive = c.stat(4);
  h = mixHash(h, n3); h = mixHash(h, cNaive);
  for (let i = 0; i < n3; i++) h = mixHash(h, c.tl_job(i));

  const printers = 1 + (sc % 4);
  const mk = c.sched_run(printers);
  h = mixHash(h, mk);
  h = mixHash(h, c.sched_count());
  for (let i = 0; i < c.sched_count(); i++) {
    h = mixHash(h, c.sched_printer(i));
    h = mixHash(h, c.sched_start(i));
    h = mixHash(h, c.sched_end(i));
  }
  for (let p = 0; p < printers; p++) h = mixHash(h, c.sched_load(p));

  c.spool_init(5);
  for (let i = 0; i < 4 && i < n1; i++) c.spool_enqueue(c.tl_job(i));
  if (n1 > 1) c.spool_cancel(c.tl_job(1));
  c.spool_pause(1);
  h = mixHash(h, c.spool_dequeue());
  c.spool_pause(0);
  h = mixHash(h, c.spool_dequeue());
  h = mixHash(h, c.spool_size());

  console.log(`PARITY ${sc} ${h} ${n1} ${cHeap} ${cLt} ${cNaive} ${mk}`);
}
