# Setup

## GitHub Pages

1. In the repository's **Settings → Pages**, select **GitHub Actions** as the build/deployment source.
2. The `Check and deploy` workflow runs on pushes to `main`, or manually through **Actions**. It checks formatting, lint, unit/service tests, and the production build before publishing.
3. The expected URL is **https://nfelger.github.io/beancounter/**.

This public website contains only application code. Do not publish the spreadsheet or commit private rule files.

## Google Cloud

1. Create a Google Cloud project for Beancounter.
2. Enable **Google Sheets API** and **Google Drive API**.
3. Configure the OAuth consent screen (Google Auth Platform). For a personal account, choose an **External** audience. While testing, add the intended Google accounts as test users.
4. Configure the scope `https://www.googleapis.com/auth/drive.file`. This gives the app access to files it creates or that the user explicitly selects through Google Picker. Do not replace it with broad Drive or all-spreadsheets access.
5. Create an OAuth client of type **Web application**.
6. Add these **Authorized JavaScript origins**:
   - `https://nfelger.github.io`
   - `http://localhost`
   - `http://localhost:5173`
7. Enter the client ID in Beancounter's **Einstellungen → Google-Zugang** and save. Alternatively, configure the repository variable `GOOGLE_CLIENT_ID`; the next build uses it as the default on every device.

Origins contain scheme, host, and optional port, never the `/beancounter/` path. This app uses the browser token flow: it needs no server callback or client secret.

The client ID is public configuration. Never enter the client secret into the frontend or repository.

### Selecting an existing table

Creating a new table requires only the OAuth client. To select an existing Beancounter table on another device/account:

1. Enable **Google Picker API** in the same project.
2. Create a browser API key. Restrict it to Google Picker API and to the website's HTTP referrers, such as `https://nfelger.github.io/*` and `http://localhost:5173/*`.
3. Enter the API key and the project's numeric **project number** in the app settings, or configure the repository variables `GOOGLE_API_KEY` and `GOOGLE_PROJECT_NUMBER`.
4. Sign in and choose **Bestehende Tabelle wählen**. Select the private Beancounter spreadsheet.

The API key and project number identify the Picker application; access to financial data still requires the user's OAuth token and file permissions. Merely pasting a Sheet ID does not grant `drive.file` access, so the app uses Picker.

### First use

1. Open Beancounter and choose **Mit Google verbinden**.
2. Choose **Neue Tabelle erstellen**. The app creates the schema in a new private spreadsheet. It does not modify an unrelated spreadsheet.
3. Privately export and load your rules as described below.
4. Choose an ING CSV on **Import**, inspect the preview, and confirm.
5. Verify the first import against the source file and the spreadsheet.
6. Share the spreadsheet through Google Sheets with any other intended account. That account must also authorize the app and select the spreadsheet.

OAuth consent is separate from spreadsheet sharing. Google may require renewed consent while an app remains in testing; production consent/verification requirements depend on the project's configuration. Use [Google's authorization guide](https://developers.google.com/identity/oauth2/web/guides/use-token-model) and [scope guidance](https://developers.google.com/workspace/drive/api/guides/api-specific-auth) when moving out of testing.

## Load private Python rules

The generic converter understands the structure of the supplied rule scripts. It parses Python syntax without executing the input. It exports normalization steps, ordered merchant/context rules, exact transaction overrides, and exclusions.

Keep both paths outside the repository:

```sh
python3 scripts/export_rules.py /absolute/private/payee_rules.py /absolute/private/beancounter-private-rules.json
```

In the app, select **Einstellungen → Private Zuordnungsregeln → Regeldatei auswählen**, review the counts, and save. The JSON is read locally, validated, and written into the private spreadsheet only after confirmation.

The actual rules are not supplied in this repository. Never add the export or original script to Git, even temporarily. The converter rejects input/output paths within the checkout.

## Recovery and limits

- If a save's outcome is uncertain, keep the browser tab open and use **Status prüfen und fortsetzen**. If necessary, reconnect Google first.
- A pending plan is retained in tab-scoped sessionStorage, including the private rows needed to retry. It contains no OAuth token and is deleted after verified success.
- Do not close the tab, switch tables, edit/sort the spreadsheet, or start another importer while a save is unresolved.
- Reloading the same tab restores its pending plan. Browser storage loss or closing the tab can remove it; consult the import receipt and transactions before attempting another import.
- The current release supports EUR ING exports, files up to 10 MB, and atomic write payloads up to 1.8 MB. Large imports must be split into smaller date ranges. Tables are initially sized for 29,999 data rows.
- Use complete, unfiltered date-range exports. Without a universal bank transaction ID, identical payments in partial/filtered exports can be ambiguous.
- Google authorization is interactive. Background bank sync and offline importing are not implemented.

## Validation still needed with your accounts

- Test the real consent flow, first spreadsheet creation, and connection from a second device.
- Test file selection in Safari on iPhone, including exports saved in Files.
- Compare imported classifications with the current private Python reference on a representative full export.
- Verify the first successful import and an overlapping reimport before adopting the app as the primary workflow.
