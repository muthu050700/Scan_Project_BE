const express = require("express");
const OCR_Router = express.Router();
const multer = require("multer");
const fs = require("fs");
const { GoogleGenAI } = require("@google/genai");

const upload = multer({
    dest: "uploads/",
    limits: {
        files: 10,                  // max 10 files per request
        fileSize: 20 * 1024 * 1024, // max 20MB per file
    },
    fileFilter: (req, file, cb) => {
        const allowed = [
            "application/pdf",
            "image/jpeg",
            "image/jpg",
            "image/png",
            "image/webp",
        ];
        if (allowed.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error(`Unsupported file type: ${file.mimetype}`), false);
        }
    },
});

const MODEL = "gemini-2.5-flash-lite"; // Use latest Gemini 2 Flash Lite for best OCR performance

// ── Supported MIME types ──
const SUPPORTED_TYPES = [
    "application/pdf",
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
];

function getAI() {
    if (!process.env.GEMINI_API_KEY) {
        throw new Error("GEMINI_API_KEY is not set in .env file");
    }
    return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
}

// ── PDF → base64 images ──
async function pdfToImages(pdfBuffer) {
    const { pdf } = await import("pdf-to-img");
    const images = [];
    const document = await pdf(pdfBuffer, { scale: 2.0 });
    for await (const pageBuffer of document) {
        images.push(Buffer.from(pageBuffer).toString("base64"));
    }
    return images;
}

// ── Process a single file → base64 image array ──
async function fileToImages(file) {
    const fileBuffer = fs.readFileSync(file.path);
    const mimeType = file.mimetype;

    if (mimeType === "application/pdf") {
        return await pdfToImages(fileBuffer);
    } else if (["image/jpeg", "image/png", "image/webp", "image/jpg"].includes(mimeType)) {
        return [fileBuffer.toString("base64")];
    }
    throw new Error(`Unsupported file type: ${mimeType}`);
}

// ── Extract raw text from images via Gemini ──
async function extractRawText(images) {
    const ai = getAI();
    const parts = [
        ...images.map((img) => ({
            inlineData: { data: img, mimeType: "image/png" },
        })),
        {
            text: `You are an OCR engine. Extract ALL text from the image(s) exactly as written.
- Preserve all labels, values, dates, numbers, and fields
- Maintain original structure and line breaks
- Do NOT summarize or skip any content`,
        },
    ];
    const response = await ai.models.generateContent({
        model: MODEL,
        contents: [{ role: "user", parts }],
    });
    return response.text;
}

