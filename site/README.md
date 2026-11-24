# DarkForge website

One static page, `index.html`: no build step, no dependencies, nothing the plugin loads. English and Vietnamese text live in the `T` object and the data arrays in the page script.

## Preview locally

Serve the repository root (the page reads `../CHANGELOG.md` when it is not deployed):

```
python -m http.server 8000
```

Open http://localhost:8000/site/. Opening the file directly works too, but the Releases section then shows a link instead of the changelog.

## Releases section

It is built in the browser from `CHANGELOG.md` (`## [x.y.z] - date`, `### Group`, `- item`). Add a release to `CHANGELOG.md` as usual; the next deploy shows it. No HTML edit is needed.

## Deploy

`.github/workflows/pages.yml` copies `site/` and `CHANGELOG.md` to GitHub Pages on every push to `main` that touches them, or by hand (Actions > Website > Run workflow).

One-time setup: Settings > Pages > Build and deployment > Source: **GitHub Actions**. Until then the workflow fails at the deploy step. The site is then served at https://tuanluu-agilityio.github.io/darkforge/.

## Content rules

Every claim must trace to the README, `docs/`, the skills or the code. Example numbers (the hero replay, the ledger) stay labelled illustrative. When plugin behaviour changes, update the matching text in both languages.
