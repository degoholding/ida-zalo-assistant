import { MessageKind } from "../constants.js";

// Dịch nội dung thô của zca-js thành bản ghi lưu được. Tin chữ: content là chuỗi. Tin ảnh/file/
// video/link…: content là object có href/title/params (params lại là CHUỖI JSON lồng bên trong).
// Loại lạ không đoán bừa: ghi Other, giữ nguyên raw_content để dò sau.

export interface ParsedAttachment {
  url: string;
  fileName: string;
  fileExt: string;
  declaredSize: number | null;
}

export interface ParsedContent {
  kind: MessageKind;
  text: string;
  attachment: ParsedAttachment | null;
}

type Payload = Record<string, unknown>;

// Ánh xạ msgType của Zalo → loại tin. Khớp theo tiền tố để bắt cả biến thể (chat.video.msg…)
const KIND_BY_TYPE_PREFIX: [string, MessageKind][] = [
  ["webchat", MessageKind.Text],
  ["chat.photo", MessageKind.Image],
  ["chat.doodle", MessageKind.Image],
  ["chat.gif", MessageKind.Image],
  ["share.file", MessageKind.File],
  ["chat.video", MessageKind.Video],
  ["chat.voice", MessageKind.Voice],
  ["chat.sticker", MessageKind.Sticker],
  ["chat.link", MessageKind.Link],
  ["chat.location", MessageKind.Location],
];

// Loại có tệp đáng tải về kho. Sticker không tính — đó là ảnh của Zalo, không phải tài liệu.
const KINDS_WITH_FILE = new Set([MessageKind.Image, MessageKind.File, MessageKind.Video, MessageKind.Voice]);

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function parseParams(raw: unknown): Payload {
  if (raw && typeof raw === "object") return raw as Payload;
  if (typeof raw !== "string" || raw.trim() === "") return {};
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" ? (value as Payload) : {};
  } catch {
    return {};
  }
}

function detectKind(msgType: string, payload: Payload): MessageKind {
  const type = msgType.toLowerCase();
  for (const [prefix, kind] of KIND_BY_TYPE_PREFIX) {
    if (type.startsWith(prefix)) return kind;
  }
  if (type === "chat.recommended") {
    const action = asString(payload.action);
    // Zalo viết sai chính tả "recommened" trong action — khớp cả hai
    if (/recomm?ened\.user/.test(action)) return MessageKind.Contact;
    if (/recomm?ened\.link/.test(action) || asString(payload.href)) return MessageKind.Link;
  }
  return MessageKind.Other;
}

function extensionOf(fileName: string): string {
  const match = /\.([a-z0-9]{1,10})$/i.exec(fileName);
  return match ? match[1].toLowerCase() : "";
}

function buildAttachment(kind: MessageKind, payload: Payload, params: Payload): ParsedAttachment | null {
  if (!KINDS_WITH_FILE.has(kind)) return null;
  // Ảnh: bản nét (params.hd) trước, href sau
  const url = (kind === MessageKind.Image && asString(params.hd)) || asString(payload.href);
  if (!url) return null;
  const fileName = kind === MessageKind.File ? asString(payload.title) : "";
  const declaredSize = Number(params.fileSize);
  return {
    url,
    fileName,
    fileExt: asString(params.fileExt).toLowerCase() || extensionOf(fileName),
    declaredSize: Number.isFinite(declaredSize) && declaredSize > 0 ? declaredSize : null,
  };
}

function buildText(kind: MessageKind, payload: Payload): string {
  const title = asString(payload.title);
  const description = asString(payload.description);
  switch (kind) {
    case MessageKind.Link:
      return [title, description, asString(payload.href)].filter(Boolean).join("\n");
    case MessageKind.File:
      return title;
    default:
      // Ảnh/video kèm chú thích: chú thích nằm ở title hoặc description
      return [title, description].filter(Boolean).join("\n");
  }
}

export function parseZaloContent(msgType: string | undefined, content: unknown): ParsedContent {
  if (typeof content === "string") {
    return { kind: MessageKind.Text, text: content, attachment: null };
  }
  if (!content || typeof content !== "object") {
    return { kind: MessageKind.Other, text: "", attachment: null };
  }
  const payload = content as Payload;
  const params = parseParams(payload.params);
  const kind = detectKind(msgType ?? "", payload);
  return { kind, text: buildText(kind, payload), attachment: buildAttachment(kind, payload, params) };
}
