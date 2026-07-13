// Curated reading fonts — the kind top magazines and blog agencies actually set
// their long-form text in. Georgia is the global default, per request.
// System fonts need no download; the Google families are loaded in index.html.

export interface ReadingFont {
  id: string;
  label: string;
  stack: string;
  category: "Classic" | "Magazine" | "Modern" | "Sans";
  note: string;
}

export const READING_FONTS: ReadingFont[] = [
  {
    id: "times",
    label: "Times New Roman",
    stack: `"Times New Roman", Times, "Liberation Serif", serif`,
    category: "Classic",
    note: "The newspaper standard"
  },
  {
    id: "georgia",
    label: "Georgia",
    stack: `Georgia, "Times New Roman", serif`,
    category: "Classic",
    note: "Screen-tuned serif"
  },
  {
    id: "palatino",
    label: "Palatino",
    stack: `"Palatino Linotype", "Book Antiqua", Palatino, serif`,
    category: "Classic",
    note: "Warm, calligraphic"
  },
  {
    id: "baskerville",
    label: "Baskerville",
    stack: `Baskerville, "Baskerville Old Face", "Libre Baskerville", Georgia, serif`,
    category: "Classic",
    note: "Elegant transitional"
  },
  {
    id: "iowan",
    label: "Iowan Old Style",
    stack: `"Iowan Old Style", "Palatino Linotype", Palatino, serif`,
    category: "Classic",
    note: "Bookish, sturdy"
  },
  {
    id: "lora",
    label: "Lora",
    stack: `"Lora", Georgia, serif`,
    category: "Magazine",
    note: "Balanced editorial serif"
  },
  {
    id: "playfair",
    label: "Playfair Display",
    stack: `"Playfair Display", Georgia, serif`,
    category: "Magazine",
    note: "High-contrast, glossy"
  },
  {
    id: "merriweather",
    label: "Merriweather",
    stack: `"Merriweather", Georgia, serif`,
    category: "Magazine",
    note: "Comfortable at length"
  },
  {
    id: "source-serif",
    label: "Source Serif",
    stack: `"Source Serif 4", "Source Serif Pro", Georgia, serif`,
    category: "Modern",
    note: "Clean, contemporary"
  },
  {
    id: "literata",
    label: "Literata",
    stack: `"Literata", Georgia, serif`,
    category: "Modern",
    note: "Google's reading face"
  },
  {
    id: "spectral",
    label: "Spectral",
    stack: `"Spectral", Georgia, serif`,
    category: "Modern",
    note: "Screen-first serif"
  },
  {
    id: "inter",
    label: "Inter",
    stack: `"Inter", -apple-system, "Segoe UI", sans-serif`,
    category: "Sans",
    note: "Neutral workhorse"
  },
  {
    id: "system",
    label: "System Sans",
    stack: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`,
    category: "Sans",
    note: "Native UI font"
  }
];

export const DEFAULT_FONT_ID = "georgia";

export function fontStack(id: string): string {
  return (READING_FONTS.find((font) => font.id === id) || READING_FONTS[0]).stack;
}
