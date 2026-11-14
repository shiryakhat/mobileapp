# shiryakhat.app — landing site + privacy policy

Static site for the Shir ya Khat app, published with GitHub Pages at
**https://shiryakhat.app** (privacy policy at **https://shiryakhat.app/privacy**).

Plain HTML/CSS and a few lines of vanilla JS. No build step, no dependencies,
no third-party requests (the font is self-hosted).

```
site/
├── index.html            landing page (FA default, EN toggle)
├── privacy/index.html    privacy policy (FA + EN)
├── assets/
│   ├── site.css          styles; colours mirror the app's "ink and brass" tokens
│   ├── site.js           language toggle + coin flip
│   ├── fonts/            Vazirmatn variable font (SIL OFL)
│   └── badges/           official App Store / Google Play badges
├── CNAME                 shiryakhat.app
└── .nojekyll
```

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
  live App Store / Google Play URLs, then remove `aria-disabled="true"` and the
  "Coming soon" line.
- `privacy/index.html`: confirm the contact address (`info@shiryakhat.net` is
  a placeholder) and that the issues link points at a public repo.
- Update the "last updated" date in both languages whenever the policy changes.
