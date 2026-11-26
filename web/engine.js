/* engine.js - loads the C++ core compiled to WebAssembly (core.wasm).
   If core.wasm is missing or fails its self-test, the JavaScript port is used
   instead, so the website always works. */
const ENGINE_FUNCS = ['init', 'set_rank', 'add_job', 'delete_job', 'clear_queue', 'q_count',
  'export_queue', 'export_timeline', 'exp_job', 'exp_time', 'exp_dept', 'merge', 'tl_len', 'stat',
  'verify_timeline', 'log_len', 'log_field', 'spool_init', 'spool_enqueue', 'spool_dequeue',
  'spool_size', 'spool_front', 'spool_rear', 'spool_cap', 'spool_slot', 'bench', 'bench_stat',
  'job_exists', 'job_dept', 'job_time', 'set_duration', 'get_duration', 'add_job_raw',
  'sort_queue', 'is_sorted', 'undo', 'redo', 'undo_count', 'redo_count', 'op_field',
  'merge_lt', 'merge_naive', 'tl_job', 'tl_time', 'tl_dept', 'tl_lower_bound', 'tl_upper_bound',
  'find_in_timeline', 'sched_run', 'sched_count', 'sched_job', 'sched_printer', 'sched_start',
  'sched_end', 'sched_load', 'spool_cancel', 'spool_pause', 'spool_paused'];

function selfTest(c) {
  c.init(); c.set_rank(0, 0); c.set_rank(1, 1);
  c.add_job(0, 2, 0); c.add_job(1, 1, 1);
  const ok = c.merge(0) === 2 && c.export_timeline() === 2 && c.exp_job(0) === 1 && c.verify_timeline() === 1;
  c.init();
  return ok;
}

async function loadEngine() {
  try {
    const res = await fetch('core.wasm');
    if (!res.ok) throw new Error('core.wasm not found');
    const mod = await WebAssembly.compile(await res.arrayBuffer());
    const imports = {};
    for (const im of WebAssembly.Module.imports(mod)) {
      if (im.kind !== 'function') throw new Error('unsupported import');
      (imports[im.module] = imports[im.module] || {})[im.name] = () => 0;
    }
    const ex = (await WebAssembly.instantiate(mod, imports)).exports;
    if (ex._initialize) ex._initialize();
    const api = { name: 'WebAssembly (C++)' };
    for (const f of ENGINE_FUNCS) {
      const fn = ex[f] || ex['_' + f];
      if (!fn) throw new Error('missing export ' + f);
      api[f] = fn;
    }
    if (!selfTest(api)) throw new Error('self-test failed');
    return api;
  } catch (e) {
    const js = makeJsCore();
    js.fallbackReason = String(e && e.message ? e.message : e);
    return js;
  }
}
