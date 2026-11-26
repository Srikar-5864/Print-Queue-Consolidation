// tests.cpp - self-contained tests (no testing library). Run: ./run_tests.sh
#include "core.cpp"
#include <cstdio>

static int passed = 0, failed = 0;
#define CHECK(cond, name) do { if (cond) { passed++; printf("  PASS  %s\n", name); } \
    else { failed++; printf("  FAIL  %s\n", name); } } while (0)

// Reads the merged timeline as job numbers into out[]; returns its length.
static int timeline(int* out) {
    int n = export_timeline();
    for (int i = 0; i < n; i++) out[i] = exp_job(i);
    return n;
}
static bool same(const int* a, const int* b, int n) {
    for (int i = 0; i < n; i++) if (a[i] != b[i]) return false;
    return true;
}

static void test_example() {
    printf("[1] Example from the problem statement\n");
    init();
    // A(slot0): A2 A7 A9 = jobs 0,1,2   B(slot1): B1 B7 = jobs 3,4   C(slot2): C3 C10 = jobs 5,6
    add_job(0, 2, 0); add_job(0, 7, 1); add_job(0, 9, 2);
    add_job(1, 1, 3); add_job(1, 7, 4);
    add_job(2, 3, 5); add_job(2, 10, 6);
    int out[16]; merge(0);
    int n = timeline(out);
    int expect[] = {3, 0, 5, 1, 4, 2, 6};                     // B1 A2 C3 A7 B7 A9 C10
    CHECK(n == 7 && same(out, expect, 7), "order is B1 A2 C3 A7 B7 A9 C10");
    CHECK(stat(0) == 7 && stat(1) == 7, "received (7) equals produced (7)");
    CHECK(verify_timeline() == 1, "verify_timeline accepts the result");
}

static void test_ties() {
    printf("[2] Ties: equal times ordered by department code, original order kept\n");
    init();
    // slot0 has the LARGEST code rank (3), slot3 the smallest (0): proves rank is used.
    set_rank(0, 3); set_rank(1, 2); set_rank(2, 1); set_rank(3, 0);
    int job = 0;
    for (int d = 0; d < 4; d++) { add_job(d, 5, job++); add_job(d, 5, job++); }   // all time 5
    int out[16]; merge(0);
    int n = timeline(out);
    int expect[] = {6, 7, 4, 5, 2, 3, 0, 1};                  // dept3, dept2, dept1, dept0
    CHECK(n == 8 && same(out, expect, 8), "department rank breaks ties, same-dept order kept");
    CHECK(verify_timeline() == 1, "verify_timeline accepts tied result");
}

static void test_empty() {
    printf("[3] Empty queues\n");
    init();
    CHECK(merge(0) == 0 && stat(0) == 0 && stat(1) == 0, "all queues empty -> empty timeline");
    CHECK(verify_timeline() == 1, "empty result verifies");
    init(); set_rank(1, 1);
    add_job(0, 4, 0); add_job(2, 1, 1); add_job(2, 9, 2); add_job(5, 3, 3);   // slots 1,3,4 empty
    int out[8]; merge(0);
    int n = timeline(out);
    int expect[] = {1, 3, 0, 2};
    CHECK(n == 4 && same(out, expect, 4) && stat(5) == 3, "empty queues in the middle are skipped");
}

static void test_uneven() {
    printf("[4] Uneven sizes\n");
    init();
    for (int i = 0; i < 1000; i++) add_job(0, i * 2, i);       // long queue: even times
    add_job(1, 3, 1000);                                       // single job
    add_job(2, 1999, 1001);
    merge(0);
    CHECK(tl_len() == 1002 && verify_timeline() == 1, "1000 + 1 + 1 jobs merge correctly");
    init(); add_job(0, 8, 0); add_job(0, 8, 1);
    merge(0);
    CHECK(tl_len() == 2 && verify_timeline() == 1, "single department works");
}

static void test_validation_and_delete() {
    printf("[5] Validation and linked-list deletion\n");
    init();
    CHECK(add_job(0, 10, 0) == 0, "first job accepted");
    CHECK(add_job(0, 10, 1) == 0, "equal time accepted");
    CHECK(add_job(0, 9, 2) == 1, "earlier time rejected (queue must stay sorted)");
    CHECK(add_job(300, 1, 3) == 2, "bad department rejected");
    add_job(0, 20, 4); add_job(0, 30, 5);
    CHECK(delete_job(0, 0) == 1, "delete head");
    CHECK(delete_job(0, 4) == 1, "delete middle");
    CHECK(delete_job(0, 5) == 1, "delete tail");
    CHECK(add_job(0, 12, 6) == 0, "tail pointer repaired after deleting tail");
    CHECK(add_job(0, 11, 7) == 1, "last time is now 12 after deletion");
    CHECK(q_count(0) == 2 && delete_job(0, 99) == 0, "count correct, missing job not found");
    merge(0);
    CHECK(tl_len() == 2 && verify_timeline() == 1, "merge after deletions is correct");
}

