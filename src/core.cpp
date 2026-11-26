// =============================================================================
//  core.cpp  -  Print Queue Consolidation System : DSA core
//
//  Everything here is hand-built: NO STL containers or algorithms.
//  Structures used (syllabus Module 2 and 3):
//    * Singly linked list used as a linked queue (head + tail pointers)
//    * Dynamic array (IntArr) that doubles when full
//    * Min-heap priority queue (array based) with sift-down / Floyd heapify
//    * Circular queue (static array) for the printer spooler
//
//  Tie rule : compare (time) first, then department code (given as a rank).
//             Within a department the original order is kept because only ONE
//             job per department is ever inside the heap.
//  Merge    : k-way merge, O(N log k), never re-sorts the collected jobs.
//
//  All exported functions use plain ints so they can be called from
//  WebAssembly/JavaScript without any glue code.
// =============================================================================
#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#define API extern "C" EMSCRIPTEN_KEEPALIVE
#else
#define API extern "C"
#endif

#define MAX_DEPTS 200

enum { EV_INSERT = 1, EV_HEAPIFY, EV_CMP, EV_SWAP, EV_EXTRACT, EV_REPLACE, EV_REMOVE, EV_DONE };

// ---------------------------------------------------------------- basic types
struct Node  { int job, time, dept; Node* next; };           // one print job
struct Queue { Node* head; Node* tail; int count; };         // linked queue

struct IntArr {                                               // dynamic array
    int* a; int n; int cap;
    void push(int v) {
        if (n == cap) {
            int nc = cap ? cap * 2 : 64;
            int* b = new int[nc];
            for (int i = 0; i < n; i++) b[i] = a[i];
            delete[] a; a = b; cap = nc;
        }
        a[n++] = v;
    }
    void clear() { n = 0; }
};

// ------------------------------------------------------------ linked queue ops
static void q_init(Queue& q) { q.head = q.tail = nullptr; q.count = 0; }

static void q_push(Queue& q, int job, int time, int dept) {   // O(1) enqueue
    Node* n = new Node{job, time, dept, nullptr};
    if (q.tail) q.tail->next = n; else q.head = n;
    q.tail = n; q.count++;
}

static bool q_remove(Queue& q, int job) {                     // O(n) deletion
    Node* prev = nullptr; Node* cur = q.head;
    while (cur) {
        if (cur->job == job) {
            if (prev) prev->next = cur->next; else q.head = cur->next;
            if (cur == q.tail) q.tail = prev;
            delete cur; q.count--; return true;
        }
        prev = cur; cur = cur->next;
    }
    return false;
}

static void q_clear(Queue& q) {
    while (q.head) { Node* t = q.head; q.head = t->next; delete t; }
    q.tail = nullptr; q.count = 0;
}

// ---------------------------------------------------------------- global state
static Queue Q[MAX_DEPTS];            // one linked queue per department slot
static int   RANK[MAX_DEPTS];         // alphabetical rank of the department code
static Node* TL_head; static Node* TL_tail; static int TL_n;   // merged timeline
static int   RECEIVED, ACTIVE, ST_ins, ST_ext, ST_cmp;
static IntArr LOG, LOGIDX, EX;        // step log, log index, export buffer
static int   BENCH[4];
static int*  SP; static int SPcap, SPf, SPr, SPn;              // circular queue

static void tl_free() {
    while (TL_head) { Node* t = TL_head; TL_head = t->next; delete t; }
    TL_tail = nullptr; TL_n = 0;
}
static void tl_push(int job, int time, int dept) {            // O(1) append
    Node* n = new Node{job, time, dept, nullptr};
    if (TL_tail) TL_tail->next = n; else TL_head = n;
    TL_tail = n; TL_n++;
}

// ------------------------------------------------------------- k-way merger
struct Merger {
    Queue* qs; const int* rank; int k;
    Node* cur[MAX_DEPTS];         // pointer to each department's next job
    int   pos[MAX_DEPTS];         // its position inside the department queue
    int   heap[MAX_DEPTS];        // min-heap of department indices
    int   hn, ins, ext, cmp;
    bool  logOn, buildTL;
};

