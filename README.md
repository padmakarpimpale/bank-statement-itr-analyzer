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
npm install
npm run dev
```

## Deploy to Vercel

This is a Vite static app. Import the GitHub repository in Vercel and deploy with:

- Framework preset: Vite
- Build command: `npm run build`
- Output directory: `dist`

No environment variables are required.

If an existing Vercel project keeps using the Node/server preset, `app.cjs` serves the same browser-only app safely.

See `DEPLOYMENT.md` for the GitHub push commands and Vercel settings.

## Important accuracy note

This app is meant for data preparation and CA/user review. It is not a replacement for professional tax advice. The best accuracy comes from text-based PDFs and bank-specific templates. Scanned PDFs depend heavily on OCR quality.
