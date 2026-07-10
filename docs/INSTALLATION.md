# Installation — v4.0.0-alpha.1

## 1. Copy the package into the local GitHub repository

Copy all package files into the root of the local `akort-dwh-4` repository and allow replacement of existing files. The file `src/99_LocalConfig.js` is intentionally present locally but excluded from Git.

Expected local structure:

```text
akort-dwh-4/
├── .git/
├── .clasp.json
├── .gitignore
├── package.json
├── src/
├── docs/
├── scripts/
└── releases/
```

## 2. Verify GitHub Desktop

The Changes list should show the public source and documentation files. It must **not** show:

- `.clasp.json`
- `src/99_LocalConfig.js`

Commit on branch `feature/alpha-1-foundation` with message:

```text
feat: add v4.0.0-alpha.1 DEV foundation and baseline harness
```

Then click `Push origin`.

## 3. Deploy to DEV Apps Script

Open Terminal from GitHub Desktop: `Repository → Open in Terminal`.

Run:

```bash
npm run status:dev
npm run deploy:dev
```

The deploy script compares the Script ID in `.clasp.json` with the local DEV configuration before running `clasp push`.

## 4. Authorize and run the smoke test

Open the Apps Script project and run:

```text
AKORT_alpha1SmokeTest
```

Approve Google Drive and Google Sheets permissions. Expected result: `status = SUCCESS` and every test is `PASS`.

## 5. Build the baseline snapshot

Run:

```text
AKORT_alpha1StartBaseline
```

The scanner uses checkpoints. If the result is `PAUSED`, run:

```text
AKORT_alpha1ContinueBaseline
```

Repeat until the result is `SUCCESS` or `FAILED`. Current status is available through:

```text
AKORT_alpha1BaselineStatus
```

The report is created in `07_Разработка системы 4.0/03_Результаты тестов`.

## 6. Acceptance criterion

The report must show `PASS` for:

- 27,899 RAW observation rows;
- 35,434 non-aggregate Publish rows;
- 61,636 aggregate rows;
- 157 weekly latest flags;
- 378 monthly latest flags;
- 1,364 aggregate latest flags;
- all required table schemas.

Do not merge the branch into `main` before these checks pass.
