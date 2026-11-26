/* app.js - Print Queue Consolidation website.
   All data-structure work is done by the engine (C++ compiled to WebAssembly, or its
   JavaScript port). This file only handles screens, validation messages and drawing. */
(async function () {
'use strict';
const COLLEGE = 'Dayananda Sagar College of Engineering';
const COLORS = ['#1f6feb', '#e8590c', '#2f9e44', '#9c36b5', '#d6336c', '#0c8599', '#c98a00', '#5c7cfa', '#5c940d', '#c92a2a'];
const MAXJOBS = 100000, MAXDEPTS = 200, KS = [2, 5, 10, 50, 100, 200];
const KEY = 'pqc-state-v1', ADMIN_PIN = 'admin';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const core = await loadEngine();
const S = { depts: [], jobs: [], log: [], merged: null, page: 'dashboard', user: null, msg: null, sp: null, bench: null, keep: null };
const V = { i: -1, timer: null, speed: 900 };

// ------------------------------------------------------------ state helpers
const live = (code) => S.jobs.filter((j) => !j.deleted && (!code || j.dept === code));
const deptByCode = (c) => S.depts.find((d) => d.code === c);
const deptBySlot = (s) => S.depts.find((d) => d.slot === s);
const color = (slot) => COLORS[slot % COLORS.length];
const jobLabel = (idx) => (S.jobs[idx] ? S.jobs[idx].id : '?');
const codeOf = (slot) => (deptBySlot(slot) ? deptBySlot(slot).code : '?');
const isAdmin = () => S.user === 'admin';
const nowStr = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const fmt = (n) => Number(n).toLocaleString('en-IN');

function freeSlot() { for (let s = 0; s < MAXDEPTS; s++) if (!deptBySlot(s)) return s; return -1; }
function setRanks() {                       // rank = how many department codes sort before this one
  for (const d of S.depts) core.set_rank(d.slot, S.depts.filter((o) => o.code < d.code).length);
}
function rebuild() {
  core.init(); setRanks();
  for (const j of S.jobs) if (!j.deleted) core.add_job(deptByCode(j.dept).slot, j.time, j.idx);
}
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify({
      depts: S.depts.map((d) => ({ code: d.code, pin: d.pin })),
      jobs: live().map((j) => ({ id: j.id, dept: j.dept, time: j.time })), log: S.log.slice(-60) }));
  } catch (e) { /* storage unavailable: data stays in memory only */ }
}
function load() {
  let o = null;
  try { o = JSON.parse(localStorage.getItem(KEY)); } catch (e) { o = null; }
  const dd = o && o.depts && o.depts.length ? o.depts : ['CSE', 'ECE', 'ISE', 'ME', 'CV', 'EEE'].map((c) => ({ code: c, pin: '1234' }));
  S.depts = dd.map((d, i) => ({ code: d.code, pin: d.pin, slot: i }));
  S.jobs = ((o && o.jobs) || []).filter((j) => deptByCode(j.dept)).map((j, i) => ({ id: j.id, dept: j.dept, time: j.time, idx: i }));
  S.log = (o && o.log) || [];
}
function addLog(action, branch, status) { S.log.push({ t: nowStr(), action, branch, status }); save(); }
function invalidate() { if (S.merged) S.merged.stale = true; stopViz(); }

// ---------------------------------------------------------------- actions
const ok = (text) => ({ ok: true, text }), bad = (text) => ({ ok: false, text });

function submitJob(code, idRaw, timeRaw) {
  const id = idRaw.trim(), d = deptByCode(code);
  if (!d) return bad('Choose a branch.');
  if (!/^[A-Za-z0-9_-]{1,12}$/.test(id)) return bad('Job ID must be 1 to 12 letters, digits, "-" or "_".');
  if (!/^\d{1,9}$/.test(timeRaw.trim())) return bad('Time must be a whole number from 0 to 999999999.');
  const time = Number(timeRaw);
  if (live().length >= MAXJOBS) return bad('Limit reached: the system holds at most 100,000 jobs.');
  if (live().some((j) => j.id === id)) return bad('Job ID ' + id + ' already exists. Every job ID must be unique.');
  const idx = S.jobs.length, r = core.add_job(d.slot, time, idx);
  if (r === 1) {
    const mine = live(code), last = mine[mine.length - 1].time;
    addLog('Rejected ' + id, code, 'Rejected');
    return bad('Time ' + time + ' is earlier than the last job in ' + code + ' (time ' + last + '). Each branch queue must stay in time order.');
  }
  if (r !== 0) return bad('The job could not be added.');
  S.jobs.push({ id, dept: code, time, idx }); invalidate(); addLog('Submitted ' + id + ' (time ' + time + ')', code, 'Pending');
  return ok('Job ' + id + ' added to the ' + code + ' queue at time ' + time + '.');
}
function deleteJob(idx) {
  const j = S.jobs[idx]; if (!j || j.deleted) return;
  core.delete_job(deptByCode(j.dept).slot, idx); j.deleted = true; invalidate(); addLog('Deleted ' + j.id, j.dept, 'Success');
  S.msg = { t: 'ok', x: 'Job ' + j.id + ' removed from the ' + j.dept + ' queue.' };
}
function addDept(codeRaw, pinRaw) {
  const code = codeRaw.trim().toUpperCase(), pin = pinRaw.trim();
  if (!/^[A-Z0-9]{1,6}$/.test(code)) return bad('Branch code must be 1 to 6 letters or digits.');
  if (deptByCode(code)) return bad('Branch ' + code + ' already exists.');
  if (!pin) return bad('Enter a PIN for the branch.');
  const slot = freeSlot(); if (slot < 0) return bad('Limit reached: at most 200 branches.');
  S.depts.push({ code, pin, slot }); setRanks(); invalidate(); addLog('Branch added', code, 'Success'); save();
  return ok('Branch ' + code + ' added.');
}
function removeDept(code) {
  const d = deptByCode(code); if (!d) return;
  core.clear_queue(d.slot); for (const j of S.jobs) if (j.dept === code) j.deleted = true;
  S.depts = S.depts.filter((o) => o !== d); setRanks(); invalidate(); addLog('Branch removed', code, 'Success');
  S.msg = { t: 'ok', x: 'Branch ' + code + ' and its jobs were removed.' };
}

