const PDF_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
const EXCELJS_URL = "https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js";
const TESSERACT_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";

const categories = [
  "Salary",
  "Business Receipt",
  "Cash Deposit",
  "Cash Withdrawal",
  "Bank Interest",
  "Bank Charges",
  "Tax Payment",
  "Investment",
  "Loan EMI",
  "Rent",
  "Insurance",
  "UPI",
  "Card/POS",
  "Utilities",
  "Refund/Reversal",
  "Self Transfer",
  "Uncategorised Credit",
  "Other"
];

const state = {
  file: null,
  rows: [],
  rawLines: [],
  notes: [],
  analysis: null,
  nextId: 1
};

const el = {};

window.addEventListener("DOMContentLoaded", () => {
  cacheElements();
  fillCategoryFilter();
  attachEvents();
  setProgress(0, "Ready");
});

function cacheElements() {
  [
    "pdfFile",
    "fileLabel",
    "fileMeta",
    "dropZone",
    "bankSelect",
    "pdfPassword",
    "assessmentYear",
    "highValueLimit",
    "ocrFallback",
    "ocrPageLimit",
    "analyzeButton",
    "sampleButton",
    "clearButton",
    "exportButton",
    "progressBar",
    "statusText",
    "totalCredit",
    "totalDebit",
    "possibleIncome",
    "reviewCount",
    "transactionCount",
    "avgConfidence",
    "cashDeposits",
    "transactionBody",
    "searchInput",
    "categoryFilter",
    "addRowButton",
    "extractionNote",
    "insightList"
  ].forEach((id) => {
    el[id] = document.getElementById(id);
  });
}

function attachEvents() {
  el.pdfFile.addEventListener("change", () => {
    if (el.pdfFile.files[0]) {
      setFile(el.pdfFile.files[0]);
    }
  });

  ["dragenter", "dragover"].forEach((name) => {
    el.dropZone.addEventListener(name, (event) => {
      event.preventDefault();
      el.dropZone.classList.add("is-over");
    });
  });

  ["dragleave", "drop"].forEach((name) => {
    el.dropZone.addEventListener(name, (event) => {
      event.preventDefault();
      el.dropZone.classList.remove("is-over");
    });
  });

  el.dropZone.addEventListener("drop", (event) => {
    const file = Array.from(event.dataTransfer.files).find((item) => item.type === "application/pdf" || item.name.toLowerCase().endsWith(".pdf"));
    if (file) {
      setFile(file);
    }
  });

  el.analyzeButton.addEventListener("click", analyzePdf);
  el.sampleButton.addEventListener("click", loadSampleRows);
  el.clearButton.addEventListener("click", clearWorkspace);
  el.exportButton.addEventListener("click", exportWorkbook);
  el.addRowButton.addEventListener("click", addManualRow);
  el.searchInput.addEventListener("input", renderRows);
  el.categoryFilter.addEventListener("change", renderRows);
  el.highValueLimit.addEventListener("input", refreshAnalysis);

  el.transactionBody.addEventListener("input", (event) => {
    const target = event.target;
    const rowElement = target.closest("tr[data-id]");
    if (!rowElement) return;
    const row = state.rows.find((item) => item.id === Number(rowElement.dataset.id));
    if (!row) return;
    updateRowFromField(row, target);
    refreshAnalysis();
  });

  el.transactionBody.addEventListener("click", (event) => {
    const button = event.target.closest("[data-delete]");
    if (!button) return;
    const rowId = Number(button.closest("tr[data-id]").dataset.id);
    state.rows = state.rows.filter((row) => row.id !== rowId);
    refreshAnalysis();
  });
}

function setFile(file) {
  state.file = file;
  el.fileLabel.textContent = file.name;
  el.fileMeta.textContent = `${formatBytes(file.size)} selected`;
}

async function analyzePdf() {
  if (!state.file) {
    setProgress(0, "Please choose a PDF first.");
    return;
  }

  if (!window.pdfjsLib) {
    setProgress(0, "PDF library is still loading. Try again in a moment.");
    return;
  }

  toggleBusy(true);
  resetResults();

  try {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER;
    const buffer = await state.file.arrayBuffer();
    const password = el.pdfPassword.value.trim() || undefined;

    setProgress(6, "Opening PDF");
    const extraction = await extractTextLines(buffer, password);
    state.rawLines = extraction.lines;
    state.notes = extraction.notes;

    setProgress(58, "Finding transactions");
    let rows = parseTransactions(state.rawLines);

    if (rows.length === 0 && el.ocrFallback.checked) {
      const limit = Number(el.ocrPageLimit.value || 12);
      setProgress(62, "Starting OCR");
      const ocrExtraction = await extractWithOcr(buffer, password, limit);
      state.rawLines = ocrExtraction.lines;
      state.notes = [...state.notes, ...ocrExtraction.notes];
      rows = parseTransactions(state.rawLines);
    }

    state.rows = rows.map((row) => ({ ...row, id: state.nextId++ }));
    if (state.rows.length === 0) {
      state.notes.push("No transaction rows were detected. Try OCR for scanned PDFs or use a clearer statement file.");
    }

    refreshAnalysis();
    setProgress(100, `${state.rows.length} transactions ready for review`);
  } catch (error) {
    setProgress(0, cleanError(error));
  } finally {
    toggleBusy(false);
  }
}

