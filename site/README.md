# shiryakhat.app — landing site + privacy policy

Static site for the Shir ya Khat app, published with GitHub Pages at
**https://shiryakhat.app** (privacy policy at **https://shiryakhat.app/privacy**).

Plain HTML/CSS and vanilla JS. No build step and no third-party requests: the
font and three.js are self-hosted.

```
site/
├── index.html            landing page (FA default, EN toggle)
├── privacy/index.html    privacy policy (FA + EN)
├── assets/
│   ├── site.css          styles; colours mirror the app's "ink and brass" tokens
│   ├── site.js           language toggle + lazy loader for the coin
│   ├── coin.js           the 3D coin (ES module, loaded after first paint)
│   ├── logo.webp         Shir ya Khat logo: tails, and heads until the hero exists
│   ├── coin-hero.png     (optional) engraved hero for the heads face
│   ├── coin-heads.webp   still renders of the coin: no-JS, reduced-motion
│   ├── coin-tails.webp   and no-WebGL fallback
│   ├── vendor/           three.js (MIT), tree-shaken to what coin.js imports
│   ├── fonts/            Vazirmatn variable font (SIL OFL)
│   └── badges/           official App Store / Google Play badges
├── CNAME                 shiryakhat.app
└── .nojekyll
```

## The coin

`coin.js` builds an aged gold-bronze coin at runtime: relief (height field →
normal map), patina in the recesses, worn-bright high points, hairline
scratches, a beaded rim and a reeded edge. Reflections come from a small
generated lamp-lit environment, so there is no HDR file to ship.

- **Heads (شیر)** is the engraved hero from `assets/coin-hero.png` when that
  file exists: any square-ish picture works, light areas become raised metal
  and dark areas recesses (transparent pixels stay flat field). Until the file
  is added the request 404s and heads falls back to the logo inlaid in enamel.
  **Tails (خط)** is always `logo.webp` struck in relief.
- It idles with a slow turn, flips once on load and again on every tap. A toss
  takes about four seconds: wind-up, arc with a precessing spin that bleeds
  speed, then a damped rock to rest.
- About one toss in ten (`EDGE_CHANCE`) lands on its rim and teeters. `site.js`
  shows «شیر یا خط؟ · heads or tails? · …you decide» in the note; the coin then
  either tips onto a face by itself or keeps teetering until the next tap.
  `flip('edge')` forces it when testing.
- Small "quirks" fire every several seconds at rest: a shimmer over the metal,
  a colour-fringed glint on the rim, a hiccup in the turn; some tosses catch
  for a moment at the top of the arc.
- `site.js` imports it only after `load`, and not at all with
  `prefers-reduced-motion`, Save-Data, or no WebGL. In those cases, and with
  JavaScript off, the still images stand in (a tap cross-fades between them).
  If reduced motion is switched on while the coin is live, it stops animating
  and a tap just shows the result.
- Rendering pauses when the coin is off screen or the tab is hidden.

The logo comes from `img/favicon/` in
[shiryakhat/website](https://github.com/shiryakhat/website) (its `favicon.svg`
only wraps a 1000px PNG, so the raster is used directly).

To rebuild `vendor/three.min.js` after changing which three.js classes
`coin.js` uses, edit `vendor/three.entry.js` and run, in a scratch folder with
`three` installed:

```sh
npx esbuild three.entry.js --bundle --minify --format=esm --target=es2020 \
  --legal-comments=inline --outfile=three.min.js
```

If the coin's look changes, re-capture `coin-heads.webp` / `coin-tails.webp`
(480×720, transparent) from `.coin-stage` with `mount(stage, { face, still: true })`.
Do this when `coin-hero.png` is added, so the fallback shows the same heads.

## View locally

Open `site/index.html` in a browser. To click through to `/privacy/` the way it
works in production, serve the folder instead:

```sh
python3 -m http.server -d site 8080   # http://localhost:8080
```

## Languages

Farsi (RTL) is the static default and is what renders with JavaScript off.
The toggle switches to English and remembers the choice in `localStorage`
(`syk-lang`). `?lang=en` or `?lang=fa` forces a language, which is useful for
store listings: `https://shiryakhat.app/privacy/?lang=en`. With JavaScript off,
the privacy page shows both languages one after the other.

Every piece of copy exists twice in the HTML: `class="fa"` and `class="en"`.
Edit both when you change text.

## Deploy

`.github/workflows/pages.yml` publishes this folder on every push to `main`
that touches `site/**` (or run it by hand from the Actions tab).

### One-time setup (manual)

1. **Enable Pages.** Repo → Settings → Pages → Build and deployment →
   Source: **GitHub Actions**.
   - This repo is currently **private**. Pages on a private repo needs a paid
     plan (GitHub Team/Enterprise for an organisation). On the Free plan, make
     the repo public first.
2. **Set the custom domain.** Same page → Custom domain: `shiryakhat.app` →
   Save. With the Actions source, this setting is what binds the domain; the
   `CNAME` file here only documents it.
3. **Point DNS at GitHub Pages** (at the registrar / DNS host for
   `shiryakhat.app`):

   | Type  | Name  | Value                 |
   |-------|-------|-----------------------|
   | A     | `@`   | `185.199.108.153`     |
   | A     | `@`   | `185.199.109.153`     |
   | A     | `@`   | `185.199.110.153`     |
   | A     | `@`   | `185.199.111.153`     |
   | AAAA  | `@`   | `2606:50c0:8000::153` |
   | AAAA  | `@`   | `2606:50c0:8001::153` |
   | AAAA  | `@`   | `2606:50c0:8002::153` |
   | AAAA  | `@`   | `2606:50c0:8003::153` |
   | CNAME | `www` | `shiryakhat.github.io` |

   The AAAA records are optional (IPv6). The `www` record lets GitHub redirect
   `www.shiryakhat.app` to the apex. If your DNS host supports ALIAS/ANAME at
   the apex, pointing it at `shiryakhat.github.io` works in place of the A records.
4. Wait for the DNS check on the Pages settings page to pass, then tick
   **Enforce HTTPS**. (`.app` domains are HTTPS-only in browsers, so the site
   will not load until the certificate is issued; this can take up to an hour.)
5. Recommended: verify the domain for the organisation (Org settings → Pages →
   Add a domain) so nobody else can claim it.

Check DNS with `dig shiryakhat.app +noall +answer`.

## TODOs before launch

- `index.html`: replace the two store badge links (search for `TODO`) with the
  live App Store / Google Play URLs (bundle id `net.shiryakhat.app`), then
  remove `aria-disabled="true"` and the "Coming soon" line.
- `privacy/index.html`: confirm the contact address (`info@shiryakhat.net` is
  a placeholder) and that the issues link points at a public repo.
- Update the "last updated" date in both languages whenever the policy changes.