function readList(count, slot) {
  const a = [];
  for (let i = 0; i < count; i++) a.push({ job: core.exp_job(i), time: core.exp_time(i), slot: slot === undefined ? core.exp_dept(i) : slot });
  return a;
}
function runMerge() {
  const N = live().length, k = S.depts.filter((d) => core.q_count(d.slot) > 0).length;
  const logOn = N > 0 && k <= 10 && N <= 30;              // animate small inputs only
  const t0 = performance.now(); core.merge(logOn ? 1 : 0); const ms = performance.now() - t0;
  const timeline = readList(core.export_timeline());
  const queues = {}, received = [];
  for (const d of S.depts) { const c = core.export_queue(d.slot); queues[d.slot] = readList(c, d.slot); received.push({ code: d.code, slot: d.slot, count: c }); }
  const events = [];
  if (logOn) {
    for (let i = 0, L = core.log_len(); i < L; i++) {
      const sn = core.log_field(i, 5), snap = [];
      for (let j = 0; j < sn; j++) snap.push({ dept: core.log_field(i, 6 + 3 * j), job: core.log_field(i, 7 + 3 * j), time: core.log_field(i, 8 + 3 * j) });
      events.push({ t: core.log_field(i, 0), a: core.log_field(i, 1), b: core.log_field(i, 2), c: core.log_field(i, 3), d: core.log_field(i, 4), snap });
    }
  }
  S.merged = { timeline, queues, received, events, logged: logOn, k, N, ms, stale: false, verified: core.verify_timeline() === 1,
    st: { received: core.stat(0), produced: core.stat(1), ins: core.stat(2), ext: core.stat(3), cmp: core.stat(4) } };
  V.i = -1; stopViz(); stopSpool(); S.sp = null;
  addLog('Merged ' + N + ' jobs from ' + k + ' branches', 'All', N ? 'Success' : 'Pending');
}

// ------------------------------------------------------------------ pages
function nodeHTML(n, c, cls, del) {
  return '<span class="node ' + (cls || '') + '" style="--c:' + c + '">' + esc(jobLabel(n.job)) + '<small>t=' + n.time + '</small>' +
    (del ? '<button class="x" data-act="del" data-idx="' + n.job + '" aria-label="Delete job ' + esc(jobLabel(n.job)) + '">×</button>' : '') + '</span>';
}
function listHTML(items, c, del, cls) {
  if (!items.length) return '<span class="null">empty queue (head = null)</span>';
  const shown = items.slice(0, 60);
  return shown.map((n, p) => nodeHTML(n, c, cls ? cls(n, p) : '', del) + '<span class="arrow">→</span>').join('') +
    (items.length > 60 ? '<span class="null">… +' + (items.length - 60) + ' more </span>' : '') + '<span class="null">null</span>';
}
const pill = (s) => '<span class="pill ' + (s === 'Success' ? 'ok' : s === 'Pending' ? 'warn' : 'bad') + '">' + esc(s) + '</span>';
const stat = (cls, ic, v, l) => '<div class="stat ' + cls + '"><span class="dot">' + ic + '</span><div><b>' + v + '</b><small>' + l + '</small></div></div>';
const head = (t, p, extra) => '<div class="pagehead"><div><h2>' + t + '</h2><p>' + p + '</p></div>' + (extra || '') + '</div>';
const staleNote = () => (S.merged && S.merged.stale ? '<div class="msg info">The queues changed after the last merge. Merge again to refresh this page.</div>' : '');