async function extractTextLines(buffer, password) {
  const loadingTask = window.pdfjsLib.getDocument({
    data: buffer.slice(0),
    password,
    useWorkerFetch: true,
    isEvalSupported: false
  });
  const pdf = await loadingTask.promise;
  const lines = [];
  const notes = [`PDF pages: ${pdf.numPages}`];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    setProgress(8 + Math.round((pageNumber / pdf.numPages) * 45), `Reading page ${pageNumber} of ${pdf.numPages}`);
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent({ disableCombineTextItems: false });
    const pageLines = groupPdfTextItems(content.items, pageNumber);
    lines.push(...pageLines);
  }

  const textCount = lines.reduce((sum, line) => sum + line.text.length, 0);
  notes.push(`Extracted text lines: ${lines.length}`);
  if (textCount < 60) {
    notes.push("Very little text was found. This may be a scanned statement.");
  }

  return { lines, notes };
}

function groupPdfTextItems(items, pageNumber) {
  const buckets = new Map();

  items.forEach((item) => {
    const text = normalizeSpace(item.str);
    if (!text) return;
    const x = Math.round(item.transform[4]);
    const y = Math.round(item.transform[5]);
    const key = String(Math.round(y / 3) * 3);
    if (!buckets.has(key)) {
      buckets.set(key, []);
    }
    buckets.get(key).push({ text, x, y });
  });

  return Array.from(buckets.values())
    .sort((a, b) => b[0].y - a[0].y)
    .map((parts) => {
      const sorted = parts.sort((a, b) => a.x - b.x);
      return {
        page: pageNumber,
        text: rebuildLine(sorted),
        parts: sorted
      };
    })
    .filter((line) => line.text.length > 0);
}

function rebuildLine(parts) {
  let previousX = null;
  return normalizeSpace(parts.map((part) => {
    const gap = previousX === null ? "" : part.x - previousX > 46 ? "   " : " ";
    previousX = part.x + part.text.length * 5;
    return `${gap}${part.text}`;
  }).join(""));
}

async function extractWithOcr(buffer, password, pageLimit) {
  await loadScript(TESSERACT_URL, "tesseract-js");
  if (!window.Tesseract) {
    throw new Error("OCR library could not be loaded.");
  }

  const loadingTask = window.pdfjsLib.getDocument({
    data: buffer.slice(0),
    password,
    isEvalSupported: false
  });
  const pdf = await loadingTask.promise;
  const limit = Math.min(pdf.numPages, Math.max(1, pageLimit || pdf.numPages));
  const worker = await window.Tesseract.createWorker("eng", 1, {
    logger: (message) => {
      if (message.status === "recognizing text") {
        const progress = 64 + Math.round(message.progress * 24);
        setProgress(progress, `OCR page progress ${Math.round(message.progress * 100)}%`);
      }
    }
  });

  const lines = [];
  const notes = [`OCR pages processed: ${limit} of ${pdf.numPages}`];

  try {
    for (let pageNumber = 1; pageNumber <= limit; pageNumber += 1) {
      setProgress(64, `OCR page ${pageNumber} of ${limit}`);
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1.7 });
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d", { willReadFrequently: true });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      await page.render({ canvasContext: context, viewport }).promise;
      const result = await worker.recognize(canvas);
      splitRawText(result.data.text, pageNumber).forEach((line) => lines.push(line));
    }
  } finally {
    await worker.terminate();
  }

  notes.push(`OCR text lines: ${lines.length}`);
  return { lines, notes };
}

function splitRawText(text, pageNumber) {
  return text
    .split(/\r?\n/)
    .map((line) => normalizeSpace(line))
    .filter(Boolean)
    .map((line) => ({ page: pageNumber, text: line, parts: [] }));
}

function parseTransactions(lines) {
  const rows = [];
  let pending = null;

  lines.forEach((line) => {
    const text = normalizeSpace(line.text);
    if (!text || isNoiseLine(text)) {
      return;
    }

    const dateInfo = findDate(text);
    const hasMoney = findMoneyTokens(text, dateInfo ? [dateInfo.span] : []).length > 0;

    if (dateInfo && hasMoney) {
      if (pending) rows.push(parseRow(pending));
      pending = {
        page: line.page,
        text,
        sourceLine: text
      };
      return;
    }

    if (pending && shouldAppendLine(text)) {
      pending.text = `${pending.text} ${text}`;
    }
  });

  if (pending) rows.push(parseRow(pending));

  const validRows = rows
    .filter((row) => row.date && (row.debit || row.credit || row.balance !== null))
    .map(cleanParsedRow);

  inferDirectionFromBalance(validRows);
  validRows.forEach((row) => {
    row.category = categorize(row);
    row.confidence = scoreConfidence(row);
    row.flags = buildRowFlags(row);
  });

  return validRows;
}

