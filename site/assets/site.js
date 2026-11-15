/* Shir ya Khat — language toggle + coin loader. Loaded in <head> so the saved
   language is applied before first paint. The page works without it (Farsi).
   The 3D coin (coin.js + three.js) is fetched only after the page has loaded;
   until then, and whenever it can't run, the coin is a still image. */
(function () {
  var here = document.currentScript && document.currentScript.src;
  var root = document.documentElement;
  var KEY = 'syk-lang';

  function valid(l) { return l === 'fa' || l === 'en'; }

  function apply(lang, save) {
    root.lang = lang;
    root.dir = lang === 'fa' ? 'rtl' : 'ltr';
    root.setAttribute('data-lang', lang);
    var title = root.getAttribute('data-title-' + lang);
    if (title) document.title = title;
    if (save) { try { localStorage.setItem(KEY, lang); } catch (e) {} }
  }

  // ?lang=en|fa wins (handy for store listings), then the saved choice, then Farsi.
  var fromUrl = null, saved = null;
  try { fromUrl = new URLSearchParams(location.search).get('lang'); } catch (e) {}
  try { saved = localStorage.getItem(KEY); } catch (e) {}
  root.classList.add('js');
  if (valid(fromUrl)) apply(fromUrl, true);
  else if (valid(saved)) apply(saved, false);

  document.addEventListener('DOMContentLoaded', function () {
    var toggle = document.querySelector('.lang-toggle');
    if (toggle) {
      toggle.addEventListener('click', function () {
        apply(root.getAttribute('data-lang') === 'en' ? 'fa' : 'en', true);
      });
    }

    var coin = document.querySelector('.coin');
    if (!coin) return;
    var stage = coin.querySelector('.coin-stage');
    var note = document.querySelector('.coin-note');
    var calm = window.matchMedia('(prefers-reduced-motion: reduce)');
    var face = 'heads';     // heads = شیر (the microphone), tails = خط (the astronaut)
    var live = null;        // the 3D coin, once mounted
    var results = {
      heads: { fa: 'شیر', en: 'Shir' },
      tails: { fa: 'خط', en: 'Khat' }
    };

    var hint = note && { fa: note.querySelector('.fa').textContent, en: note.querySelector('.en').textContent };

    // The rare toss that lands on its rim: a small caption in both languages
    // while the coin can't make up its mind.
    var undecided = null;
    function decide() {
      if (!undecided) return;
      undecided.remove();
      undecided = null;
      note.classList.remove('is-undecided');
    }
    function teeter() {
      if (!note || undecided) return;
      undecided = document.createElement('span');
      undecided.className = 'coin-undecided';
      undecided.innerHTML =
        '<span lang="fa" dir="rtl">شیر یا خط؟</span>' +
        '<span lang="en" dir="ltr">heads or tails?</span>' +
        '<span class="fa">…خودتان بگویید</span><span class="en" lang="en">…you decide</span>';
      note.classList.add('is-undecided');
      note.appendChild(undecided);
    }

    function say(text) {
      if (!note) return;
      decide();
      note.querySelector('.fa').textContent = text.fa;
      note.querySelector('.en').textContent = text.en;
    }
    function announce(result) { face = result; say(results[result]); }
    // Once the coin goes back to turning idly, the result no longer applies.
    function rest() { say(hint); }

    // Still-image flip: cross-fade between two renders of the coin.
    function stillFlip() {
      var tails = coin.querySelector('.coin-poster[data-face="tails"]');
      if (tails && tails.hasAttribute('data-src')) {
        tails.src = tails.getAttribute('data-src');
        tails.removeAttribute('data-src');
        tails.hidden = false;
      }
      var next = Math.random() < 0.5 ? 'heads' : 'tails';
      coin.setAttribute('data-face', next);
      announce(next);
    }

    // Every tap counts: one tosses the coin, more while it is in the air keep it up.
    coin.addEventListener('click', function (e) {
      if (!live) stillFlip();
      else if (live.flip(undefined, e) && undecided) rest();   // tossed again off its rim
    });

    function load3d() {
      if (calm.matches || !here || !window.WebGLRenderingContext) return;
      var conn = navigator.connection;
      if (conn && conn.saveData) return;
      import(new URL('coin.js', here).href).then(function (mod) {
        return mod.mount(stage, { face: face, intro: true, onLand: announce, onEdge: teeter, onIdle: rest });
      }).then(function (api) {
        live = api;
        coin.classList.add('is-live');
      }).catch(function () { /* keep the still coin */ });
    }

    function whenIdle() {
      if (window.requestIdleCallback) requestIdleCallback(load3d, { timeout: 1500 });
      else setTimeout(load3d, 200);
    }
    if (document.readyState === 'complete') whenIdle();
    else window.addEventListener('load', whenIdle);
  });
})();
