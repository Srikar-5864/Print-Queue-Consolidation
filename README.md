# Print Queue Consolidation System

Problem: **The Printing Office's Conflicting Logs** (Linked Lists and Priority Processing).
Every department's print jobs are already in time order. The system merges all of them into
one complete, predictable timeline: nothing lost, no ID changed.

```
A: [A2, A7, A9]   B: [B1, B7]   C: [C3, C10]     (numbers are times)
merged: B1, A2, C3, A7, B7, A9, C10
```

## What is inside

| Path | Purpose |
|---|---|
| `src/core.cpp` | The DSA core in C++. No STL containers, no predefined libraries |
| `src/tests.cpp` | 35 checks: ties, empty queues, uneven sizes, validation, deletion, 200 queues / 100,000 jobs, growth, spooler |
| `web/` | The website: login, queues, merge report, DSA visualizer, print spooler, scalability chart |
| `web/core_js.js` | Hand-written JavaScript twin of the C++ core (fallback, see below) |
| `build_wasm.sh` | Compiles `core.cpp` to `web/core.wasm` with Emscripten |
| `run_tests.sh` | Compiles and runs the C++ tests with g++ |

## Run the tests

```
./run_tests.sh
```

## Run the website

```
cd web
python3 -m http.server 8000
```
Open http://localhost:8000 . Serving over http is needed so the browser may load `core.wasm`.

**WebAssembly:** run `./build_wasm.sh` once (requires Emscripten) to create `web/core.wasm`.
The site loads it and runs the real C++ code in the browser. If `core.wasm` is missing, the site
automatically uses `web/core_js.js`, a line-by-line port of the same algorithms, so everything
still works. The dashboard shows which engine is active ("Wasm" or "JS port").
The JS port was checked against the C++ build and gives identical orders and identical
comparison counts.

## Logins (simulated in the browser, not secure)

* Branch: choose the branch (CSE, ECE, ISE, ME, CV, EEE) and PIN `1234`.
  A branch sees only its own queue, can submit jobs and delete its pending jobs.
* Operator: choose "Operator (Admin)" and PIN `admin`. The operator submits for any branch,
  adds or removes branches (up to 200), runs the merge, and opens the visualizer, spooler and chart.

Jobs are entered **manually** (Job ID + time). A job is rejected if its time is earlier than the
branch's last job (queues must stay sorted) or if its ID already exists. Data is kept in the browser's
local storage, so it survives a refresh.

## How it works

* **Job node**: `id`, `time`, `dept`, `next`.
* **Department queue**: singly linked list with head and tail pointers. Enqueue is O(1), delete is O(n).
* **Min-heap priority queue**: hand-built array heap holding only the *front job of each department*.
  Built with Floyd's heapify, O(k). After each extraction the same department's next job takes the root
  and one sift-down repairs the heap, so there is one O(log k) repair per output job.
* **K-way merge**: take the smallest, advance that department's pointer, repair the heap.
  Total work **O(N log k)** for N jobs and k departments. Collected jobs are never re-sorted.
* **Merged timeline**: a linked queue with O(1) appends.
* **Printer spooler**: array-based circular queue (front, rear, wrap-around, full and empty states).
* **Step log**: when a merge is small, the core records every insert, compare, swap, extract and pointer
  move. The visualizer replays this log, so Previous and Next always show what the real code did.

### Tie rule

Jobs are compared by **time** first. If the times are equal, the department whose **code comes first
alphabetically** goes first. Jobs of one department keep their original order, because only one job per
department is ever inside the heap, so two jobs of the same department can never overtake each other.
Example: A7 and B7 tie at time 7, so A7 comes out before B7.

### Scalability

The Scalability page builds generated queues (many equal times) with a fixed total (default 100,000 jobs)
and k = 2, 5, 10, 50, 100, 200. It counts comparisons for the heap merge and for a naive method that scans
every queue front for each output job. Typical result for N = 100,000:

| k | heap merge | naive scan |
|---|---|---|
| 2 | 99,469 | 99,469 |
| 10 | 425,764 | 891,671 |
| 50 | 754,237 | 4,812,938 |
| 200 | 1,043,681 | 19,103,255 |

The heap grows roughly like N log k, the naive scan like N k.

## Website pages

Dashboard, Branch Queues (linked-list view, submit, delete, manage branches), Merge & Report
(input queues, timeline, jobs received vs produced, comparisons, time, complexity), DSA Visualizer
(linked lists + heap tree + step-by-step merge, Next / Previous / Auto Play / Pause / Reset, dashboard),
Print Spooler (circular queue), Scalability (chart + table), About, Help.

The visualizer animates up to **10 departments and 30 jobs**. Larger merges run without animation and show
the numbers only.

## Syllabus coverage

Module 2: queue ADT, circular queue (static array), priority queue (heap), printer spooling, singly linked
list operations (traverse, insert, delete). Module 3: linked representation of a queue.
Frontend is plain HTML, CSS and JavaScript with no frameworks or chart libraries.

## Limits

Up to 200 departments and 100,000 total jobs. Input queues must already be sorted (the site enforces this
when jobs are submitted). No printer connection is used.

## Algorithms (Part A)

| Task | Structure / Algorithm | Complexity |
|---|---|---|
| A1 | Hash table (separate chaining, multiplicative hash, 0.7 load-factor rehash) | O(1) average lookup, insert, delete |
| A2 | Stable merge sort on a singly linked list (slow/fast split + iterative merge) | O(n log n) time, O(1) extra space |
| A3 | Two stacks (undo and redo on dynamic arrays) | O(1) per operation (+ O(n) to locate queue position) |
| A4 | Loser (tournament) tree merge and naive scan baseline | O(N log k) (~log2 k comparisons/job) and O(N k) |
| A5 | Flat timeline arrays + binary search (`tl_lower_bound`, `tl_upper_bound`) | O(log N) |
| A6 | Multi-printer scheduler using a min-heap of printers | O(N log P) |
| A7 | Circular queue pause flag and order-preserving cancel | O(n) cancel, O(1) pause |
| A8 | C++ / JS parity and 200x100k stress tests (`./run_parity.sh`) | — |