function parseRow(candidate) {
  const dateInfo = findDate(candidate.text);
  const dateText = dateInfo ? dateInfo.raw : "";
  const date = dateInfo ? toIsoDate(dateInfo) : "";
  const moneyTokens = findMoneyTokens(candidate.text, dateInfo ? [dateInfo.span] : []);
  const tailTokens = moneyTokens.slice(-4);

  let balance = null;
  let amount = 0;
  let direction = "unknown";

  if (tailTokens.length >= 2) {
    balance = tailTokens[tailTokens.length - 1].value;
    const amountToken = tailTokens[tailTokens.length - 2];
    amount = amountToken.value;
    direction = directionFromTokenOrText(amountToken, candidate.text);
  } else if (tailTokens.length === 1) {
    amount = tailTokens[0].value;
    direction = directionFromTokenOrText(tailTokens[0], candidate.text);
  }

  const narration = extractNarration(candidate.text, dateInfo, tailTokens);
  const signed = splitDebitCredit(amount, direction, narration);

  return {
    date,
    dateText,
    narration,
    debit: signed.debit,
    credit: signed.credit,
    balance,
    category: "Other",
    confidence: 0.5,
    flags: [],
    page: candidate.page,
    sourceLine: candidate.sourceLine
  };
}

function findDate(text) {
  const patterns = [
    {
      regex: /\b(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})\b/,
      build: (match) => ({ day: match[1], month: match[2], year: match[3] })
    },
    {
      regex: /\b(\d{1,2})[\s-](Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*[\s,-](\d{2,4})\b/i,
      build: (match) => ({ day: match[1], month: monthNumber(match[2]), year: match[3] })
    },
    {
      regex: /\b(\d{4})[./-](\d{1,2})[./-](\d{1,2})\b/,
      build: (match) => ({ day: match[3], month: match[2], year: match[1] })
    }
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern.regex);
    if (match) {
      return {
        ...pattern.build(match),
        raw: match[0],
        span: [match.index, match.index + match[0].length]
      };
    }
  }

  return null;
}

function toIsoDate(info) {
  const year = normalizeYear(info.year);
  const month = String(Number(info.month)).padStart(2, "0");
  const day = String(Number(info.day)).padStart(2, "0");
  if (!year || Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > 31) {
    return "";
  }
  return `${year}-${month}-${day}`;
}

function normalizeYear(value) {
  const year = Number(value);
  if (Number.isNaN(year)) return "";
  if (year < 100) {
    return String(year >= 70 ? 1900 + year : 2000 + year);
  }
  return String(year);
}

function monthNumber(value) {
  const key = value.slice(0, 3).toLowerCase();
  return {
    jan: 1,
    feb: 2,
    mar: 3,
    apr: 4,
    may: 5,
    jun: 6,
    jul: 7,
    aug: 8,
    sep: 9,
    oct: 10,
    nov: 11,
    dec: 12
  }[key] || 1;
}

function findMoneyTokens(text, excludedSpans = []) {
  const tokens = [];
  const moneyRegex = /(?:Rs\.?\s*|INR\s*)?[+-]?(?:\d{1,3}(?:,\d{2,3})+|\d+)(?:\.\d{1,2})?\s*(?:Cr|Dr)?/gi;
  let match;

  while ((match = moneyRegex.exec(text)) !== null) {
    const raw = match[0].trim();
    const span = [match.index, match.index + match[0].length];
    if (excludedSpans.some((item) => spansOverlap(span, item))) continue;
    if (!looksLikeMoney(raw, text, span)) continue;

    const cleaned = raw.replace(/Rs\.?|INR/gi, "").replace(/[,\s]/g, "").replace(/(Cr|Dr)$/i, "");
    const value = Math.abs(Number(cleaned));
    if (!Number.isFinite(value) || value === 0 || value > 999999999) continue;

    tokens.push({
      raw,
      value,
      suffix: /\bCr\b/i.test(raw) ? "credit" : /\bDr\b/i.test(raw) ? "debit" : "unknown",
      index: match.index,
      span
    });
  }

  return tokens;
}

function looksLikeMoney(raw, text, span) {
  const compact = raw.replace(/\s/g, "");
  if (/Rs\.?|INR/i.test(raw) || /\b(Cr|Dr)\b/i.test(raw) || compact.includes(".") || compact.includes(",")) {
    return true;
  }

  const value = Number(compact.replace(/[^\d-]/g, ""));
  if (!Number.isFinite(value) || value > 9999999) return false;

  const after = text.slice(span[1], span[1] + 18);
  const before = text.slice(Math.max(0, span[0] - 18), span[0]);
  return /\s{2,}|$/.test(after) || /\s{2,}$/.test(before);
}

function spansOverlap(a, b) {
  return a[0] < b[1] && b[0] < a[1];
}

function directionFromTokenOrText(token, text) {
  if (token.suffix !== "unknown") return token.suffix;
  const lowered = text.toLowerCase();
  if (/\b(cr|credit|deposit|received|receipt|salary|interest|refund|reversal)\b/.test(lowered)) return "credit";
  if (/\b(dr|debit|withdrawal|paid|payment|atm|pos|charge|emi|upi\/|to\s)\b/.test(lowered)) return "debit";
  return "unknown";
}

function splitDebitCredit(amount, direction) {
  if (!amount) return { debit: 0, credit: 0 };
  if (direction === "credit") return { debit: 0, credit: amount };
  if (direction === "debit") return { debit: amount, credit: 0 };
  return { debit: 0, credit: amount };
}