// ── Structure raw text into GST invoice JSON ──
async function structureToGSTFormat(rawText) {
    const ai = getAI();

    const prompt = `You are a GST invoice data extraction expert.

Extract invoice data from the text below and return a JSON array.
Each element = ONE invoice row with EXACTLY these keys:

{
  "gstinOfSupplier": "",
  "tradeLegalName": "",
  "narration": "",
  "invoiceNumber": "",
  "invoiceDate": "",
  "invoiceValue": null,
  "taxableValue": null,
  "integratedTax": null,
  "centralTax": null,
  "stateUtTax": null,
  "tds": null
}

Rules:
- Return ONLY a valid JSON array — no explanation, no markdown, no backticks
- invoiceValue, taxableValue, integratedTax, centralTax, stateUtTax, tds must be numbers
- Use 0 for tax fields not present, null for completely missing data
- One object per invoice — do NOT merge multiple invoices
- invoiceDate format: DD/MM/YYYY

Extracted Text:
"""
${rawText}
"""`;

    const response = await ai.models.generateContent({
        model: MODEL,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
    });

    let jsonText = response.text
        .trim()
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/```\s*$/i, "")
        .trim();

    try {
        const parsed = JSON.parse(jsonText);
        return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
        return [];
    }
}

// ── Process ONE file end-to-end (OCR + structure) ──
async function processFile(file, rawOnly = false) {
    let images = [];
    let errorMsg = null;

    try {
        images = await fileToImages(file);
        const rawText = await extractRawText(images);

        if (rawOnly) {
            return {
                fileName: file.originalname,
                mimeType: file.mimetype,
                pages: images.length,
                success: true,
                rawText,
                invoices: [],
            };
        }

        const invoices = await structureToGSTFormat(rawText);
        return {
            fileName: file.originalname,
            mimeType: file.mimetype,
            pages: images.length,
            success: true,
            rawText,
            invoices,
        };
    } catch (err) {
        errorMsg = err.message;
        return {
            fileName: file.originalname,
            mimeType: file.mimetype,
            pages: images.length,
            success: false,
            error: errorMsg,
            rawText: null,
            invoices: [],
        };
    } finally {
        // Always clean up temp file
        if (file?.path && fs.existsSync(file.path)) {
            fs.unlinkSync(file.path);
        }
    }
}

// ── POST /ocr — single file (backward compatible) ──
OCR_Router.post("/ocr", upload.single("file"), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const rawOnly = req.query.rawOnly === "true";

    try {
        const result = await processFile(req.file, rawOnly);

        if (!result.success) {
            return res.status(500).json({ error: result.error });
        }

        return res.json({
            success: true,
            pages: result.pages,
            totalInvoices: result.invoices.length,
            invoices: result.invoices,
            rawText: result.rawText,
        });
    } catch (err) {
        if (req.file?.path && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        console.error("OCR Error:", err.message);
        return res.status(500).json({ error: err.message });
    }
});

// ── POST /ocr/batch — multiple files (up to 10) ──
// Field name: "files" (array)
// Optional query: ?rawOnly=true  → skip structuring
// Optional query: ?mode=parallel (default) | sequential
OCR_Router.post("/ocr/batch", upload.array("files", 10), async (req, res) => {
    const files = req.files;

    if (!files || files.length === 0) {
        return res.status(400).json({ error: "No files uploaded" });
    }

    const rawOnly = req.query.rawOnly === "true";

    // "sequential" mode processes one at a time (safer for rate limits)
    // "parallel" mode (default) processes all files concurrently (faster)
    // const mode = req.query.mode === "sequential" ? "sequential" : "sequential";
    const mode = "sequential";

    try {
        let results = [];

        if (mode === "parallel") {
            // All files processed at the same time
            results = await Promise.all(
                files.map((file) => processFile(file, rawOnly))
            );
        } else {
            // One file at a time — safer if Gemini rate limits are tight
            for (const file of files) {
                const result = await processFile(file, rawOnly);
                results.push(result);
            }
        }

        // ── Aggregate summary ──
        const succeeded = results.filter((r) => r.success);
        const failed = results.filter((r) => !r.success);
        const allInvoices = succeeded.flatMap((r) => r.invoices);
        const totalPages = succeeded.reduce((sum, r) => sum + r.pages, 0);

        return res.json({
            success: true,
            mode,
            summary: {
                totalFiles: files.length,
                successCount: succeeded.length,
                failedCount: failed.length,
                totalPages,
                totalInvoices: allInvoices.length,
            },
            // Per-file breakdown
            files: results.map((r) => ({
                fileName: r.fileName,
                mimeType: r.mimeType,
                pages: r.pages,
                success: r.success,
                invoiceCount: r.invoices.length,
                error: r.error || null,
            })),
            // All invoices from all files merged into one array
            invoices: allInvoices,
            // Raw text per file (useful for debugging)
            rawTexts: results.map((r) => ({
                fileName: r.fileName,
                rawText: r.rawText,
            })),
        });
    } catch (err) {
        // Cleanup any remaining temp files on unexpected crash
        if (files) {
            files.forEach((file) => {
                if (file?.path && fs.existsSync(file.path)) {
                    fs.unlinkSync(file.path);
                }
            });
        }
        console.error("Batch OCR Error:", err.message);
        return res.status(500).json({ error: err.message });
    }
});

module.exports = OCR_Router;