# TPA Search Opportunity Analyzer

A browser-based analyzer for Roundel TPA Search Term reports. It surfaces:

- Search terms to add as new targets or scale with bid increases
- Existing targets that may need bid decreases
- Search terms to add as exact negatives
- Non-branded ROAS, Order CVR, and Unit CVR benchmarks
- Full Excel downloads with separate Opportunity Keywords and Inefficiencies tabs
- Campaign- and line-item-specific performance, even when the same term appears in multiple placements

## App goals

- **Maximize Unit Sales:** Unit CVR at or above the selected period’s non-branded benchmark. Sorted by highest Unit CVR.
- **Maximize Revenue:** Order CVR at or above the non-branded benchmark. Sorted by highest attributed Sales. ROAS is visible but does not automatically block scaling opportunities.
- **Maximize ROAS:** ROAS at least 15% above the non-branded benchmark. Sorted by highest ROAS.
- **Custom / Manual:** Use fixed ROAS/CVR goals, benchmark multipliers, and any combination of available guardrails.

## Files in this repository

- `index.html` — page structure
- `styles.css` — black background / white text theme
- `app.js` — file parsing, benchmark logic, stemming, filtering, recommendations, and Excel export
- `sample-search-term-report.csv` — generic Search Term test file
- `sample-current-target-report.csv` — generic optional target-file test
- `UPLOAD-INSTRUCTIONS.txt` — condensed GitHub upload steps
- `.nojekyll` — keeps GitHub Pages from processing the site with Jekyll

## Search Term report uploads

The main uploader accepts **up to 20 CSV/XLSX Search Term reports**. Select several files at once or add more files in later selections. The app combines the rows, de-duplicates file selections, and lets you filter by any Week or Month included across the loaded reports. Use **Clear Search Term reports** to reset the main upload.


## Campaign and line-item separation

The analyzer does **not** combine a search term across different campaigns or media line items. Every recommendation is grouped by:

`Campaign Name + Media Name / Line Item + stemmed search term`

This means the same keyword can appear multiple times in the output when it performs in different tiers or line items. For example, `curl mousse` can qualify separately in Tier 2 and Tier 3, with performance and recommendations calculated independently for each placement.

The optional Current Keyword / Target report is also matched within the same campaign and line item whenever those fields are available. A target that exists in Tier 1 will not cause the same term in Tier 2 or Tier 3 to be mislabeled as an existing target.

## Required Search Term report columns

The analyzer recognizes common Roundel column names and close variations for:

- Campaign Name
- Media Name / Line Item
- Keyword / Search Term
- Spend
- Sales
- Orders
- Units, when available
- Clicks
- Impressions
- Week or Month

Units are optional for the general app, but the **Maximize Unit Sales** goal is disabled when a Units column is not present.

## Optional Current Keyword / Target reports

Upload up to **20 optional files** to improve recommendation labels. The app looks for:

- Keyword or Target
- Campaign
- Media Name / Line Item
- Match Type
- Current Bid
- Status

Without the second file, the app still identifies opportunity and inefficiency candidates, but it cannot always confirm whether a term is already manually targeted.

# Upload to GitHub Pages

## 1. Create a new repository

1. Sign in to GitHub.
2. Click the **+** in the upper-right corner.
3. Select **New repository**.
4. Name it `tpa-search-opportunity-analyzer`.
5. Choose **Private** or **Public**.
6. Check **Add a README file** only if you are not uploading this README immediately.
7. Click **Create repository**.

## 2. Upload these files

1. Open the new repository.
2. Click **Add file**.
3. Select **Upload files**.
4. Drag the **contents** of this folder into GitHub:
   - `index.html`
   - `styles.css`
   - `app.js`
   - `README.md`
   - `sample-search-term-report.csv`
   - `sample-current-target-report.csv`
   - `UPLOAD-INSTRUCTIONS.txt`
   - `.nojekyll`
5. Confirm that `index.html` is visible at the top level of the repository, not inside another folder.
6. Enter a commit message such as `Initial TPA analyzer build`.
7. Click **Commit changes**.

## 3. Turn on GitHub Pages

1. Open the repository’s **Settings**.
2. Select **Pages** in the left menu.
3. Under **Build and deployment**, choose **Deploy from a branch**.
4. Select the `main` branch.
5. Select `/ (root)`.
6. Click **Save**.
7. Wait a few minutes, then return to **Settings → Pages** for the live URL.

The URL will usually follow this format:

`https://YOUR-USERNAME.github.io/tpa-search-opportunity-analyzer/`

## Privacy note

The report is processed in the user’s browser. This static version does not upload report data to a server. The app loads Papa Parse and SheetJS from jsDelivr so it can read CSV/XLSX files and create Excel downloads.

## Updating the app

Upload replacement files with the same names and commit the changes. GitHub Pages will redeploy automatically.


## Multiple-report capacity

- Main Search Term uploader: up to 20 CSV/XLSX reports
- Optional Current Keyword / Target uploader: up to 20 CSV/XLSX reports
- Files can be selected together or added in later selections
- Duplicate file selections are ignored
- If any loaded Search Term report lacks Units, Maximize Unit Sales stays disabled for the combined analysis


## Revenue inefficiency benchmark

In Auto mode for **Maximize Revenue**, a search term is treated as an inefficiency when it has at least 6 clicks and its Order CVR is at or below 50% of the selected period’s non-branded Order CVR benchmark. For example, if the non-branded Order CVR benchmark is 20%, the inefficiency ceiling is 10%. Converting terms are generally reviewed for bid decreases, while zero-order terms are stronger negative-target candidates.
