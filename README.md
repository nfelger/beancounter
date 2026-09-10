# Beancounter

A small, private household expense tracker with a public codebase.

Import ING transaction CSVs from a phone, preview private rule-based classifications, and save to a Google spreadsheet. Google accounts and the spreadsheet's sharing permissions control data access.

## Current implementation

- Vue, TypeScript, and Vite; static hosting on GitHub Pages.
- ING CSV decoding, validation, preview, overlapping-import detection, and exact monetary parsing.
- Private spreadsheet-driven normalization, classification, exclusions, and historical exceptions.
- Google authorization, spreadsheet creation, and optional Google Picker connection.
- Fixed-range atomic writes with an import receipt and recovery after an uncertain response.
- Searchable transaction review, manual payee/category overrides, import history, and private JSON backup export.

Budgeting, pivot-style reporting, and historical comparisons remain on the [roadmap](ROADMAP.md).

## Run locally

Use Node 24 LTS and npm:

```sh
npm ci
npm run dev
```

Google configuration can be entered in the app's settings on each device, or supplied through the public variables in `.env.example`. No client secret belongs in this app.

Follow [the setup guide](docs/SETUP.md) to configure Google and Pages, and [the data guide](docs/DATA.md) for rules, storage, and recovery. Architecture and privacy requirements live in [AGENTS.md](AGENTS.md).

## Verification

```sh
npm run check
npm run format:check
```

The unit/service suite uses entirely synthetic data. The Playwright suite also uses synthetic data and mocked Google APIs:

```sh
npx playwright install chromium
npm run test:e2e
```

Automated domain/service checks and a production build have been run for the initial implementation. The browser suite and a real OAuth/Sheets smoke test still need validation. Passing mocked checks does not establish that a Google project is configured correctly.

## Privacy

**Never commit actual transactions or personal rules.** Their contents reveal financial activity even without account numbers. Real inputs, private reference scripts, and rule-conversion outputs must remain outside the checkout. Public tests use independently invented data.

No analytics, third-party error reporting, private seed data, or personal rules are bundled. OAuth tokens stay in memory. An unconfirmed import is temporarily retained in the current browser tab for recovery and removed after confirmation.
