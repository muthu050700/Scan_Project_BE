const express = require("express");
const OCR_Router = express.Router();
const multer = require("multer");
const fs = require("fs");
const { GoogleGenAI } = require("@google/genai");

const upload = multer({ dest: "uploads/" });
const MODEL = "gemini-2.5-flash-lite";

function getAI() {
    if (!process.env.GEMINI_API_KEY) {
        throw new Error("GEMINI_API_KEY is not set in .env file");
    }
    return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
}

// ── PDF → base64 images (no GraphicsMagick needed) ──
async function pdfToImages(pdfBuffer) {
    const { pdf } = await import("pdf-to-img");
    const images = [];
    const document = await pdf(pdfBuffer, { scale: 2.0 });
    for await (const pageBuffer of document) {
        images.push(Buffer.from(pageBuffer).toString("base64"));
    }
    return images;
}

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

OCR_Router.post("/ocr", upload.single("file"), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const rawOnly = req.query.rawOnly === "true";

    try {
        const fileBuffer = fs.readFileSync(req.file.path);
        const mimeType = req.file.mimetype;
        let images = [];

        if (mimeType === "application/pdf") {
            images = await pdfToImages(fileBuffer);
        } else if (["image/jpeg", "image/png", "image/webp", "image/jpg"].includes(mimeType)) {
            images = [fileBuffer.toString("base64")];
        } else {
            fs.unlinkSync(req.file.path);
            return res.status(400).json({ error: `Unsupported file type: ${mimeType}` });
        }

        const rawText = await extractRawText(images);
        fs.unlinkSync(req.file.path);

        if (rawOnly) {
            return res.json({ success: true, pages: images.length, rawText });
        }

        const invoices = await structureToGSTFormat(rawText);

        return res.json({
            success: true,
            pages: images.length,
            totalInvoices: invoices.length,
            invoices,
            rawText,
        });

    } catch (err) {
        if (req.file?.path && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        console.error("OCR Error:", err.message);
        return res.status(500).json({ error: err.message });
    }
});

module.exports = OCR_Router;