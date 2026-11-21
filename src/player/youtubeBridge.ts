/**
 * Play / pause (and speed) for the YouTube iframe, delivered for real.
 *
 * react-native-youtube-iframe 2.4 sends those commands to its player page as a
 * WebView `postMessage` carrying JSON: `{"eventName":"playVideo","meta":{}}`.
 * The page it loads by default (hosted on GitHub Pages) was never updated for
 * that: its listener still compares the message with the bare string
 * `"playVideo"`, and it listens on `window` only — while the Android WebView
 * dispatches the message on `document`. So the commands were dropped on both
 * platforms: the transport button changed in the app and the video carried on
 * (or never started). Seeking was unaffected because the library injects
 * `player.seekTo(…)` directly, which is why only play / pause looked dead.
 *
 * This script is injected into that page (see <YoutubeSurface/>) and answers
 * the library's own protocol on both targets. `player` is the page's global
 * `YT.Player`. Commands are idempotent, so it does not matter if the page
 * starts handling them itself one day.
 *
 * Kept to ES5: it runs in whatever WebView the device has.
 */
export const YOUTUBE_BRIDGE_SCRIPT = `(function () {
  if (window.__sykYoutubeBridge) return;
  window.__sykYoutubeBridge = true;
  var last;
  function onMessage(event) {
    // One message can reach both listeners (it bubbles on some WebViews).
    if (event === last) return;
    last = event;
    var message;
    try {
      message = JSON.parse(event.data);
    } catch (e) {
      return;
    }
    var player = window.player;
    if (!message || !player) return;
    try {
      if (message.eventName === 'playVideo') player.playVideo();
      else if (message.eventName === 'pauseVideo') player.pauseVideo();
      else if (message.eventName === 'setPlaybackRate') {
        player.setPlaybackRate(message.meta.playbackRate);
      }
    } catch (e) {}
  }
  window.addEventListener('message', onMessage);
  document.addEventListener('message', onMessage);
})();
true;`;
