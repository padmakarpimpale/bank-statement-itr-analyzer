# GitHub and Vercel Deployment

## Push to GitHub

Install Git first if `git --version` does not work.

```bash
git init
git add .
git commit -m "Initial bank statement ITR analyzer"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
git push -u origin main
```

## Deploy on Vercel

1. Open Vercel.
2. Choose Add New Project.
3. Import the GitHub repository.
4. Keep the framework as Other if Vercel does not auto-detect one.
5. Build command: `npm run build`.
6. Output directory: `dist`.
7. Deploy.

No API key or environment variable is required.

## Vercel CLI Option

If you prefer command line deployment:

```bash
npm i -g vercel
vercel login
vercel --prod
```

## Notes

- The app processes PDFs in the browser.
- Large scanned PDFs may be slow because OCR runs locally.
- For production accuracy, add bank-specific parsing templates after testing real statements.