function pageDashboard() {
  const mine = isAdmin() ? null : S.user, pend = live(mine).length;
  const logs = S.log.filter((l) => !mine || l.branch === mine).slice(-6).reverse();
  const rows = logs.length ? logs.map((l) => '<tr><td>' + esc(l.t) + '</td><td>' + esc(l.action) + '</td><td>' + esc(l.branch) + '</td><td>' + pill(l.status) + '</td></tr>').join('')
    : '<tr><td colspan="4" class="muted">No activity yet. Submit a job from Branch Queues to begin.</td></tr>';
  return '<section class="hero"><div><h2>Question Paper <span>Printing</span></h2><div class="tag">Ordered · Complete · Predictable</div></div>' +
    '<svg viewBox="0 0 190 130" aria-hidden="true"><rect x="52" y="6" width="86" height="46" rx="6" fill="#fff" stroke="#6ea0e6" stroke-width="3"/><rect x="20" y="44" width="150" height="56" rx="12" fill="#e9f1fd" stroke="#6ea0e6" stroke-width="3"/><rect x="48" y="84" width="94" height="40" rx="4" fill="#fff" stroke="#6ea0e6" stroke-width="3"/><path d="M62 98h66M62 108h46" stroke="#9db8e0" stroke-width="3"/><circle cx="148" cy="62" r="5" fill="#2f9e44"/></svg></section>' +
    '<div class="pagehead"><div><h2>Dashboard</h2><p>Overview of the Examination Question Paper Printing System</p></div><span class="chip">' + new Date().toLocaleString([], { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + '</span></div>' +
    '<div class="stats">' + stat('s-blue', '🏛', S.depts.length, 'Branches') + stat('s-orange', '📄', pend, mine ? 'Jobs in ' + esc(mine) + ' queue' : 'Pending Jobs') +
    stat('s-green', '🖨', S.merged && !S.merged.stale ? S.merged.st.produced : '—', 'Jobs in Timeline') + stat('s-purple', '✔', core.name.startsWith('Web') ? 'Wasm' : 'JS port', 'Engine') + '</div>' +
    '<div class="two"><div class="card"><h3>Recent Activity</h3><table><thead><tr><th>Time</th><th>Action</th><th>Branch</th><th>Status</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
    '<div class="card"><h3>How the timeline is ordered</h3><p>Jobs are sorted by <b>time</b>. When two jobs share a time, the branch code decides (CSE before ECE). Inside one branch the original order never changes.</p>' +
    '<p class="muted">Engine: ' + esc(core.name) + (core.fallbackReason ? '. core.wasm was not loaded (' + esc(core.fallbackReason) + '); build it with build_wasm.sh.' : '.') + '</p></div></div>';
}

function pageQueues() {
  const admin = isAdmin(), depts = admin ? S.depts : S.depts.filter((d) => d.code === S.user);
  const m = S.msg ? '<div class="msg ' + S.msg.t + '" role="status">' + esc(S.msg.x) + '</div>' : '';
  const sel = admin ? '<div><label for="sjDept">Branch</label><select id="sjDept">' + S.depts.map((d) => '<option>' + esc(d.code) + '</option>').join('') + '</select></div>' : '';
  const form = '<div class="card"><h3>Submit a print job</h3><div class="row">' + sel +
    '<div><label for="sjId">Job ID</label><input id="sjId" maxlength="12" placeholder="e.g. A2" autocomplete="off"></div>' +
    '<div><label for="sjTime">Submission time</label><input id="sjTime" inputmode="numeric" placeholder="whole number, e.g. 540" autocomplete="off"></div>' +
    '<div><button class="btn primary" data-act="submit">Submit job</button></div></div>' +
    '<p class="hint">A job is added at the end of its branch queue. Its time cannot be earlier than the branch’s last job, and its ID must be unique.</p></div>';
  const mg = admin ? '<div class="card"><h3>Manage branches</h3><div class="row"><div><label for="mgCode">Branch code</label><input id="mgCode" maxlength="6" placeholder="e.g. AIML"></div>' +
    '<div><label for="mgPin">PIN</label><input id="mgPin" value="1234"></div><div><button class="btn yellow" data-act="addDept">Add branch</button></div></div>' +
    '<p class="hint">' + S.depts.length + ' of ' + MAXDEPTS + ' branches in use.</p></div>' : '';
  const cards = depts.map((d) => {
    const c = core.export_queue(d.slot), items = readList(c, d.slot);
    return '<div class="card deptcard" style="--c:' + color(d.slot) + '"><div class="dh"><h3>' + esc(d.code) + ' · ' + c + (c === 1 ? ' job' : ' jobs') + '</h3>' +
      (admin ? '<button class="btn danger sm" data-act="rmDept" data-code="' + esc(d.code) + '">Remove branch</button>' : '') + '</div><div class="list">' +
      '<span class="node" style="--c:' + color(d.slot) + '">head</span><span class="arrow">→</span>' + listHTML(items, color(d.slot), true) + '</div></div>';
  }).join('');
  return head(admin ? 'Branch Queues' : 'My Queue', admin ? 'Each branch keeps its jobs as a linked list in time order.' : 'Your branch’s jobs, stored as a linked list in time order.') + m + form + mg + cards;
}

function pageMerge() {
  const mg = S.merged, tie = '<div class="card"><h3>Tie rule</h3><p>The merge compares <b>time</b> first. If two jobs have the same time, the one from the branch whose code comes first alphabetically goes first. Jobs of the same branch keep their original order, because only one job per branch is ever inside the heap.</p></div>';
  const btn = '<button class="btn primary" data-act="merge"' + (live().length ? '' : ' disabled') + '>Merge all queues</button>';
  if (!mg) return head('Merge & Report', 'Combine every branch queue into one timeline.', btn) +
    '<div class="card"><p>' + (live().length ? 'No merge has been run yet. Press <b>Merge all queues</b>.' : 'There are no jobs yet. Submit jobs from Branch Queues first.') + '</p></div>' + tie;
  const line = (arr) => arr.length ? arr.slice(0, 300).map((n) => esc(jobLabel(n.job)) + '(' + n.time + ')').join(' → ') + (arr.length > 300 ? ' → …' : '') : 'empty';
  const inputs = mg.received.map((r) => '<div class="mono"><b style="color:' + color(r.slot) + '">' + esc(r.code) + '</b>: ' + line(mg.queues[r.slot]) + '</div>').join('');
  const chips = mg.timeline.slice(0, 300).map((n) => '<span class="tchip" style="--c:' + color(n.slot) + '">' + esc(jobLabel(n.job)) + '<small>' + esc(codeOf(n.slot)) + ' · t=' + n.time + '</small></span>').join('');
  const rep = mg.received.map((r) => '<tr><td>' + esc(r.code) + '</td><td class="num">' + r.count + '</td></tr>').join('');
  const match = mg.st.received === mg.st.produced && mg.verified;
  const ref = mg.k > 1 ? fmt(Math.round(mg.N * Math.log2(mg.k))) : fmt(mg.N);
  return head('Merge & Report', 'Times are shown as name(time).', btn) + staleNote() +
    '<div class="stats">' + stat('s-blue', '↓', fmt(mg.st.received), 'Jobs received') + stat('s-green', '↑', fmt(mg.st.produced), 'Jobs produced') +
    stat(match ? 's-green' : 's-orange', match ? '✔' : '!', match ? 'Match' : 'Mismatch', 'Order and count check') + '</div>' +
    '<div class="card"><h3>Input queues</h3>' + inputs + '</div><div class="card"><h3>Merged timeline</h3><div class="timeline">' + chips + '</div><p class="mono" style="margin-top:12px">' + line(mg.timeline) + '</p></div>' +
    '<div class="two"><div class="card"><h3>Merge report</h3><table><thead><tr><th>Branch</th><th class="num">Jobs received</th></tr></thead><tbody>' + rep +
    '<tr><td><b>Total received</b></td><td class="num"><b>' + fmt(mg.st.received) + '</b></td></tr><tr><td><b>Total produced</b></td><td class="num"><b>' + fmt(mg.st.produced) + '</b></td></tr></tbody></table></div>' +
    '<div class="card"><h3>Performance</h3><table><tbody><tr><td>Heap insertions</td><td class="num">' + fmt(mg.st.ins) + '</td></tr><tr><td>Heap extractions</td><td class="num">' + fmt(mg.st.ext) + '</td></tr>' +
    '<tr><td>Comparisons</td><td class="num">' + fmt(mg.st.cmp) + '</td></tr><tr><td>Execution time</td><td class="num">' + mg.ms.toFixed(3) + ' ms</td></tr>' +
    '<tr><td>Time complexity</td><td class="num">O(N log k)</td></tr><tr><td>N = ' + fmt(mg.N) + ', k = ' + mg.k + '</td><td class="num">N·log₂k ≈ ' + ref + '</td></tr></tbody></table></div></div>' + tie;
}

// ----- visualizer
function vizState(i) {
  const m = S.merged, cur = {}, tl = [];
  for (const r of m.received) cur[r.slot] = 0;
  let cmp = 0, ins = 0;
  for (let j = 0; j <= i; j++) {
    const e = m.events[j];
    if (e.t === 6 || e.t === 7) cur[e.a] = e.b;
    if (e.t === 5) tl.push(e);
    if (e.t === 3) cmp++;
    if (e.t === 1 || e.t === 6) ins++;
  }
  return { cur, tl, cmp, ins, ext: tl.length, snap: i >= 0 ? m.events[i].snap : [], e: i >= 0 ? m.events[i] : null };
}
function describe(e) {
  if (!e) return 'Press <b>Next</b> to start. First, the front job of every branch queue is placed into the heap array.';
  const sn = e.snap, c = codeOf, L = (x) => '<b>' + esc(jobLabel(x.job)) + '</b>';
  switch (e.t) {
    case 1: return 'Insert ' + esc(c(sn[e.b].dept)) + '’s front job ' + L(sn[e.b]) + ' (t=' + sn[e.b].time + ') into the heap array at position ' + e.b + '.';
    case 2: return 'Heapify: repair the heap below position ' + e.a + ' (sift-down).';
    case 3: { const X = sn[e.a], Y = sn[e.b], w = e.c ? X : Y;
      return 'Compare ' + L(X) + ' (t=' + X.time + ', ' + esc(c(X.dept)) + ') with ' + L(Y) + ' (t=' + Y.time + ', ' + esc(c(Y.dept)) + '). ' +
        (e.d ? 'The times are equal, so the branch code decides: <b>' + esc(c(w.dept)) + '</b> comes first.' : L(w) + ' has the earlier time and comes first.'); }
    case 4: return 'Swap: ' + L(sn[e.a]) + ' moves up to position ' + e.a + ' and ' + L(sn[e.b]) + ' moves down to position ' + e.b + '.';
    case 5: return 'Extract the minimum: <b>' + esc(jobLabel(e.b)) + '</b> (t=' + e.c + ') from ' + esc(c(e.a)) + ' becomes job number ' + (e.d + 1) + ' in the merged timeline.';
    case 6: return esc(c(e.a)) + '’s pointer moves to its next job <b>' + esc(jobLabel(e.c)) + '</b> (t=' + e.d + '). It takes the root place and sift-down repairs the heap.';
    case 7: return esc(c(e.a)) + ' has no more jobs (pointer = null). The last heap element moves to the root.';
    default: return 'Merge complete: all ' + S.merged.N + ' jobs are in the timeline.';
  }
}
function heapSVG(st) {
  const sn = st.snap; if (!sn.length) return '<p class="muted">The heap is empty.</p>';
  const lv = Math.floor(Math.log2(sn.length)) + 1, W = 620, RH = 78, hl = {}, e = st.e;
  if (e) { if (e.t === 3) { hl[e.a] = 'cmp'; hl[e.b] = 'cmp'; } else if (e.t === 4) { hl[e.a] = 'swap'; hl[e.b] = 'swap'; } else if (e.t === 5) hl[0] = 'out';
    else if (e.t === 6) hl[0] = 'new'; else if (e.t === 1) hl[e.b] = 'new'; else if (e.t === 2) hl[e.a] = 'cmp'; }
  const P = (i) => { const l = Math.floor(Math.log2(i + 1)), n = Math.pow(2, l); return { x: (i - (n - 1) + 0.5) / n * W, y: l * RH + 36 }; };
  let s = '<svg class="heap" viewBox="0 0 ' + W + ' ' + (lv * RH + 6) + '" role="img" aria-label="Min-heap as a binary tree">';
  for (let i = 1; i < sn.length; i++) { const a = P(i), b = P((i - 1) >> 1); s += '<line x1="' + a.x + '" y1="' + a.y + '" x2="' + b.x + '" y2="' + b.y + '" stroke="#b9c9e2" stroke-width="2"/>'; }
  sn.forEach((x, i) => { const p = P(i), j = esc(jobLabel(x.job));
    s += '<g class="hn ' + (hl[i] || '') + '"><circle cx="' + p.x + '" cy="' + p.y + '" r="28" stroke="' + color(x.dept) + '"/><text x="' + p.x + '" y="' + (p.y - 2) + '" font-size="13" font-weight="700" fill="#12305f">' + (j.length > 7 ? j.slice(0, 6) + '…' : j) + '</text>' +
      '<text x="' + p.x + '" y="' + (p.y + 13) + '" font-size="11" fill="#5f7396">t=' + x.time + '</text></g>'; });
  return s + '</svg><div class="heaparr">' + sn.map((x, i) => '<span class="cell">' + i + ': ' + esc(jobLabel(x.job)) + '</span>').join('') + '</div>';
}
function vizBody() {
  const m = S.merged, st = vizState(V.i), E = m.events.length, inHeap = (slot, job) => st.snap.some((x) => x.dept === slot && x.job === job);
  const lists = m.received.filter((r) => r.count).map((r) => {
    const q = m.queues[r.slot], cur = st.cur[r.slot];
    return '<div class="dh"><b style="color:' + color(r.slot) + '">' + esc(r.code) + '</b></div><div class="list" style="margin-bottom:12px">' +
      q.map((n, p) => nodeHTML(n, color(r.slot), p < cur ? 'done' : (p === cur && inHeap(r.slot, n.job) ? 'front' : '')) + '<span class="arrow">→</span>').join('') +
      '<span class="null">null</span>' + (cur >= q.length ? '<span class="ptr" style="margin-left:8px">pointer = null</span>' : '') + '</div>';
  }).join('');
  const tl = st.tl.map((x, p) => '<span class="tchip ' + (st.e && st.e.t === 5 && p === st.tl.length - 1 ? 'new' : '') + '" style="--c:' + color(x.a) + '">' + esc(jobLabel(x.b)) + '<small>' + esc(codeOf(x.a)) + ' · t=' + x.c + '</small></span>').join('') || '<span class="null">nothing yet</span>';
  const ref = m.k > 1 ? fmt(Math.round(m.N * Math.log2(m.k))) : fmt(m.N);
  return '<div class="step" aria-live="polite">' + describe(st.e) + '</div>' +
    '<div class="viz"><div><div class="card"><h3>Min-heap (next job of each branch)</h3>' + heapSVG(st) + '</div><div class="card"><h3>Merged timeline so far</h3><div class="timeline">' + tl + '</div></div></div>' +
    '<div class="card"><h3>Branch queues (linked lists)</h3><p class="hint" style="margin-top:0">Yellow = job currently in the heap, faded = already merged.</p>' + lists + '</div></div>' +
    '<div class="stats">' + stat('s-blue', '≡', m.N, 'Jobs received') + stat('s-green', '↑', st.ext + ' / ' + m.st.ext, 'Extractions (jobs output)') + stat('s-orange', '↓', st.ins + ' / ' + m.st.ins, 'Heap insertions') +
    stat('s-purple', '⇄', st.cmp + ' / ' + m.st.cmp, 'Comparisons') + stat('s-blue', '⏱', m.ms.toFixed(3) + ' ms', 'Execution time') + stat('s-green', 'O', 'O(N log k)', 'N·log₂k ≈ ' + ref + ' (N=' + m.N + ', k=' + m.k + ')') + '</div>';
}
function pageViz() {
  const m = S.merged;
  if (!m) return head('DSA Visualizer', 'Watch the K-way merge work step by step.', '<button class="btn primary" data-act="merge"' + (live().length ? '' : ' disabled') + '>Merge all queues</button>') +
    '<div class="card"><p>Run a merge first. ' + (live().length ? '' : 'Add some jobs from Branch Queues before merging.') + '</p></div>';
  if (!m.logged) return head('DSA Visualizer', 'Watch the K-way merge work step by step.', '<button class="btn primary" data-act="merge">Merge again</button>') + staleNote() +
    '<div class="card"><p>' + (m.N === 0 ? 'There were no jobs in the last merge.' : 'The animation is limited to <b>10 branches and 30 jobs</b>. The last merge had ' + m.k + ' branches and ' + fmt(m.N) + ' jobs, so it ran without animation.') + '</p></div>' +
    '<div class="stats">' + stat('s-blue', '≡', fmt(m.N), 'Jobs received') + stat('s-green', '↑', fmt(m.st.ext), 'Extractions') + stat('s-orange', '↓', fmt(m.st.ins), 'Heap insertions') + stat('s-purple', '⇄', fmt(m.st.cmp), 'Comparisons') + stat('s-blue', '⏱', m.ms.toFixed(3) + ' ms', 'Execution time') + '</div>';
  return head('DSA Visualizer', 'Watch the K-way merge work step by step.', '<button class="btn" data-act="merge">Merge again</button>') + staleNote() +
    '<div class="card"><div class="controls"><button class="btn" data-act="vReset">Reset</button><button class="btn" data-act="vPrev">◀ Previous</button>' +
    '<button class="btn yellow" data-act="vPlay" id="vPlay">' + (V.timer ? 'Pause' : 'Auto Play') + '</button><button class="btn" data-act="vNext">Next ▶</button>' +
    '<label for="vSpeed" style="margin:0">Speed</label><select id="vSpeed" data-change="vSpeed"><option value="1600"' + (V.speed === 1600 ? ' selected' : '') + '>Slow</option><option value="900"' + (V.speed === 900 ? ' selected' : '') + '>Normal</option><option value="350"' + (V.speed === 350 ? ' selected' : '') + '>Fast</option></select>' +
    '<span class="chip" id="vCount"></span></div><div class="bar"><i id="vBar"></i></div><div id="vizBody"></div></div>';
}
function updateViz() {
  const box = $('#vizBody'); if (!box || !S.merged || !S.merged.logged) return;
  const E = S.merged.events.length; box.innerHTML = vizBody();
  $('#vCount').textContent = 'Step ' + (V.i + 1) + ' of ' + E; $('#vBar').style.width = ((V.i + 1) / E * 100) + '%';
  $('#vPlay').textContent = V.timer ? 'Pause' : 'Auto Play';
}
function stopViz() { if (V.timer) { clearInterval(V.timer); V.timer = null; } }
function vizStep(d) {
  const E = S.merged.events.length; V.i = Math.max(-1, Math.min(E - 1, V.i + d));
  if (V.i >= E - 1) stopViz(); updateViz();
}

// ----- printer spooler (circular queue)
function stopSpool() { if (S.sp && S.sp.timer) { clearInterval(S.sp.timer); S.sp.timer = null; } }
function spFill() {
  const tl = S.merged.timeline;
  while (S.sp.loaded < tl.length && core.spool_enqueue(tl[S.sp.loaded].job)) S.sp.loaded++;
}
function spLoad() {
  stopSpool();
  const cap = Math.max(2, Math.min(12, parseInt($('#spCap').value, 10) || 6));
  core.spool_init(cap); S.sp = { cap, loaded: 0, printed: [], timer: null, done: false }; spFill();
}
function spPrint() {
  if (!S.sp) return;
  const j = core.spool_dequeue(); if (j < 0) { stopSpool(); return; }
  S.sp.printed.push(j); spFill();
  if (S.sp.printed.length === S.merged.timeline.length) { stopSpool(); S.sp.done = true; addLog('Printed ' + S.merged.timeline.length + ' jobs', 'All', 'Success'); }
  if (S.page === 'spool') render();
}
function ringSVG() {
  const cap = core.spool_cap(), cx = 170, cy = 160, R = 110, f = core.spool_front(), r = core.spool_rear();
  let s = '<svg class="ring" viewBox="0 0 340 320" role="img" aria-label="Circular queue of the printer spooler"><circle cx="' + cx + '" cy="' + cy + '" r="' + R + '" fill="none" stroke="#dbe5f2" stroke-width="2"/>';
  const at = (i, rad) => ({ x: cx + rad * Math.cos(-Math.PI / 2 + i * 2 * Math.PI / cap), y: cy + rad * Math.sin(-Math.PI / 2 + i * 2 * Math.PI / cap) });
  for (let i = 0; i < cap; i++) {
    const p = at(i, R), j = core.spool_slot(i), lab = j >= 0 ? esc(jobLabel(j)) : '';
    s += '<circle cx="' + p.x + '" cy="' + p.y + '" r="26" fill="' + (j >= 0 ? '#fff6cc' : '#fff') + '" stroke="#0a3f8f" stroke-width="2"/><text x="' + p.x + '" y="' + (p.y - 6) + '" font-size="10" fill="#5f7396">' + i + '</text><text x="' + p.x + '" y="' + (p.y + 10) + '" font-size="13" font-weight="700" fill="#12305f">' + (lab.length > 6 ? lab.slice(0, 5) + '…' : lab) + '</text>';
  }
  const fm = at(f, R + 46), rm = at(r, R + 46);
  s += '<text x="' + fm.x + '" y="' + (fm.y + 5) + '" font-size="14" font-weight="800" fill="#2f9e44">' + (f === r ? 'F/R' : 'F') + '</text>';
  if (f !== r) s += '<text x="' + rm.x + '" y="' + (rm.y + 5) + '" font-size="14" font-weight="800" fill="#e8590c">R</text>';
  return s + '<text x="' + cx + '" y="' + (cy + 2) + '" font-size="22" font-weight="800" fill="#12305f">' + core.spool_size() + ' / ' + cap + '</text><text x="' + cx + '" y="' + (cy + 22) + '" font-size="12" fill="#5f7396">in spooler</text></svg>';
}
function pageSpool() {
  const m = S.merged, sp = S.sp;
  const ctl = '<div class="card"><div class="row"><div style="max-width:160px"><label for="spCap">Spooler capacity (2–12)</label><input id="spCap" type="number" min="2" max="12" value="' + (sp ? sp.cap : 6) + '"></div>' +
    '<div><button class="btn primary" data-act="spLoad"' + (m && m.timeline.length ? '' : ' disabled') + '>Load merged timeline</button> ' +
    '<button class="btn" data-act="spPrint"' + (sp && !sp.done ? '' : ' disabled') + '>Print next job</button> ' +
    '<button class="btn yellow" data-act="spAuto"' + (sp && !sp.done ? '' : ' disabled') + '>' + (sp && sp.timer ? 'Pause' : 'Auto print') + '</button></div></div></div>';
  if (!m || !m.timeline.length) return head('Print Spooler', 'Print the merged timeline through a circular queue.') + ctl + '<div class="card"><p>Run a merge with at least one job first.</p></div>';
  if (!sp) return head('Print Spooler', 'Print the merged timeline through a circular queue.') + staleNote() + ctl + '<div class="card"><p>Press <b>Load merged timeline</b>. The spooler holds a few jobs at a time and refills as jobs are printed.</p></div>';
  const N = m.timeline.length, pr = sp.printed.length;
  return head('Print Spooler', 'F = front (next to print), R = rear (next free slot).') + staleNote() + ctl +
    '<div class="two"><div class="card"><h3>Circular queue</h3>' + ringSVG() + '</div><div class="card"><h3>Progress</h3><p><b>' + pr + '</b> of ' + N + ' printed · ' + (N - sp.loaded) + ' still waiting outside the spooler</p><div class="bar"><i style="width:' + (pr / N * 100) + '%"></i></div>' +
    (sp.done ? '<div class="msg ok">All jobs printed in timeline order.</div>' : '') + '<div class="timeline">' + sp.printed.map((j) => { const d = S.jobs[j]; return '<span class="tchip" style="--c:' + color(deptByCode(d.dept) ? deptByCode(d.dept).slot : 0) + '">' + esc(d.id) + '<small>' + esc(d.dept) + ' · t=' + d.time + '</small></span>'; }).join('') + '</div></div></div>';
}

// ----- scalability
function pageScale() {
  const b = S.bench, rows = b ? b.rows : [];
  const tbl = rows.length ? '<div class="card"><h3>Comparisons as departments are added (N = ' + fmt(b.n) + ' jobs)</h3><table><thead><tr><th>Departments (k)</th><th class="num">Heap merge</th><th class="num">Naive scan</th><th class="num">N·log₂k</th><th class="num">Naive ÷ heap</th></tr></thead><tbody>' +
    rows.map((r) => '<tr><td>' + r.k + '</td><td class="num">' + fmt(r.heap) + '</td><td class="num">' + fmt(r.naive) + '</td><td class="num">' + fmt(Math.round(b.n * Math.log2(r.k))) + '</td><td class="num">' + (r.heap ? (r.naive / r.heap).toFixed(1) + '×' : '—') + '</td></tr>').join('') + '</tbody></table></div>' : '';
  return head('Scalability', 'How merge work grows as more departments are added.') +
    '<div class="card"><div class="row"><div style="max-width:220px"><label for="bN">Total jobs (1,000–100,000)</label><input id="bN" type="number" min="1000" max="100000" value="' + (b ? b.n : 100000) + '"></div>' +
    '<div><button class="btn primary" data-act="bench"' + (b && b.running ? ' disabled' : '') + '>' + (b && b.running ? 'Running…' : 'Run benchmark') + '</button></div></div>' +
    '<p class="hint">The benchmark builds generated test queues (with many equal times) for k = 2, 5, 10, 50, 100, 200 and counts the comparisons made by the heap merge and by a naive method that scans every queue front for each output job. The heap grows like N·log₂k, the naive method like N·k.</p></div>' +
    (rows.length ? '<div class="card"><h3>Comparisons (log scale)</h3><canvas id="chart" width="760" height="340" role="img" aria-label="Chart of comparisons versus number of departments"></canvas></div>' : '') + tbl;
}
function drawChart() {
  const cv = $('#chart'); if (!cv || !S.bench) return;
  const rows = S.bench.rows, g = cv.getContext('2d'), W = cv.width, H = cv.height, pl = 76, pr = 24, pt = 24, pb = 54;
  const vals = []; rows.forEach((r) => { vals.push(Math.max(1, r.heap), Math.max(1, r.naive)); });
  const lo = Math.floor(Math.log10(Math.min(...vals))); let hi = Math.ceil(Math.log10(Math.max(...vals))); if (hi <= lo) hi = lo + 1;
  const Y = (v) => pt + (hi - Math.log10(Math.max(1, v))) / (hi - lo) * (H - pt - pb), X = (i) => pl + i * (W - pl - pr) / Math.max(1, rows.length - 1);
  g.clearRect(0, 0, W, H); g.font = '13px Segoe UI, sans-serif'; g.fillStyle = '#5f7396'; g.strokeStyle = '#dbe5f2'; g.lineWidth = 1;
  for (let e = lo; e <= hi; e++) { const y = Y(Math.pow(10, e)); g.beginPath(); g.moveTo(pl, y); g.lineTo(W - pr, y); g.stroke(); g.textAlign = 'right'; g.fillText('10^' + e, pl - 8, y + 4); }
  g.textAlign = 'center'; rows.forEach((r, i) => g.fillText(String(r.k), X(i), H - pb + 20)); g.fillText('Number of departments (k)', (pl + W - pr) / 2, H - 10);
  [['heap', '#1f6feb', 'Heap merge'], ['naive', '#e8590c', 'Naive scan']].forEach(([key, col, name], n) => {
    g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 3; g.beginPath();
    rows.forEach((r, i) => { const x = X(i), y = Y(r[key]); if (i) g.lineTo(x, y); else g.moveTo(x, y); }); g.stroke();
    rows.forEach((r, i) => { g.beginPath(); g.arc(X(i), Y(r[key]), 4.5, 0, 6.3); g.fill(); });
    g.textAlign = 'left'; g.fillRect(pl + 10 + n * 130, pt - 12, 14, 4); g.fillStyle = '#12305f'; g.fillText(name, pl + 30 + n * 130, pt - 6);
  });
}
async function runBench() {
  const n = Math.max(1000, Math.min(100000, parseInt($('#bN').value, 10) || 100000));
  S.bench = { n, rows: [], running: true }; render();
  for (const k of KS) {
    await new Promise((r) => setTimeout(r, 30));
    core.bench(k, n); S.bench.rows.push({ k, heap: core.bench_stat(0), naive: core.bench_stat(1) });
    if (S.page === 'scale') render();
  }
  S.bench.running = false; if (S.page === 'scale') render();
}

// ----- about / help
const pageAbout = () => head('About', 'The problem this system solves.') +
  '<div class="card"><h3>The Printing Office’s Conflicting Logs</h3><p>During examination week every branch sends jobs to one shared print room. Each branch keeps its own jobs in time order, but combining the lists by hand loses jobs and mishandles equal times. This system merges all branch queues into one complete, predictable timeline.</p>' +
  '<p><b>Rules:</b> ascending time; equal times go by branch code; a branch’s own order is never changed; no job is lost or renamed.</p></div>' +
  '<div class="card"><h3>How it works</h3><p>Each branch queue is a <b>singly linked list</b>. A hand-built <b>min-heap</b> holds only the front job of each branch. The smallest is taken out, the next job from the same branch takes its place, and the heap is repaired. Total work is <b>O(N log k)</b> for N jobs and k branches, with no re-sorting. The data structures are written in C++ without STL containers and run here as WebAssembly.</p></div>';
const pageHelp = () => head('Help', 'How to use the system.') +
  '<div class="card"><h3>As a branch</h3><p>Sign in with your branch and PIN. Open <b>My Queue</b> and submit jobs with an ID and a time. A job whose time is earlier than your last job is rejected. You can delete a pending job with the × on its node.</p>' +
  '<h3 style="margin-top:14px">As the operator</h3><p>Sign in as Operator. Submit jobs for any branch, add or remove branches, then use <b>Merge &amp; Report</b>. <b>DSA Visualizer</b> animates small merges (up to 10 branches, 30 jobs). <b>Print Spooler</b> prints the timeline through a circular queue. <b>Scalability</b> compares the heap merge with a naive method.</p></div>';

// ---------------------------------------------------------- shell + routing
const PAGES = { dashboard: pageDashboard, queues: pageQueues, merge: pageMerge, viz: pageViz, spool: pageSpool, scale: pageScale, about: pageAbout, help: pageHelp };
const SIDE_ADMIN = [['dashboard', 'Dashboard', '🏠'], ['queues', 'Branch Queues', '🏛'], ['merge', 'Merge & Report', '🧾'], ['viz', 'DSA Visualizer', '🔬'], ['spool', 'Print Spooler', '🖨'], ['scale', 'Scalability', '📈']];
const SIDE_DEPT = [['dashboard', 'Dashboard', '🏠'], ['queues', 'My Queue', '🏛']];

function render() {
  const side = isAdmin() ? SIDE_ADMIN : SIDE_DEPT;
  $('#side').innerHTML = side.map(([p, l, i]) => '<button data-nav="' + p + '" class="' + (S.page === p ? 'on' : '') + '"><span class="ico">' + i + '</span>' + l + '</button>').join('') +
    '<button data-act="logout"><span class="ico">⎋</span>Logout</button>';
  document.querySelectorAll('.topnav [data-nav]').forEach((b) => b.classList.toggle('on', b.dataset.nav === S.page));
  $('#whoChip').textContent = isAdmin() ? 'Operator (Admin)' : 'Branch: ' + S.user;
  $('#view').innerHTML = PAGES[S.page]();
  if (S.page === 'viz') updateViz();
  if (S.page === 'scale') drawChart();
  if (S.keep) { for (const k in S.keep) { const el = document.getElementById(k); if (el) el.value = S.keep[k]; } const f = $('#sjId'); if (f && S.keep.focus) f.focus(); S.keep = null; }
}
function go(p) {
  if (!PAGES[p] || (!isAdmin() && ['merge', 'viz', 'spool', 'scale'].includes(p))) p = 'dashboard';
  stopViz(); stopSpool(); S.page = p; S.msg = null; render(); window.scrollTo(0, 0);
}
function showApp() {
  $('#login').hidden = true; $('#app').hidden = false; $('#collegeName').textContent = COLLEGE; go('dashboard');
}
function showLogin() {
  stopViz(); stopSpool(); S.user = null; try { sessionStorage.removeItem('pqc-user'); } catch (e) { /* ignore */ }
  $('#app').hidden = true; $('#login').hidden = false; $('#loginPin').value = ''; $('#loginErr').textContent = '';
  $('#loginRole').innerHTML = '<option value="admin">Operator (Admin)</option>' + S.depts.map((d) => '<option value="' + esc(d.code) + '">' + esc(d.code) + '</option>').join('');
}
function doLogin() {
  const role = $('#loginRole').value, pin = $('#loginPin').value;
  const good = role === 'admin' ? pin === ADMIN_PIN : (deptByCode(role) && deptByCode(role).pin === pin);
  if (!good) { $('#loginErr').textContent = 'Wrong PIN. Check the demo PINs below and try again.'; return; }
  S.user = role; try { sessionStorage.setItem('pqc-user', role); } catch (e) { /* ignore */ }
  showApp();
}

function act(a, el) {
  switch (a) {
    case 'logout': showLogin(); return;
    case 'submit': {
      const code = isAdmin() ? $('#sjDept').value : S.user, id = $('#sjId').value, t = $('#sjTime').value, r = submitJob(code, id, t);
      S.msg = { t: r.ok ? 'ok' : 'err', x: r.text };
      S.keep = r.ok ? { sjDept: code, focus: true } : { sjId: id, sjTime: t, sjDept: code }; render(); return;
    }
    case 'del': deleteJob(Number(el.dataset.idx)); render(); return;
    case 'addDept': { const r = addDept($('#mgCode').value, $('#mgPin').value); S.msg = { t: r.ok ? 'ok' : 'err', x: r.text }; render(); return; }
    case 'rmDept': if (confirm('Remove branch ' + el.dataset.code + ' and all its jobs?')) { removeDept(el.dataset.code); render(); } return;
    case 'merge': runMerge(); render(); return;
    case 'vNext': vizStep(1); return;
    case 'vPrev': vizStep(-1); return;
    case 'vReset': stopViz(); V.i = -1; updateViz(); return;
    case 'vPlay':
      if (V.timer) { stopViz(); updateViz(); return; }
      if (V.i >= S.merged.events.length - 1) V.i = -1;
      V.timer = setInterval(() => vizStep(1), V.speed); updateViz(); return;
    case 'spLoad': spLoad(); render(); return;
    case 'spPrint': spPrint(); render(); return;
    case 'spAuto':
      if (S.sp.timer) stopSpool(); else S.sp.timer = setInterval(spPrint, 700);
      render(); return;
    case 'bench': runBench(); return;
  }
}
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-act],[data-nav]'); if (!t) return;
  if (t.dataset.nav) go(t.dataset.nav); else act(t.dataset.act, t);
});
document.addEventListener('change', (e) => {
  if (e.target.dataset.change === 'vSpeed') { V.speed = Number(e.target.value); if (V.timer) { stopViz(); V.timer = setInterval(() => vizStep(1), V.speed); } }
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (e.target.id === 'loginPin') doLogin();
  else if (e.target.id === 'sjId' || e.target.id === 'sjTime') act('submit');
  else if (e.target.id === 'mgCode' || e.target.id === 'mgPin') act('addDept');
});
$('#loginBtn').addEventListener('click', doLogin);

// ----------------------------------------------------------------- start
load(); rebuild();
let saved = null; try { saved = sessionStorage.getItem('pqc-user'); } catch (e) { saved = null; }
if (saved && (saved === 'admin' || deptByCode(saved))) { S.user = saved; showApp(); } else showLogin();
})();