// Step log record: type,a,b,c,d,heapSize, then (dept,job,time) per heap slot.
static void ev(Merger& m, int type, int a, int b, int c, int d) {
    if (!m.logOn) return;
    LOGIDX.push(LOG.n);
    LOG.push(type); LOG.push(a); LOG.push(b); LOG.push(c); LOG.push(d); LOG.push(m.hn);
    for (int i = 0; i < m.hn; i++) {
        Node* x = m.cur[m.heap[i]];
        LOG.push(m.heap[i]); LOG.push(x->job); LOG.push(x->time);
    }
}

// Is the job at heap position x strictly before the job at position y?
static bool before(Merger& m, int x, int y) {
    Node* p = m.cur[m.heap[x]]; Node* q = m.cur[m.heap[y]];
    m.cmp++;
    bool tie = (p->time == q->time);
    bool r = tie ? (m.rank[m.heap[x]] < m.rank[m.heap[y]]) : (p->time < q->time);
    ev(m, EV_CMP, x, y, r ? 1 : 0, tie ? 1 : 0);
    return r;
}

static void sift_down(Merger& m, int i) {                     // O(log k)
    for (;;) {
        int l = 2 * i + 1, r = l + 1;
        if (l >= m.hn) return;
        int c = l;
        if (r < m.hn && before(m, r, l)) c = r;               // smaller child
        if (!before(m, c, i)) return;                         // heap property ok
        int t = m.heap[c]; m.heap[c] = m.heap[i]; m.heap[i] = t;
        ev(m, EV_SWAP, i, c, 0, 0);
        i = c;
    }
}

static void merge_run(Merger& m) {
    m.hn = 0; m.ins = m.ext = m.cmp = 0;
    // 1. put the front job of every non-empty queue into the heap array
    for (int d = 0; d < m.k; d++) {
        m.cur[d] = m.qs[d].head; m.pos[d] = 0;
        if (m.cur[d]) { m.heap[m.hn++] = d; m.ins++; ev(m, EV_INSERT, d, m.hn - 1, 0, 0); }
    }
    // 2. Floyd's bottom-up heapify: O(k)
    for (int i = m.hn / 2 - 1; i >= 0; i--) { ev(m, EV_HEAPIFY, i, 0, 0, 0); sift_down(m, i); }
    // 3. repeatedly take the minimum
    while (m.hn > 0) {
        int d = m.heap[0]; Node* n = m.cur[d];
        if (m.buildTL) tl_push(n->job, n->time, d);
        ev(m, EV_EXTRACT, d, n->job, n->time, m.ext);
        m.ext++;
        if (n->next) {                    // same department's next job replaces the root
            m.cur[d] = n->next; m.pos[d]++; m.ins++;
            ev(m, EV_REPLACE, d, m.pos[d], n->next->job, n->next->time);
        } else {                          // department finished: last element fills root
            m.cur[d] = nullptr; m.hn--; m.heap[0] = m.heap[m.hn];
            ev(m, EV_REMOVE, d, m.qs[d].count, 0, 0);
        }
        if (m.hn > 1) sift_down(m, 0);
    }
    ev(m, EV_DONE, 0, 0, 0, 0);
}

// =============================================================== exported API
API void init() {
    for (int d = 0; d < MAX_DEPTS; d++) { q_clear(Q[d]); RANK[d] = d; }
    tl_free(); LOG.clear(); LOGIDX.clear(); EX.clear();
    RECEIVED = ACTIVE = ST_ins = ST_ext = ST_cmp = 0;
}
API void set_rank(int d, int r) { if (d >= 0 && d < MAX_DEPTS) RANK[d] = r; }

// 0 = ok, 1 = time earlier than the last job of that queue, 2 = bad department, 3 = bad time
API int add_job(int d, int time, int job) {
    if (d < 0 || d >= MAX_DEPTS) return 2;
    if (time < 0) return 3;
    if (Q[d].tail && time < Q[d].tail->time) return 1;
    q_push(Q[d], job, time, d);
    return 0;
}
API int  delete_job(int d, int job) { return (d >= 0 && d < MAX_DEPTS && q_remove(Q[d], job)) ? 1 : 0; }
API void clear_queue(int d)         { if (d >= 0 && d < MAX_DEPTS) q_clear(Q[d]); }
API int  q_count(int d)             { return (d >= 0 && d < MAX_DEPTS) ? Q[d].count : 0; }

