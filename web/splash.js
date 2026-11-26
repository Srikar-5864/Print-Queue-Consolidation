(function () {
  var el = document.getElementById('splash');
  if (!el) return;
  function remove() { if (el && el.parentNode) el.parentNode.removeChild(el); el = null; }
  var seen = false;
  try { seen = sessionStorage.getItem('splashSeen') === '1'; } catch (e) {}
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (seen || reduce) { remove(); return; }
  try { sessionStorage.setItem('splashSeen', '1'); } catch (e) {}

  var nameEl = document.getElementById('splashName');
  var text = nameEl.getAttribute('data-text') || '';
  var caret = nameEl.querySelector('.caret');
  var i = 0, typer, startT, endT, done = false;

  function leave() {
    if (done) return; done = true;
    clearInterval(typer); clearTimeout(startT); clearTimeout(endT);
    el.classList.add('leave');
    el.addEventListener('transitionend', remove);
    setTimeout(remove, 1000);
    document.removeEventListener('keydown', onKey);
  }
  function onKey(e) { if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') leave(); }

  el.addEventListener('click', leave);
  document.addEventListener('keydown', onKey);

  startT = setTimeout(function () {
    typer = setInterval(function () {
      i++;
      if (nameEl.firstChild === caret) nameEl.insertBefore(document.createTextNode(text.charAt(0)), caret);
      else nameEl.firstChild.nodeValue = text.slice(0, i);
      if (i >= text.length) { clearInterval(typer); endT = setTimeout(leave, 900); }
    }, 32);
  }, 1500);
})();
