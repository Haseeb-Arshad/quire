import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import cors from "cors";
import express from "express";
import multer from "multer";
import { extractBookDocument } from "./extractors";
import type { BookDocument } from "./bookTypes";

const PORT = Number(process.env.PORT || 8787);
const ROOT = process.cwd();
const STORAGE_DIR = path.join(ROOT, "storage");
const UPLOAD_DIR = path.join(STORAGE_DIR, "uploads");
const BOOK_DIR = path.join(STORAGE_DIR, "books");

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 80 * 1024 * 1024
  }
});

app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "bookform-reader", port: PORT });
});

app.get("/api/books", async (_req, res, next) => {
  try {
    await ensureStorage();
    const names = await fs.readdir(BOOK_DIR);
    const books = await Promise.all(
      names
        .filter((name) => name.endsWith(".json"))
        .map(async (name) => {
          const book = await readBook(name.replace(/\.json$/, ""));
          return summarizeBook(book);
        })
    );
    books.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
    res.json({ books });
  } catch (error) {
    next(error);
  }
});

app.get("/api/books/:id", async (req, res, next) => {
  try {
    const book = await readBook(req.params.id);
    res.json({ book });
  } catch (error) {
    next(error);
  }
});

app.get("/api/books/:id/file", async (req, res, next) => {
  try {
    const book = await readBook(req.params.id);
    if (!book.storedFile) {
      res.status(404).json({ error: "No original file was stored for this book." });
      return;
    }
    const filePath = path.join(UPLOAD_DIR, book.storedFile);
    res.setHeader("Content-Type", book.mimeType || "application/octet-stream");
    res.sendFile(filePath, (error) => {
      if (error) next(error);
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/books/upload", upload.single("book"), async (req, res, next) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "Upload a PDF, EPUB, TXT, HTML, or Markdown file." });
      return;
    }

    await ensureStorage();
    const id = crypto.randomUUID();
    const uploadedAt = new Date().toISOString();
    const safeName = req.file.originalname.replace(/[^\w.\- ()]/g, "_");
    const storedFile = `${id}-${safeName}`;
    await fs.writeFile(path.join(UPLOAD_DIR, storedFile), req.file.buffer);

    const book = await extractBookDocument({
      id,
      fileName: req.file.originalname,
      mimeType: req.file.mimetype || "application/octet-stream",
      sizeBytes: req.file.size,
      uploadedAt,
      buffer: req.file.buffer,
      storedFile
    });

    await writeBook(book);
    res.status(201).json({ book });
  } catch (error) {
    next(error);
  }
});

app.post("/api/books/demo", async (_req, res, next) => {
  try {
    await ensureStorage();
    const text = demoBookText();
    const buffer = Buffer.from(text, "utf8");
    const id = crypto.randomUUID();
    const book = await extractBookDocument({
      id,
      fileName: "memoirs-demo.txt",
      mimeType: "text/plain",
      sizeBytes: buffer.byteLength,
      uploadedAt: new Date().toISOString(),
      buffer
    });
    await writeBook(book);
    res.status(201).json({ book });
  } catch (error) {
    next(error);
  }
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : "Unexpected server error";
  const status = message.includes("ENOENT") ? 404 : 500;
  res.status(status).json({ error: message });
});

async function ensureStorage() {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  await fs.mkdir(BOOK_DIR, { recursive: true });
}

async function writeBook(book: BookDocument) {
  await fs.writeFile(path.join(BOOK_DIR, `${book.id}.json`), JSON.stringify(book, null, 2), "utf8");
}

async function readBook(id: string): Promise<BookDocument> {
  const raw = await fs.readFile(path.join(BOOK_DIR, `${id}.json`), "utf8");
  return JSON.parse(raw) as BookDocument;
}

function summarizeBook(book: BookDocument) {
  const { sections: _sections, rawSample: _rawSample, ...summary } = book;
  return summary;
}

function demoBookText() {
  return `The Project Gutenberg eBook of Memoirs of Extraordinary Popular Delusions and the Madness of Crowds

Title: Memoirs of Extraordinary Popular Delusions and the Madness of Crowds
Author: Charles Mackay
Language: English

MEMOIRS

OF

EXTRAORDINARY POPULAR DELUSIONS

AND THE

MADNESS OF CROWDS

PREFACE

In reading the history of nations, we find that, like individuals, they have their whims and their peculiarities, their seasons of excitement and recklessness, when they care not what they do.

Men, it has been well said, think in herds. It will be seen that they go mad in herds, while they only recover their senses slowly, and one by one.

THE MISSISSIPPI SCHEME

The personal character and career of one man are so intimately connected with the great scheme which bears the name of the Mississippi, that a history of the madness of the people would be incomplete without him.

The people, eager for sudden wealth, forgot the slow processes by which prosperity is commonly achieved. Every rumor became a promise, and every promise became a market.

THE SOUTH SEA BUBBLE

Another delusion, no less remarkable, seized upon England at a time when speculation had become the fashion of the day.

The street, the coffee-house, and the exchange were filled with projects. Some were impossible, some were fraudulent, and some were only dreams dressed in the language of commerce.`;
}

app.listen(PORT, "127.0.0.1", () => {
  console.log(`Bookform Reader API listening on http://127.0.0.1:${PORT}`);
});