// Copy a queue / the timeline into the export buffer (one traversal), then read O(1).
API int export_queue(int d) {
    EX.clear();
    if (d < 0 || d >= MAX_DEPTS) return 0;
    for (Node* p = Q[d].head; p; p = p->next) { EX.push(p->job); EX.push(p->time); EX.push(p->dept); }
    return Q[d].count;
}
API int export_timeline() {
    EX.clear();
    for (Node* p = TL_head; p; p = p->next) { EX.push(p->job); EX.push(p->time); EX.push(p->dept); }
    return TL_n;
}
API int exp_job(int i)  { return (i >= 0 && 3 * i < EX.n) ? EX.a[3 * i]     : -1; }
API int exp_time(int i) { return (i >= 0 && 3 * i < EX.n) ? EX.a[3 * i + 1] : -1; }
API int exp_dept(int i) { return (i >= 0 && 3 * i < EX.n) ? EX.a[3 * i + 2] : -1; }

API int merge(int logOn) {
    tl_free(); LOG.clear(); LOGIDX.clear();
    Merger m;
    m.qs = Q; m.rank = RANK; m.k = MAX_DEPTS; m.logOn = (logOn != 0); m.buildTL = true;
    RECEIVED = ACTIVE = 0;
    for (int d = 0; d < MAX_DEPTS; d++) { RECEIVED += Q[d].count; if (Q[d].count) ACTIVE++; }
    merge_run(m);
    ST_ins = m.ins; ST_ext = m.ext; ST_cmp = m.cmp;
    return TL_n;
}
API int tl_len() { return TL_n; }
// 0 received, 1 produced, 2 heap insertions, 3 heap extractions, 4 comparisons, 5 active departments
API int stat(int i) {
    switch (i) {
        case 0: return RECEIVED; case 1: return TL_n; case 2: return ST_ins;
        case 3: return ST_ext;   case 4: return ST_cmp; case 5: return ACTIVE;
    }
    return 0;
}

// 1 if the timeline is complete and correctly ordered (time, dept code, original order)
API int verify_timeline() {
    if (TL_n != RECEIVED) return 0;
    for (Node* p = TL_head; p && p->next; p = p->next) {
        Node* q = p->next;
        if (p->time > q->time) return 0;
        if (p->time == q->time) {
            if (p->dept != q->dept) { if (RANK[p->dept] > RANK[q->dept]) return 0; }
            else if (p->job > q->job) return 0;
        }
    }
    return 1;
}

API int log_len() { return LOGIDX.n; }
API int log_field(int i, int f) {
    if (i < 0 || i >= LOGIDX.n) return -1;
    int idx = LOGIDX.a[i] + f;
    return (idx < LOG.n) ? LOG.a[idx] : -1;
}

// ----------------------------------------------- circular queue (printer spool)
API void spool_init(int cap) {
    delete[] SP;
    if (cap < 1) cap = 1;
    SP = new int[cap]; SPcap = cap; SPf = SPr = SPn = 0;
    for (int i = 0; i < cap; i++) SP[i] = -1;
}
API int spool_enqueue(int job) {
    if (!SP || SPn == SPcap) return 0;                        // full
    SP[SPr] = job; SPr = (SPr + 1) % SPcap; SPn++; return 1;
}
API int spool_dequeue() {
    if (!SP || SPn == 0) return -1;                           // empty
    int j = SP[SPf]; SP[SPf] = -1; SPf = (SPf + 1) % SPcap; SPn--; return j;
}
API int spool_size()  { return SPn; }
API int spool_front() { return SPf; }
API int spool_rear()  { return SPr; }
API int spool_cap()   { return SPcap; }
API int spool_slot(int i) { return (SP && i >= 0 && i < SPcap) ? SP[i] : -1; }