static void test_many_queues() {
    printf("[6] Many input queues (200 departments, 100000 jobs)\n");
    init();
    seed_ = 777u;
    int last[MAX_DEPTS];
    for (int d = 0; d < MAX_DEPTS; d++) last[d] = 0;
    for (int j = 0; j < 100000; j++) {
        int d = (int)(rnd() % MAX_DEPTS);
        last[d] += (int)(rnd() % 3u);                          // lots of ties
        add_job(d, last[d], j);
    }
    merge(0);
    CHECK(stat(0) == 100000 && stat(1) == 100000, "100000 jobs received and produced");
    CHECK(verify_timeline() == 1, "ordering, tie rule and per-department order verified");
    CHECK(stat(5) == 200, "200 active departments");
    int bound = 100000 * 16;                                   // 2 compares/level * ~8 levels
    CHECK(stat(4) < bound, "comparisons stay within N * 2*log2(k)");
    int ids = export_timeline(), ok = 1;
    for (int i = 0; i < ids && ok; i++) if (exp_job(i) < 0 || exp_job(i) >= 100000) ok = 0;
    CHECK(ok, "every identifier is a valid original job id");
}

static void test_growth() {
    printf("[7] Work grows slowly as departments are added\n");
    int ks[] = {2, 5, 10, 50, 100, 200}; int heap[6], naive[6];
    for (int i = 0; i < 6; i++) { bench(ks[i], 100000); heap[i] = bench_stat(0); naive[i] = bench_stat(1); }
    for (int i = 0; i < 6; i++) printf("      k=%3d  heap=%8d  naive=%9d\n", ks[i], heap[i], naive[i]);
    CHECK(heap[5] < naive[5] / 10, "at k=200 the heap needs far fewer comparisons than the naive scan");
    CHECK(heap[5] < heap[0] * 12, "heap comparisons grow roughly with log k");
    CHECK(bench_stat(3) == 100000, "bench extracts every job exactly once");
}

static void test_log_and_spooler() {
    printf("[8] Step log and circular-queue spooler\n");
    init();
    add_job(0, 2, 0); add_job(0, 7, 1); add_job(1, 1, 2); add_job(1, 7, 3);
    merge(1);
    int n = log_len(), ex = 0;
    for (int i = 0; i < n; i++) if (log_field(i, 0) == EV_EXTRACT) ex++;
    CHECK(n > 0 && log_field(n - 1, 0) == EV_DONE && ex == 4, "log ends with DONE and has 4 EXTRACT events");
    spool_init(3);
    CHECK(spool_enqueue(10) && spool_enqueue(11) && spool_enqueue(12), "fills to capacity");
    CHECK(spool_enqueue(13) == 0, "full queue rejects an enqueue");
    CHECK(spool_dequeue() == 10 && spool_enqueue(13) == 1, "dequeue frees a slot; rear wraps around");
    CHECK(spool_dequeue() == 11 && spool_dequeue() == 12 && spool_dequeue() == 13, "FIFO order kept across wrap-around");
    CHECK(spool_dequeue() == -1 && spool_size() == 0, "empty queue returns -1");
}

static void test_hash_table() {
    printf("[9] A1: Hash table for job IDs\n");
    init();
    CHECK(add_job(0, 5, 100) == 0, "insert job 100");
    CHECK(add_job(1, 6, 100) == 4, "duplicate job ID rejected with 4");
    CHECK(add_job_raw(1, 6, 100) == 4, "add_job_raw duplicate rejected with 4");
    CHECK(job_exists(100) == 1 && job_dept(100) == 0 && job_time(100) == 5, "lookup returns correct dept and time");
    CHECK(get_duration(100) == 1 && set_duration(100, 7) == 1 && get_duration(100) == 7, "duration default 1, set to 7");
    CHECK(set_duration(100, 0) == 0 && set_duration(999, 3) == 0, "invalid duration or unknown job rejected");
    CHECK(delete_job(0, 100) == 1 && job_exists(100) == 0 && job_dept(100) == -1 && job_time(100) == -1, "lookup after delete gives exists 0");
    CHECK(add_job(0, 5, 100) == 0, "deleted job ID can be reinserted");
    clear_queue(0);
    CHECK(job_exists(100) == 0, "clear_queue removes jobs from hash table");

    init();
    int ok = 1;
    for (int i = 0; i < 100000; i++) {
        if (add_job(i % MAX_DEPTS, i, i) != 0) { ok = 0; break; }
    }
    for (int i = 0; i < 100000 && ok; i += 97) {
        if (!job_exists(i) || job_dept(i) != (i % MAX_DEPTS) || job_time(i) != i) ok = 0;
    }
    CHECK(ok && HT_cap > 128, "100,000 inserts trigger resizes and all lookups succeed");

    // Many IDs forced into same/similar buckets (multiples of HT_cap)
    init();
    int cap0 = HT_cap;
    int col_ok = 1;
    for (int i = 0; i < 50; i++) {
        if (add_job(0, i, i * cap0) != 0) col_ok = 0;
    }
    for (int i = 0; i < 50; i++) {
        if (job_exists(i * cap0) != 1 || job_time(i * cap0) != i) col_ok = 0;
    }
    CHECK(col_ok, "many IDs with colliding patterns still work");
}