function extractNarration(text, dateInfo, tailTokens) {
  let narration = text;
  if (dateInfo) {
    narration = narration.replace(dateInfo.raw, " ");
  }

  tailTokens.forEach((token) => {
    narration = narration.replace(token.raw, " ");
  });

  narration = narration
    .replace(/\b(?:value date|withdrawal|deposit|balance|debit|credit|amount|chq\.?|cheque|particulars|narration)\b/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

  return narration || "Transaction";
}

function cleanParsedRow(row) {
  return {
    ...row,
    debit: roundMoney(row.debit),
    credit: roundMoney(row.credit),
    balance: row.balance === null ? null : roundMoney(row.balance),
    narration: normalizeSpace(row.narration)
  };
}

function inferDirectionFromBalance(rows) {
  for (let index = 1; index < rows.length; index += 1) {
    const previous = rows[index - 1];
    const current = rows[index];
    if (previous.balance === null || current.balance === null) continue;

    const amount = current.debit || current.credit;
    if (!amount) continue;

    const delta = roundMoney(current.balance - previous.balance);
    if (Math.abs(Math.abs(delta) - amount) <= 0.1) {
      if (delta > 0 && current.debit > 0) {
        current.credit = amount;
        current.debit = 0;
      }
      if (delta < 0 && current.credit > 0) {
        current.debit = amount;
        current.credit = 0;
      }
    }
  }
}

function categorize(row) {
  const text = row.narration.toLowerCase();
  const isCredit = row.credit > 0;
  const isDebit = row.debit > 0;

  if (/(salary|payroll|sal credit|wages)/.test(text)) return "Salary";
  if (/(cash deposit|cdm|by cash|cash dep)/.test(text) && isCredit) return "Cash Deposit";
  if (/(atm|cash withdrawal|cash wdl|cash wd|self withdrawal)/.test(text) && isDebit) return "Cash Withdrawal";
  if (/(interest|int\.?pd|sbint|savings int)/.test(text) && isCredit) return "Bank Interest";
  if (/(charge|charges|fee|fees|sms|annual|gst on charges|penalty)/.test(text) && isDebit) return "Bank Charges";
  if (/(income tax|advance tax|self assessment|tds|challan|gst payment|tax payment|itr)/.test(text)) return "Tax Payment";
  if (/(sip|mutual fund|zerodha|groww|demat|nps|ppf|epf|shares|stock|mf purchase)/.test(text)) return "Investment";
  if (/(emi|loan|nach|ecs|finance|bajaj|lending|repayment)/.test(text) && isDebit) return "Loan EMI";
  if (/\brent\b/.test(text)) return "Rent";
  if (/(insurance|policy|lic|premium)/.test(text)) return "Insurance";
  if (/(refund|reversal|reversed|cashback)/.test(text) && isCredit) return "Refund/Reversal";
  if (/(upi|gpay|phonepe|paytm|bharatpe)/.test(text)) return "UPI";
  if (/(pos|card|debit card|credit card|visa|mastercard)/.test(text)) return "Card/POS";
  if (/(electricity|water|gas|broadband|mobile|airtel|jio|bsnl|utility)/.test(text)) return "Utilities";
  if (/(own account|self|transfer to self|transfer from self)/.test(text)) return "Self Transfer";
  if (isCredit && /(neft|imps|rtgs|upi|transfer|receipt|settlement|razorpay|cashfree|payu|swipe|invoice)/.test(text)) return "Business Receipt";
  if (isCredit) return "Uncategorised Credit";
  return "Other";
}

function scoreConfidence(row) {
  let score = 0.52;
  if (row.date) score += 0.16;
  if (row.narration && row.narration !== "Transaction") score += 0.1;
  if (row.debit || row.credit) score += 0.12;
  if (row.balance !== null) score += 0.08;
  if (row.category !== "Other" && row.category !== "Uncategorised Credit") score += 0.06;
  if (row.flags.length > 0) score -= 0.12;
  return Math.max(0.25, Math.min(0.99, score));
}

function buildRowFlags(row) {
  const flags = [];
  if (!row.date) flags.push("Missing date");
  if (!row.debit && !row.credit) flags.push("Missing amount");
  if (row.debit && row.credit) flags.push("Both debit and credit present");
  if (row.balance === null) flags.push("Balance not found");
  if (row.credit && row.category === "Uncategorised Credit") flags.push("Review income nature");
  if (row.confidence < 0.7) flags.push("Low extraction confidence");
  return flags;
}

function isNoiseLine(text) {
  const lowered = text.toLowerCase();
  if (text.length < 5) return true;
  return /(account statement|statement of account|customer id|account number|ifsc|micr|branch|address|opening balance|closing balance|page \d+|period|from date|to date|generated on|computer generated|continued|brought forward|carried forward|total debit|total credit)/i.test(lowered);
}

function shouldAppendLine(text) {
  if (isNoiseLine(text)) return false;
  if (findDate(text)) return false;
  return text.length < 180;
}

function refreshAnalysis() {
  state.rows.forEach((row) => {
    row.category = row.category || categorize(row);
    row.confidence = scoreConfidence(row);
    row.flags = buildRowFlags(row);
  });
  state.analysis = buildAnalysis(state.rows);
  renderSummary();
  renderRows();
  renderInsights();
  updateCategoryFilter();
  el.exportButton.disabled = state.rows.length === 0;
}

function buildAnalysis(rows) {
  const highValueLimit = Number(el.highValueLimit.value || 50000);
  const totals = {
    credit: sum(rows, "credit"),
    debit: sum(rows, "debit"),
    possibleIncome: 0,
    cashDeposits: 0,
    salary: 0,
    businessReceipts: 0,
    interest: 0,
    investments: 0,
    taxPayments: 0,
    loanEmi: 0,
    reviewFlags: []
  };

  const monthly = new Map();
  const byCategory = new Map();

  rows.forEach((row) => {
    const month = row.date ? row.date.slice(0, 7) : "Unknown";
    ensureBucket(monthly, month, { credit: 0, debit: 0, count: 0 });
    monthly.get(month).credit += row.credit;
    monthly.get(month).debit += row.debit;
    monthly.get(month).count += 1;

    ensureBucket(byCategory, row.category, { credit: 0, debit: 0, count: 0 });
    byCategory.get(row.category).credit += row.credit;
    byCategory.get(row.category).debit += row.debit;
    byCategory.get(row.category).count += 1;

    if (["Salary", "Business Receipt", "Cash Deposit", "Bank Interest", "Uncategorised Credit"].includes(row.category)) {
      totals.possibleIncome += row.credit;
    }
    if (row.category === "Cash Deposit") totals.cashDeposits += row.credit;
    if (row.category === "Salary") totals.salary += row.credit;
    if (row.category === "Business Receipt") totals.businessReceipts += row.credit;
    if (row.category === "Bank Interest") totals.interest += row.credit;
    if (row.category === "Investment") totals.investments += row.debit;
    if (row.category === "Tax Payment") totals.taxPayments += row.debit;
    if (row.category === "Loan EMI") totals.loanEmi += row.debit;

    const amount = Math.max(row.credit, row.debit);
    if (amount >= highValueLimit) {
      totals.reviewFlags.push({
        row,
        reason: `High value transaction above Rs ${formatNumber(highValueLimit)}`
      });
    }
    row.flags.forEach((reason) => totals.reviewFlags.push({ row, reason }));
  });

  return {
    totals: {
      ...totals,
      possibleIncome: roundMoney(totals.possibleIncome),
      cashDeposits: roundMoney(totals.cashDeposits),
      avgConfidence: rows.length ? rows.reduce((value, row) => value + row.confidence, 0) / rows.length : 0
    },
    monthly,
    byCategory,
    highValueLimit
  };
}

function ensureBucket(map, key, defaults) {
  if (!map.has(key)) {
    map.set(key, { ...defaults });
  }
}

function renderSummary() {
  const totals = state.analysis?.totals;
  if (!totals) return;
  el.totalCredit.textContent = formatCurrency(totals.credit);
  el.totalDebit.textContent = formatCurrency(totals.debit);
  el.possibleIncome.textContent = formatCurrency(totals.possibleIncome);
  el.reviewCount.textContent = String(totals.reviewFlags.length);
  el.transactionCount.textContent = String(state.rows.length);
  el.avgConfidence.textContent = `${Math.round(totals.avgConfidence * 100)}%`;
  el.cashDeposits.textContent = formatCurrency(totals.cashDeposits);
  el.extractionNote.textContent = state.notes.length ? state.notes.join(" | ") : "Rows ready for review.";
}

function renderRows() {
  const filtered = filteredRows();
  if (filtered.length === 0) {
    el.transactionBody.innerHTML = `<tr><td colspan="8" class="empty-cell">${state.rows.length ? "No rows match this view." : "Upload a PDF to begin."}</td></tr>`;
    return;
  }

  el.transactionBody.innerHTML = filtered.map((row) => {
    const confidenceClass = row.confidence < 0.58 ? "bad" : row.confidence < 0.75 ? "warn" : "";
    return `
      <tr data-id="${row.id}">
        <td><input class="date-input" data-field="date" type="date" value="${escapeAttr(row.date)}"></td>
        <td><input class="narration-input" data-field="narration" value="${escapeAttr(row.narration)}" title="${escapeAttr(row.sourceLine || row.narration)}"></td>
        <td><input class="amount-input" data-field="debit" inputmode="decimal" value="${row.debit || ""}"></td>
        <td><input class="amount-input" data-field="credit" inputmode="decimal" value="${row.credit || ""}"></td>
        <td><input class="amount-input" data-field="balance" inputmode="decimal" value="${row.balance ?? ""}"></td>
        <td>${categorySelect(row.category)}</td>
        <td><span class="confidence-pill ${confidenceClass}" title="${escapeAttr(row.flags.join("; ") || "Ready")}">${Math.round(row.confidence * 100)}%</span></td>
        <td><button class="delete-button" data-delete type="button" title="Delete row">x</button></td>
      </tr>
    `;
  }).join("");
}

function categorySelect(selected) {
  return `
    <select data-field="category">
      ${categories.map((category) => `<option value="${escapeAttr(category)}" ${category === selected ? "selected" : ""}>${escapeHtml(category)}</option>`).join("")}
    </select>
  `;
}

function filteredRows() {
  const query = el.searchInput.value.trim().toLowerCase();
  const category = el.categoryFilter.value;
  return state.rows.filter((row) => {
    if (category !== "all" && row.category !== category) return false;
    if (query && !row.narration.toLowerCase().includes(query)) return false;
    return true;
  });
}

function renderInsights() {
  if (!state.analysis || state.rows.length === 0) {
    el.insightList.innerHTML = `<article class="insight-item muted">Analysis points will appear here.</article>`;
    return;
  }

  const totals = state.analysis.totals;
  const insights = [
    {
      title: "Possible income",
      body: `${formatCurrency(totals.possibleIncome)} from salary, business receipts, interest, cash deposits, and uncategorised credits.`,
      type: totals.possibleIncome > 0 ? "good" : ""
    },
    {
      title: "Salary credits",
      body: `${formatCurrency(totals.salary)} detected. Cross-check with Form 16 and AIS.`,
      type: totals.salary > 0 ? "good" : ""
    },
    {
      title: "Business receipts",
      body: `${formatCurrency(totals.businessReceipts)} detected from settlement, NEFT, IMPS, invoice, or payment gateway patterns.`,
      type: totals.businessReceipts > 0 ? "warn" : ""
    },
    {
      title: "Cash deposits",
      body: `${formatCurrency(totals.cashDeposits)} detected. Keep explanation and source documents ready.`,
      type: totals.cashDeposits > 0 ? "warn" : ""
    },
    {
      title: "Interest income",
      body: `${formatCurrency(totals.interest)} detected. Match with bank interest certificate and AIS.`,
      type: totals.interest > 0 ? "good" : ""
    },
    {
      title: "Deductions review",
      body: `${formatCurrency(totals.investments + totals.taxPayments + totals.loanEmi)} found across investments, tax payments, and EMI categories.`,
      type: totals.investments + totals.taxPayments + totals.loanEmi > 0 ? "good" : ""
    },
    {
      title: "Manual review",
      body: `${totals.reviewFlags.length} items need checking because of value, category, balance, or extraction confidence.`,
      type: totals.reviewFlags.length > 0 ? "danger" : "good"
    }
  ];

  el.insightList.innerHTML = insights.map((item) => `
    <article class="insight-item ${item.type}">
      <strong>${escapeHtml(item.title)}</strong>
      <span>${escapeHtml(item.body)}</span>
    </article>
  `).join("");
}

function updateCategoryFilter() {
  const selected = el.categoryFilter.value;
  const active = Array.from(new Set(state.rows.map((row) => row.category))).sort();
  el.categoryFilter.innerHTML = `<option value="all">All categories</option>${active.map((category) => `<option value="${escapeAttr(category)}">${escapeHtml(category)}</option>`).join("")}`;
  el.categoryFilter.value = active.includes(selected) ? selected : "all";
}

function fillCategoryFilter() {
  el.categoryFilter.innerHTML = `<option value="all">All categories</option>`;
}

function updateRowFromField(row, target) {
  const field = target.dataset.field;
  if (!field) return;

  if (["debit", "credit", "balance"].includes(field)) {
    row[field] = target.value === "" ? (field === "balance" ? null : 0) : roundMoney(Number(target.value));
  } else {
    row[field] = target.value;
  }
}

function addManualRow() {
  state.rows.unshift({
    id: state.nextId++,
    date: new Date().toISOString().slice(0, 10),
    dateText: "",
    narration: "Manual entry",
    debit: 0,
    credit: 0,
    balance: null,
    category: "Other",
    confidence: 0.95,
    flags: [],
    page: "",
    sourceLine: "Manual entry"
  });
  refreshAnalysis();
}

function resetResults() {
  state.rows = [];
  state.rawLines = [];
  state.notes = [];
  state.analysis = null;
  renderRows();
  renderInsights();
  el.exportButton.disabled = true;
}

function clearWorkspace() {
  state.file = null;
  state.rows = [];
  state.rawLines = [];
  state.notes = [];
  state.analysis = null;
  el.pdfFile.value = "";
  el.pdfPassword.value = "";
  el.searchInput.value = "";
  el.categoryFilter.value = "all";
  el.fileLabel.textContent = "Choose bank statement";
  el.fileMeta.textContent = "Text PDF works fastest. OCR is available for scans.";
  setProgress(0, "Ready");
  refreshAnalysis();
}

function loadSampleRows() {
  state.notes = ["Sample rows loaded for interface review."];
  state.rows = [
    sampleRow("2025-04-03", "SALARY CREDIT ABC PRIVATE LIMITED", 0, 82000, 122000, "Salary"),
    sampleRow("2025-04-05", "UPI/RAJESH KUMAR/payment received", 0, 24500, 146500, "Business Receipt"),
    sampleRow("2025-04-06", "ATM CASH WITHDRAWAL", 10000, 0, 136500, "Cash Withdrawal"),
    sampleRow("2025-04-10", "CDM CASH DEPOSIT", 0, 60000, 196500, "Cash Deposit"),
    sampleRow("2025-04-15", "SIP MUTUAL FUND", 15000, 0, 181500, "Investment"),
    sampleRow("2025-04-20", "SAVINGS INTEREST CREDIT", 0, 740, 182240, "Bank Interest")
  ];
  refreshAnalysis();
  setProgress(100, "Sample rows ready");
}

function sampleRow(date, narration, debit, credit, balance, category) {
  return {
    id: state.nextId++,
    date,
    dateText: date,
    narration,
    debit,
    credit,
    balance,
    category,
    confidence: 0.96,
    flags: [],
    page: 1,
    sourceLine: narration
  };
}

async function exportWorkbook() {
  if (!state.rows.length) {
    setProgress(0, "No transactions are available to export.");
    return;
  }

  toggleBusy(true);
  try {
    setProgress(64, "Loading Excel exporter");
    const excelReady = await ensureExcelJs();
    if (!excelReady) {
      exportCsvFallback();
      setProgress(100, "CSV report downloaded because Excel exporter was unavailable.");
      return;
    }

    setProgress(72, "Preparing Excel workbook");
    const workbook = new window.ExcelJS.Workbook();
    workbook.creator = "Bank Statement ITR Analyzer";
    workbook.created = new Date();

    addTransactionsSheet(workbook);
    addAnalysisSheet(workbook);
    addMonthlySheet(workbook);
    addCategorySheet(workbook);
    addFlagsSheet(workbook);
    addNotesSheet(workbook);

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
    const name = `${safeFileName(state.file?.name?.replace(/\.pdf$/i, "") || "bank-statement")}-itr-analysis.xlsx`;
    downloadBlob(blob, name);
    setProgress(100, "Excel workbook download started");
  } catch (error) {
    try {
      exportCsvFallback();
      setProgress(100, `Excel failed. CSV report downloaded instead. ${cleanError(error)}`);
    } catch (fallbackError) {
      setProgress(0, `Export failed: ${cleanError(fallbackError)}`);
    }
  } finally {
    toggleBusy(false);
  }
}

async function ensureExcelJs() {
  if (window.ExcelJS) return true;
  try {
    await loadScript(EXCELJS_URL, "exceljs-dynamic");
  } catch (error) {
    return false;
  }
  return Boolean(window.ExcelJS);
}

function addTransactionsSheet(workbook) {
  const sheet = workbook.addWorksheet("Transactions");
  sheet.columns = [
    { header: "Date", key: "date", width: 14 },
    { header: "Narration", key: "narration", width: 56 },
    { header: "Debit", key: "debit", width: 14 },
    { header: "Credit", key: "credit", width: 14 },
    { header: "Balance", key: "balance", width: 16 },
    { header: "Category", key: "category", width: 22 },
    { header: "Confidence", key: "confidence", width: 14 },
    { header: "Flags", key: "flags", width: 36 },
    { header: "Page", key: "page", width: 8 },
    { header: "Source Line", key: "sourceLine", width: 70 }
  ];
  state.rows.forEach((row) => {
    sheet.addRow({
      ...row,
      confidence: Math.round(row.confidence * 100) / 100,
      flags: row.flags.join("; ")
    });
  });
  styleSheet(sheet);
  numberColumns(sheet, ["C", "D", "E"]);
}

function addAnalysisSheet(workbook) {
  const sheet = workbook.addWorksheet("ITR Analysis");
  const totals = state.analysis.totals;
  const rows = [
    ["Assessment Year", el.assessmentYear.value],
    ["Total Credits", totals.credit],
    ["Total Debits", totals.debit],
    ["Possible Income Credits", totals.possibleIncome],
    ["Salary Credits", totals.salary],
    ["Business Receipts", totals.businessReceipts],
    ["Cash Deposits", totals.cashDeposits],
    ["Bank Interest", totals.interest],
    ["Investments/Deductions Review", totals.investments],
    ["Tax Payments", totals.taxPayments],
    ["Loan EMI Payments", totals.loanEmi],
    ["Review Flags", totals.reviewFlags.length],
    ["Average Confidence", `${Math.round(totals.avgConfidence * 100)}%`],
    ["Important Note", "Review with CA/user before ITR filing. This workbook is not tax advice."]
  ];
  sheet.addRows(rows);
  sheet.columns = [{ width: 34 }, { width: 26 }];
  styleSheet(sheet);
  numberColumns(sheet, ["B"]);
}

function addMonthlySheet(workbook) {
  const sheet = workbook.addWorksheet("Monthly Summary");
  sheet.columns = [
    { header: "Month", key: "month", width: 16 },
    { header: "Credits", key: "credit", width: 16 },
    { header: "Debits", key: "debit", width: 16 },
    { header: "Net", key: "net", width: 16 },
    { header: "Count", key: "count", width: 10 }
  ];
  Array.from(state.analysis.monthly.entries()).sort().forEach(([month, item]) => {
    sheet.addRow({
      month,
      credit: roundMoney(item.credit),
      debit: roundMoney(item.debit),
      net: roundMoney(item.credit - item.debit),
      count: item.count
    });
  });
  styleSheet(sheet);
  numberColumns(sheet, ["B", "C", "D"]);
}

function addCategorySheet(workbook) {
  const sheet = workbook.addWorksheet("Category Summary");
  sheet.columns = [
    { header: "Category", key: "category", width: 24 },
    { header: "Credits", key: "credit", width: 16 },
    { header: "Debits", key: "debit", width: 16 },
    { header: "Net", key: "net", width: 16 },
    { header: "Count", key: "count", width: 10 }
  ];
  Array.from(state.analysis.byCategory.entries()).sort().forEach(([category, item]) => {
    sheet.addRow({
      category,
      credit: roundMoney(item.credit),
      debit: roundMoney(item.debit),
      net: roundMoney(item.credit - item.debit),
      count: item.count
    });
  });
  styleSheet(sheet);
  numberColumns(sheet, ["B", "C", "D"]);
}

function addFlagsSheet(workbook) {
  const sheet = workbook.addWorksheet("Review Flags");
  sheet.columns = [
    { header: "Date", key: "date", width: 14 },
    { header: "Narration", key: "narration", width: 60 },
    { header: "Amount", key: "amount", width: 16 },
    { header: "Category", key: "category", width: 22 },
    { header: "Reason", key: "reason", width: 44 }
  ];
  state.analysis.totals.reviewFlags.forEach(({ row, reason }) => {
    sheet.addRow({
      date: row.date,
      narration: row.narration,
      amount: row.credit || row.debit,
      category: row.category,
      reason
    });
  });
  styleSheet(sheet);
  numberColumns(sheet, ["C"]);
}

function addNotesSheet(workbook) {
  const sheet = workbook.addWorksheet("Extraction Notes");
  sheet.columns = [
    { header: "Type", key: "type", width: 18 },
    { header: "Detail", key: "detail", width: 100 }
  ];
  state.notes.forEach((note) => sheet.addRow({ type: "Note", detail: note }));
  sheet.addRow({ type: "Bank", detail: el.bankSelect.value });
  sheet.addRow({ type: "File", detail: state.file?.name || "Sample/manual rows" });
  sheet.addRow({ type: "Generated", detail: new Date().toLocaleString() });
  styleSheet(sheet);
}

function styleSheet(sheet) {
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E63D6" } };
  header.alignment = { vertical: "middle" };
  sheet.eachRow((row) => {
    row.eachCell((cell) => {
      cell.border = {
        top: { style: "thin", color: { argb: "FFD9E0E7" } },
        left: { style: "thin", color: { argb: "FFD9E0E7" } },
        bottom: { style: "thin", color: { argb: "FFD9E0E7" } },
        right: { style: "thin", color: { argb: "FFD9E0E7" } }
      };
      cell.alignment = { vertical: "top", wrapText: true };
    });
  });
  sheet.views = [{ state: "frozen", ySplit: 1 }];
}

function numberColumns(sheet, columns) {
  columns.forEach((column) => {
    sheet.getColumn(column).numFmt = '#,##0.00';
  });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function exportCsvFallback() {
  const lines = [];
  const totals = state.analysis?.totals || buildAnalysis(state.rows).totals;

  lines.push(["Bank Statement ITR Analysis"]);
  lines.push(["Generated", new Date().toLocaleString()]);
  lines.push(["File", state.file?.name || "Sample/manual rows"]);
  lines.push([]);
  lines.push(["Metric", "Value"]);
  lines.push(["Total Credits", totals.credit]);
  lines.push(["Total Debits", totals.debit]);
  lines.push(["Possible Income Credits", totals.possibleIncome]);
  lines.push(["Cash Deposits", totals.cashDeposits]);
  lines.push(["Review Flags", totals.reviewFlags.length]);
  lines.push([]);
  lines.push(["Date", "Narration", "Debit", "Credit", "Balance", "Category", "Confidence", "Flags", "Page", "Source Line"]);

  state.rows.forEach((row) => {
    lines.push([
      row.date,
      row.narration,
      row.debit,
      row.credit,
      row.balance ?? "",
      row.category,
      `${Math.round(row.confidence * 100)}%`,
      row.flags.join("; "),
      row.page,
      row.sourceLine
    ]);
  });

  const csv = lines.map((line) => line.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const name = `${safeFileName(state.file?.name?.replace(/\.pdf$/i, "") || "bank-statement")}-itr-analysis.csv`;
  downloadBlob(blob, name);
}

function csvCell(value) {
  const text = String(value ?? "");
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function loadScript(src, id) {
  return new Promise((resolve, reject) => {
    if (document.getElementById(id)) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.id = id;
    script.src = src;
    script.async = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.appendChild(script);
  });
}

function toggleBusy(isBusy) {
  el.analyzeButton.disabled = isBusy;
  el.exportButton.disabled = isBusy || state.rows.length === 0;
  el.sampleButton.disabled = isBusy;
}

function setProgress(value, message) {
  el.progressBar.style.width = `${Math.max(0, Math.min(100, value))}%`;
  el.statusText.textContent = message;
}

function sum(rows, field) {
  return roundMoney(rows.reduce((total, row) => total + (Number(row[field]) || 0), 0));
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function formatCurrency(value) {
  return `Rs ${formatNumber(value)}`;
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 2,
    minimumFractionDigits: Number(value) % 1 === 0 ? 0 : 2
  }).format(Number(value) || 0);
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function normalizeSpace(value) {
  return String(value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function safeFileName(value) {
  return normalizeSpace(value).replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "bank-statement";
}

function cleanError(error) {
  const message = error?.message || String(error);
  if (/password/i.test(message)) {
    return "PDF password is required or incorrect.";
  }
  return message;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}