// ------------------------------------------- benchmark: heap merge vs naive scan
static unsigned int seed_;
static unsigned int rnd() { seed_ = seed_ * 1664525u + 1013904223u; return seed_ >> 8; }

// Builds n synthetic jobs (many equal times) over k departments, then counts the
// comparisons used by the heap merge and by a naive "scan every front" merge.
API int bench(int k, int n) {
    if (k < 1 || k > MAX_DEPTS || n < 0) return 0;
    Queue* qs = new Queue[k];
    int ranks[MAX_DEPTS]; int last[MAX_DEPTS];
    for (int d = 0; d < k; d++) { q_init(qs[d]); ranks[d] = d; last[d] = 0; }
    seed_ = 12345u;
    for (int j = 0; j < n; j++) {
        int d = (int)(rnd() % (unsigned)k);
        last[d] += (int)(rnd() % 4u);                         // step 0..3 -> ties
        q_push(qs[d], j, last[d], d);
    }
    Merger m;
    m.qs = qs; m.rank = ranks; m.k = k; m.logOn = false; m.buildTL = false;
    merge_run(m);
    BENCH[0] = m.cmp; BENCH[2] = m.ins; BENCH[3] = m.ext;

    Node* cur[MAX_DEPTS]; int cmp = 0;                        // naive baseline: O(N*k)
    for (int d = 0; d < k; d++) cur[d] = qs[d].head;
    for (;;) {
        int best = -1;
        for (int d = 0; d < k; d++) {
            if (!cur[d]) continue;
            if (best < 0) { best = d; continue; }
            cmp++;
            if (cur[d]->time < cur[best]->time) best = d;     // earlier d wins ties
        }
        if (best < 0) break;
        cur[best] = cur[best]->next;
    }
    BENCH[1] = cmp;
    for (int d = 0; d < k; d++) q_clear(qs[d]);
    delete[] qs;
    return 1;
}
API int bench_stat(int i) { return (i >= 0 && i < 4) ? BENCH[i] : 0; }

// ------------------------------------------------------------ Day-1 stubs
API int  job_exists(int job)          { (void)job; return 0; }
API int  job_dept(int job)            { (void)job; return -1; }
API int  job_time(int job)            { (void)job; return -1; }
API int  set_duration(int job, int d) { (void)job; (void)d; return 1; }
API int  get_duration(int job)        { (void)job; return -1; }
API int  add_job_raw(int d, int time, int job) {
    if (d < 0 || d >= MAX_DEPTS) return 2;
    if (time < 0) return 3;
    q_push(Q[d], job, time, d);
    return 0;
}
API int  sort_queue(int d)            { return (d < 0 || d >= MAX_DEPTS) ? -1 : Q[d].count; }
API int  is_sorted(int d)             { (void)d; return 1; }
API int  undo()                       { return 0; }
API int  redo()                       { return 0; }
API int  undo_count()                 { return 0; }
API int  redo_count()                 { return 0; }
API int  op_field(int f)              { (void)f; return -1; }
API int  merge_lt(int logOn)          { (void)logOn; return merge(0); }
API int  merge_naive()                { return merge(0); }
API int  tl_job(int i)                { (void)i; return -1; }
API int  tl_time(int i)               { (void)i; return -1; }
API int  tl_dept(int i)               { (void)i; return -1; }
API int  tl_lower_bound(int t)        { (void)t; return 0; }
API int  tl_upper_bound(int t)        { (void)t; return 0; }
API int  find_in_timeline(int job)    { (void)job; return -1; }
API int  sched_run(int printers)      { (void)printers; return -1; }
API int  sched_count()                { return 0; }
API int  sched_job(int i)             { (void)i; return -1; }
API int  sched_printer(int i)         { (void)i; return -1; }
API int  sched_start(int i)           { (void)i; return -1; }
API int  sched_end(int i)             { (void)i; return -1; }
API int  sched_load(int p)            { (void)p; return 0; }
API int  spool_cancel(int job)        { (void)job; return 0; }
API void spool_pause(int flag)        { (void)flag; }
API int  spool_paused()               { return 0; }