static void test_sort_queue() {
    printf("[10] A2: Stable merge sort on a linked queue\n");
    init();
    CHECK(sort_queue(-1) == -1 && sort_queue(MAX_DEPTS) == -1, "bad department returns -1");
    CHECK(is_sorted(0) == 1 && sort_queue(0) == 0, "empty queue is sorted and returns 0");
    add_job_raw(0, 42, 10);
    CHECK(is_sorted(0) == 1 && sort_queue(0) == 1 && is_sorted(0) == 1, "one-job queue stays sorted");

    // Unsorted with equal times to verify stability
    init();
    add_job_raw(0, 10, 101);
    add_job_raw(0, 5, 102);
    add_job_raw(0, 10, 103);
    add_job_raw(0, 2, 104);
    add_job_raw(0, 5, 105);
    add_job_raw(0, 10, 106);
    set_duration(103, 9);
    CHECK(is_sorted(0) == 0, "unsorted queue reports is_sorted == 0");
    CHECK(sort_queue(0) == 6 && is_sorted(0) == 1, "sort_queue returns 6 and is_sorted becomes 1");
    export_queue(0);
    int expect_ids[] = {104, 102, 105, 101, 103, 106};
    int ok = 1;
    for (int i = 0; i < 6; i++) if (exp_job(i) != expect_ids[i]) ok = 0;
    CHECK(ok, "equal times keep their original relative order (stable)");
    CHECK(job_exists(103) == 1 && get_duration(103) == 9 && job_time(103) == 10, "hash table untouched by sorting");
    CHECK(add_job(0, 10, 107) == 0 && add_job(0, 9, 108) == 1, "tail pointer updated after sort");

    // Already sorted stays unchanged
    CHECK(sort_queue(0) == 7 && is_sorted(0) == 1, "already sorted input stays sorted");

    // 100,000 jobs unsorted
    init();
    seed_ = 4242u;
    for (int j = 0; j < 100000; j++) {
        add_job_raw(0, (int)(rnd() % 10000u), j);
    }
    CHECK(sort_queue(0) == 100000 && is_sorted(0) == 1, "100,000 unsorted jobs sort cleanly");
}

static void test_undo_redo() {
    printf("[11] A3: Undo and redo with two stacks\n");
    init();
    CHECK(undo() == 0 && redo() == 0 && undo_count() == 0 && redo_count() == 0, "undo/redo on empty return 0");
    CHECK(op_field(0) == -1, "op_field is -1 before any undo/redo");

    add_job(0, 10, 1); add_job(0, 20, 2); add_job(0, 30, 3);
    set_duration(2, 5);
    CHECK(undo_count() == 3 && redo_count() == 0, "3 adds recorded");
    CHECK(delete_job(0, 2) == 1 && job_exists(2) == 0 && q_count(0) == 2, "middle delete removes job 2");
    CHECK(undo() == 1 && op_field(0) == 2 && op_field(1) == 0 && op_field(2) == 2 && op_field(3) == 20, "undo of delete reports op_field");
    export_queue(0);
    CHECK(q_count(0) == 3 && exp_job(0) == 1 && exp_job(1) == 2 && exp_job(2) == 3, "undo of middle delete restores exact position");
    CHECK(get_duration(2) == 5, "duration survives undo of a delete");
    CHECK(redo() == 1 && q_count(0) == 2 && job_exists(2) == 0, "redo reapplies the delete");
    CHECK(undo() == 1 && q_count(0) == 3, "undo again restores job 2");

    // New add clears redo stack
    redo();
    CHECK(redo_count() == 0, "redo_count is 0 after redo");
    undo();
    CHECK(redo_count() == 1, "redo_count is 1 after undo");
    add_job(0, 40, 4);
    CHECK(redo_count() == 0, "new add clears redo stack");

    // 1000 random operations undone fully returns to empty state
    init();
    seed_ = 98765u;
    int next_id = 1;
    int active_ids[1000]; int active_n = 0;
    for (int i = 0; i < 1000; i++) {
        if (active_n == 0 || (rnd() % 3u) != 0) {
            int d = (int)(rnd() % 5u);
            int t = Q[d].tail ? Q[d].tail->time + (int)(rnd() % 5u) : (int)(rnd() % 10u);
            add_job(d, t, next_id);
            active_ids[active_n++] = next_id++;
        } else {
            int pick = (int)(rnd() % (unsigned)active_n);
            int jid = active_ids[pick];
            int d = job_dept(jid);
            delete_job(d, jid);
            active_ids[pick] = active_ids[--active_n];
        }
    }
    CHECK(undo_count() == 1000, "1000 operations recorded");
    while (undo()) {}
    int total_left = 0;
    for (int d = 0; d < 5; d++) total_left += q_count(d);
    CHECK(total_left == 0 && undo_count() == 0 && redo_count() == 1000, "undoing all 1000 ops returns to empty state");
}

