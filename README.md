# Bank Statement ITR Analyzer

Free, browser-based bank statement PDF to Excel converter with ITR-oriented review summaries.

## What it does

- Uploads a bank statement PDF.
- Extracts transaction rows from text-based PDFs.
- Optionally tries OCR for scanned PDFs using free browser OCR.
- Lets the user review and edit extracted rows.
- Generates a multi-sheet Excel file:
  - Transactions
  - ITR Analysis
  - Monthly Summary
  - Category Summary
  - Review Flags
  - Extraction Notes

## Why no paid API key is needed

The app runs in the browser. PDF parsing, analysis, and Excel creation happen locally with free client-side libraries loaded from public CDNs.

## Local run

```bash
npm run build
```

Then open `dist/index.html` in the browser. The source static files live in `public/`.

If PowerShell blocks `npm`, run:

```bash
npm.cmd run build
```

## Production build

```bash
npm run build
```

The deployable static files are created in `dist/`.

## Deploy to Vercel

This is a static app. Import the GitHub repository in Vercel. The project includes `vercel.json`, so Vercel should use:

- Build command: `npm run build`
- Output directory: `dist`

No environment variables are required.

See `DEPLOYMENT.md` for the GitHub push commands and Vercel settings.

## Important accuracy note

This app is meant for data preparation and CA/user review. It is not a replacement for professional tax advice. The best accuracy comes from text-based PDFs and bank-specific templates. Scanned PDFs depend heavily on OCR quality.
