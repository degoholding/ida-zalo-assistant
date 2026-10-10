import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GlyphCoverage } from "./pdf-text-runs.js";

// Máy dựng PDF dùng chung cho mọi khuôn (recap họp, báo cáo tuần / tháng, …) — tách khỏi meeting-recap-pdf.ts
// (07/10/2026 phase 3) để khuôn mới không phải chép lại phần nạp pdfmake + font. pdfmake (JS thuần, không cần
// Chrome) + font Be Vietnam Pro (OFL) trong assets/fonts; logo + bảng màu theo nhận diện DEGO.

export const ASSETS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../assets");
export const FONT_DIR = path.join(ASSETS, "fonts");
export const LOGO = path.join(ASSETS, "brand", "dego-holding-logo.png");
export const MAIN_FONT = "BeVietnam";

/** Bảng màu nhận diện DEGO dùng chung cho mọi khuôn PDF. */
export const COLOR = {
  teal: "#1f7a99", tealText: "#1d5f78", tealLight: "#eef5f9", green: "#7cc242", border: "#cfdde6",
  muted: "#6b7c88", tldrBg: "#fff8e6", tldrBorder: "#f5a623", text: "#1f2a33",
};

export interface PdfMake {
  addFonts(fonts: Record<string, Record<string, string>>): void;
  setLocalAccessPolicy(callback: (filePath: string) => boolean): void;
  setUrlAccessPolicy(callback: (url: string) => boolean): void;
  createPdf(doc: object): { getBuffer(): Promise<Buffer> };
}

let engine: { pdfmake: PdfMake; coverage: GlyphCoverage } | null = null;

/** Nạp pdfmake + font một lần cho cả tiến trình; chỉ cho đọc tệp trong assets, cấm tải URL. */
export function getEngine() {
  if (engine) return engine;
  const require = createRequire(import.meta.url);
  const pdfmake = require("pdfmake") as PdfMake;
  const font = (name: string) => path.join(FONT_DIR, name);
  pdfmake.addFonts({
    [MAIN_FONT]: { normal: font("BeVietnamPro-Regular.ttf"), bold: font("BeVietnamPro-SemiBold.ttf"), italics: font("BeVietnamPro-Italic.ttf"), bolditalics: font("BeVietnamPro-BoldItalic.ttf") },
    SymbolsMath: { normal: font("NotoSansMath-Regular.ttf"), bold: font("NotoSansMath-Regular.ttf"), italics: font("NotoSansMath-Regular.ttf"), bolditalics: font("NotoSansMath-Regular.ttf") },
    Symbols2: { normal: font("NotoSansSymbols2-Regular.ttf"), bold: font("NotoSansSymbols2-Regular.ttf"), italics: font("NotoSansSymbols2-Regular.ttf"), bolditalics: font("NotoSansSymbols2-Regular.ttf") },
  });
  pdfmake.setLocalAccessPolicy((filePath) => path.resolve(filePath).startsWith(ASSETS));
  pdfmake.setUrlAccessPolicy(() => false);
  const coverage = new GlyphCoverage(MAIN_FONT, [
    { name: "SymbolsMath", path: font("NotoSansMath-Regular.ttf") }, { name: "Symbols2", path: font("NotoSansSymbols2-Regular.ttf") },
  ], font("BeVietnamPro-Regular.ttf"));
  engine = { pdfmake, coverage };
  return engine;
}