static void test_loser_and_naive_merge() {
    printf("[12] A4: Loser tree merge and naive merge\n");
    // Empty and single queue
    init();
    CHECK(merge_lt(0) == 0 && stat(6) == 1 && merge_naive() == 0 && stat(6) == 2, "empty merges work and set stat(6)");
    add_job(3, 10, 1); add_job(3, 20, 2);
    CHECK(merge_lt(0) == 2 && verify_timeline() == 1 && stat(0) == 2 && stat(1) == 2, "single non-empty queue loser tree");
    CHECK(merge_naive() == 2 && verify_timeline() == 1 && stat(0) == 2 && stat(1) == 2, "single non-empty queue naive");

    // 50 random scenarios: all 3 merges produce identical timelines
    seed_ = 54321u;
    int all_match = 1;
    int h_out[600], l_out[600], n_out[600];
    for (int sc = 0; sc < 50; sc++) {
        init();
        int k = 1 + (int)(rnd() % 20u);
        int perm[20]; for (int d = 0; d < k; d++) perm[d] = d;
        for (int d = k - 1; d > 0; d--) { int j = (int)(rnd() % (unsigned)(d + 1)); int t = perm[d]; perm[d] = perm[j]; perm[j] = t; }
        for (int d = 0; d < k; d++) set_rank(d, perm[d]);
        int last[20]; for (int d = 0; d < 20; d++) last[d] = 0;
        int n = (int)(rnd() % 500u);
        for (int j = 0; j < n; j++) {
            int d = (int)(rnd() % (unsigned)k);
            last[d] += (int)(rnd() % 4u);
            add_job(d, last[d], j);
        }
        int hl = merge(0);
        if (stat(6) != 0 || verify_timeline() != 1) all_match = 0;
        timeline(h_out);
        int ll = merge_lt(0);
        if (stat(6) != 1 || stat(0) != n || stat(1) != n || verify_timeline() != 1) all_match = 0;
        timeline(l_out);
        int nl = merge_naive();
        if (stat(6) != 2 || stat(0) != n || stat(1) != n || verify_timeline() != 1) all_match = 0;
        timeline(n_out);
        if (hl != ll || hl != nl || !same(h_out, l_out, hl) || !same(h_out, n_out, hl)) all_match = 0;
    }
    CHECK(all_match, "50 random scenarios: heap, loser tree, and naive produce identical timelines");

    // Big benchmark: loser tree comparisons <= heap comparisons
    bench(200, 100000);
    printf("      k=200  heap=%8d  loser=%8d  naive=%9d\n", bench_stat(0), bench_stat(4), bench_stat(1));
    CHECK(bench_stat(4) > 0 && bench_stat(4) <= bench_stat(0), "loser tree comparisons <= heap on k=200, N=100000");
}

int main(int argc, char** argv) {
    (void)argv;
    test_example(); test_ties(); test_empty(); test_uneven();
    test_validation_and_delete(); test_many_queues(); test_growth(); test_log_and_spooler();
    test_hash_table(); test_sort_queue(); test_undo_redo(); test_loser_and_naive_merge();
    if (argc > 1) {                                           // cross-check dump for the JS port
        init(); add_job(0, 2, 0); add_job(0, 7, 1); add_job(0, 9, 2); add_job(1, 1, 3);
        add_job(1, 7, 4); add_job(2, 3, 5); add_job(2, 10, 6);
        merge(1); printf("DUMP example cmp=%d ins=%d ext=%d log=%d\n", stat(4), stat(2), stat(3), log_len());
        bench(7, 500); printf("DUMP bench7 %d %d %d %d\n", bench_stat(0), bench_stat(1), bench_stat(2), bench_stat(3));
        bench(200, 100000); printf("DUMP bench200 %d %d\n", bench_stat(0), bench_stat(1));
    }
    printf("\n%d passed, %d failed\n", passed, failed);
    return failed ? 1 : 0;
}
