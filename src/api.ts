import type { BookDocument, BookSummary } from "./types";

export async function getBooks(): Promise<BookSummary[]> {
  const response = await fetch("/api/books");
  if (!response.ok) throw new Error(await getError(response));
  const data = (await response.json()) as { books: BookSummary[] };
  return data.books;
}

export async function getBook(id: string): Promise<BookDocument> {
  const response = await fetch(`/api/books/${id}`);
  if (!response.ok) throw new Error(await getError(response));
  const data = (await response.json()) as { book: BookDocument };
  return data.book;
}

export async function uploadBook(file: File): Promise<BookDocument> {
  const form = new FormData();
  form.set("book", file);
  const response = await fetch("/api/books/upload", {
    method: "POST",
    body: form
  });
  if (!response.ok) throw new Error(await getError(response));
  const data = (await response.json()) as { book: BookDocument };
  return data.book;
}

export async function createDemoBook(): Promise<BookDocument> {
  const response = await fetch("/api/books/demo", {
    method: "POST"
  });
  if (!response.ok) throw new Error(await getError(response));
  const data = (await response.json()) as { book: BookDocument };
  return data.book;
}

async function getError(response: Response) {
  try {
    const data = (await response.json()) as { error?: string };
    return data.error || response.statusText;
  } catch {
    return response.statusText;
  }
}
