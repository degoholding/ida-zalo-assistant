import { createRequire } from "node:module";

// Chữ cho pdfmake: (1) «**cụm từ**» → tô màu nhấn (như chữ xanh trong mẫu recap); (2) ký tự font chính (Be Vietnam Pro)
// không có — ✓ → ↔ ≥ ★ … — chuyển sang font ký hiệu dự phòng, không thì PDF hiện ô vuông. pdfmake không tự rơi font.

export interface TextRun {
  text: string;
  font?: string;
  color?: string;
  bold?: boolean;
}

interface GlyphFont {
  hasGlyphForCodePoint(codePoint: number): boolean;
}

/** Bộ kiểm nét chữ: font chính + các font dự phòng theo thứ tự (tên font pdfmake ↔ tệp TTF). */
export class GlyphCoverage {
  private readonly fonts: { name: string; font: GlyphFont }[];

  constructor(main: string, fallbacks: { name: string; path: string }[], mainPath: string) {
    const require = createRequire(import.meta.url);
    const fontkit = require("fontkit") as { default?: { openSync(path: string): GlyphFont }; openSync(path: string): GlyphFont };
    const open = (path: string) => (fontkit.default ?? fontkit).openSync(path);
    this.fonts = [{ name: main, font: open(mainPath) }, ...fallbacks.map((item) => ({ name: item.name, font: open(item.path) }))];
  }

  /** Tên font vẽ được ký tự này (font chính nếu không font nào có — để pdfmake tự xử lý). */
  fontFor(char: string): string {
    const codePoint = char.codePointAt(0) ?? 0;
    return (this.fonts.find((entry) => entry.font.hasGlyphForCodePoint(codePoint)) ?? this.fonts[0]).name;
  }
}

/** Tách chữ thành các đoạn cùng font; đoạn nằm trong «**…**» mang màu nhấn. Hàm thuần (chỉ dùng coverage.fontFor). */
export function toTextRuns(input: string, coverage: Pick<GlyphCoverage, "fontFor">, accentColor: string, mainFont: string): TextRun[] {
  const runs: TextRun[] = [];
  const parts = input.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  for (const part of parts) {
    const accent = part.startsWith("**") && part.endsWith("**") && part.length > 4;
    const body = accent ? part.slice(2, -2) : part;
    for (const char of Array.from(body)) {
      const font = coverage.fontFor(char);
      const last = runs[runs.length - 1];
      const color = accent ? accentColor : undefined;
      if (last && last.font === (font === mainFont ? undefined : font) && last.color === color) last.text += char;
      else runs.push({ text: char, ...(font === mainFont ? {} : { font }), ...(color ? { color } : {}) });
    }
  }
  return runs;
}
