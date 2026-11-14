/* Shir ya Khat — language toggle + coin flip. Loaded in <head> so the saved
   language is applied before first paint. The page works without it (Farsi). */
(function () {
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
    var body = coin.querySelector('.coin-body');
    var note = document.querySelector('.coin-note');
    var calm = window.matchMedia('(prefers-reduced-motion: reduce)');
    var turn = 0;           // degrees; even multiples of 180 show heads (شیر)
    var results = {
      heads: { fa: 'شیر آمد.', en: 'Shir. That’s heads.' },
      tails: { fa: 'خط آمد.', en: 'Khat. That’s tails.' }
    };

    coin.addEventListener('click', function () {
      var showing = (turn / 180) % 2 === 0 ? 'heads' : 'tails';
      var next = Math.random() < 0.5 ? 'heads' : 'tails';
      turn += 1080 + (next === showing ? 0 : 180);
      body.style.setProperty('--turn', turn + 'deg');
      if (!calm.matches && coin.animate) {
        coin.animate(
          [{ transform: 'translateY(0)' }, { transform: 'translateY(-14%)' }, { transform: 'translateY(0)' }],
          { duration: 1500, easing: 'cubic-bezier(.3,.6,.4,1)' }
        );
      }
      if (note) {
        setTimeout(function () {
          note.querySelector('.fa').textContent = results[next].fa;
          note.querySelector('.en').textContent = results[next].en;
        }, calm.matches ? 0 : 1500);
      }
    });
  });
})();
