/* Shir ya Khat — episode link landing (404.html and its copy episode/index.html).
   Reads /episode/<id>?t=<sec> (or /e/<id>, or ?id=<id>) and offers the same
   episode through the app's custom scheme, plus the store links. Deliberately
   tiny: with the app installed, the OS opens the app and this never runs. */
(function () {
  var ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
  var params = new URLSearchParams(location.search);
  var match = location.pathname.match(/^\/(?:episode|e)\/([^/]+)\/?$/);
  var id = match ? decodeURIComponent(match[1]) : params.get('id');
  if (!id || !ID.test(id)) return; // not an episode link: leave the not-found message up

  var t = Math.floor(Number(params.get('t')));
  if (!(t > 0)) t = 0;

  function timeLabel(sec) {
    var h = Math.floor(sec / 3600),
      m = Math.floor((sec % 3600) / 60),
      s = sec % 60;
    var two = function (n) {
      return (n < 10 ? '0' : '') + n;
    };
    return h ? h + ':' + two(m) + ':' + two(s) : m + ':' + two(s);
  }

  document.querySelectorAll('.ep-code').forEach(function (el) {
    el.textContent = id.toUpperCase();
  });
  if (t) {
    document.querySelectorAll('.ep-time-label').forEach(function (el) {
      el.textContent = timeLabel(t);
    });
    document.querySelectorAll('.ep-time').forEach(function (el) {
      el.hidden = false;
    });
  }
  document.getElementById('open-app').href =
    'shiryakhat://episode/' + encodeURIComponent(id) + (t ? '?t=' + t : '');
  document.getElementById('not-found').hidden = true;
  document.getElementById('episode-link').hidden = false;
})();
