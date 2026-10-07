import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { AppConfig } from "../config.js";
import { AiKeyProvider } from "../constants.js";
import { decryptJson, encryptJson } from "../crypto/session-cipher.js";
import type { Db } from "../db/pool.js";
import { createLogger, describeError } from "../logger.js";
import { ApiError } from "../web/api/api-http.js";
import { AI_PROVIDERS, AiKeyCheckError, assertPublicStation, isAiKeyProvider, normalizeBaseUrl, probeAiKey } from "./ai-key-providers.js";
import { GeminiClient } from "./gemini-client.js";
import { KeyUsageLedger, vnDayKey, type ChainKey, type KeyProblem } from "./key-chain-client.js";
import { resolveModelKeys } from "./model-router-client.js";
import { OpenAIClient } from "./openai-client.js";

// Kho «Khóa AI» (bảng ai_key, 07/10/2026): nạp các khóa còn dùng vào bộ nhớ (đã giải mã — CHỈ dùng trong máy chủ), dựng
// chuỗi khóa cho trợ lý, thêm / sửa / đổi thứ tự / gỡ cho API, và chép một lần từ cài đặt cũ. Khóa thô không bao giờ đi ra
// API hay log: màn hình chỉ thấy 4 ký tự cuối.

const log = createLogger("ai-key");
const MODEL_NAME_PATTERN = /^[A-Za-z0-9._:/@-]{2,120}$/;
const MAX_DAILY_CAP = 1_000_000;
/** Người ghi các dòng chép từ cài đặt cũ. */
export const LEGACY_MIGRATION_ACTOR = "Chuyển từ cài đặt cũ";

interface AiKeyRecord {
  id: number;
  provider: AiKeyProvider;
  baseUrl: string;
  model: string;
  modelHeavy: string;
  /** null = không giải mã được (đổi SESSION_ENCRYPTION_KEY) — khóa bị bỏ qua, màn hình báo nhập lại. */
  secret: string | null;
  keyTail: string;
  priority: number;
  dailyCap: number;
  lastError: string;
  lastErrorAt: Date | null;
  verifiedAt: Date | null;
}

/** Một dòng như `GET /api/ai-keys` trả — KHÔNG có khóa, chỉ đuôi. */
export interface AiKeyView {
  id: number;
  /** Số thứ tự trên màn hình: 1 = khóa bot dùng trước. */
  position: number;
  provider: AiKeyProvider;
  provider_label: string;
  /** Chỉ hãng tùy chỉnh; hãng khác rỗng. */
  base_url: string;
  model: string;
  model_heavy: string;
  /** Mô hình dùng khi `model` rỗng. */
  default_model: string;
  /** «…ab12». */
  key_tail: string;
  daily_cap: number;
  used_today: number;
  last_error: string;
  last_error_at: string | null;
  /** Khóa không giải mã được — bot bỏ qua, phải gỡ rồi thêm lại. */
  broken: boolean;
  verified_at: string | null;
}

export interface AiKeyInput {
  provider: AiKeyProvider;
  key: string;
  baseUrl: string;
  model: string;
  modelHeavy: string;
  dailyCap: number;
}

export interface AiKeyPatch {
  model?: string;
  modelHeavy?: string;
  dailyCap?: number;
}

function invalid(message: string): ApiError {
  return new ApiError(422, "validation_error", message);
}

function parseModelName(value: unknown, label: string): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw invalid(`${label} phải là chữ`);
  const name = value.trim();
  if (name && !MODEL_NAME_PATTERN.test(name)) throw invalid(`${label}: chỉ gồm chữ, số và . _ : / @ - (2–120 ký tự)`);
  return name;
}

function parseDailyCap(value: unknown): number {
  if (value === undefined || value === null || value === "") return 0;
  const cap = Number(value);
  if (!Number.isInteger(cap) || cap < 0 || cap > MAX_DAILY_CAP) throw invalid(`Trần lượt / ngày là số nguyên từ 0 đến ${MAX_DAILY_CAP.toLocaleString("vi-VN")}`);
  return cap;
}

/** Thân `POST /api/ai-keys` → dữ liệu đã kiểm (chưa gọi hãng). Hàm thuần. */
export function parseAiKeyInput(body: Record<string, unknown>): AiKeyInput {
  const provider = Number(body.provider);
  if (!isAiKeyProvider(provider)) throw invalid("Chọn hãng AI");
  const key = typeof body.key === "string" ? body.key.trim() : "";
  if (!key) throw invalid("Dán khóa vào ô «Dán khóa»");
  if (key.length < 10 || key.length > 500 || /\s/.test(key)) throw invalid("Khóa không đúng dạng (không có khoảng trắng, 10–500 ký tự)");
  let baseUrl = "";
  if (provider === AiKeyProvider.OpenAICompatible) {
    if (typeof body.base_url !== "string" || !body.base_url.trim()) throw invalid("Nhập địa chỉ trạm, vd https://modelapi.vn/v1");
    try {
      baseUrl = normalizeBaseUrl(body.base_url);
    } catch (error) {
      if (error instanceof AiKeyCheckError) throw invalid(error.message);
      throw error;
    }
  }
  return {
    provider, key, baseUrl,
    model: parseModelName(body.model, "Mô hình"),
    modelHeavy: parseModelName(body.model_heavy, "Mô hình việc nặng"),
    dailyCap: parseDailyCap(body.daily_cap),
  };
}

/** Thân `PATCH /api/ai-keys/:id` — chỉ mô hình + trần; đổi khóa / hãng = gỡ rồi thêm. Hàm thuần. */
export function parseAiKeyPatch(body: Record<string, unknown>): AiKeyPatch {
  const patch: AiKeyPatch = {};
  if ("model" in body) patch.model = parseModelName(body.model, "Mô hình");
  if ("model_heavy" in body) patch.modelHeavy = parseModelName(body.model_heavy, "Mô hình việc nặng");
  if ("daily_cap" in body) patch.dailyCap = parseDailyCap(body.daily_cap);
  return patch;
}

/** Một dòng định chép từ cài đặt cũ. */
export interface LegacyKeyRow {
  provider: AiKeyProvider;
  baseUrl: string;
  model: string;
  modelHeavy: string;
  key: string;
}

type LegacyAssistantConfig = Pick<AppConfig["assistant"],
  "provider" | "apiKey" | "openaiApiKey" | "openaiBaseUrl" | "model" | "heavyModel" | "openaiModel" | "openaiHeavyModel">;

/**
 * Cài đặt cũ (Nhà cung cấp AI + khóa Gemini / OpenAI + mô hình) → các dòng Khóa AI theo ĐÚNG thứ tự bot đang dùng:
 * «ưu tiên OpenAI, lỗi thì Gemini» = dòng 1 OpenAI (địa chỉ API khác api.openai.com → «Tương thích OpenAI (tùy chỉnh)»),
 * dòng 2 Gemini; chỉ một bên thì một dòng. Khóa bên không dùng không chép. Hàm thuần.
 */
export function planLegacyKeyRows(assistant: LegacyAssistantConfig): LegacyKeyRow[] {
  const keys = resolveModelKeys({ geminiKey: assistant.apiKey, openaiKey: assistant.openaiApiKey, openaiBaseUrl: assistant.openaiBaseUrl });
  const rows: LegacyKeyRow[] = [];
  const heavyOrEmpty = (heavy: string, model: string) => (heavy && heavy !== model ? heavy : "");
  if (keys.openaiKey && assistant.provider !== "gemini") {
    const baseUrl = (keys.openaiBaseUrl ?? "").trim().replace(/\/+$/, "");
    const official = !baseUrl || baseUrl === AI_PROVIDERS[AiKeyProvider.OpenAI].baseUrl;
    rows.push({
      provider: official ? AiKeyProvider.OpenAI : AiKeyProvider.OpenAICompatible,
      baseUrl: official ? "" : baseUrl,
      model: assistant.openaiModel,
      modelHeavy: heavyOrEmpty(assistant.openaiHeavyModel, assistant.openaiModel),
      key: keys.openaiKey,
    });
  }
  if (keys.geminiKey && assistant.provider !== "openai") {
    rows.push({
      provider: AiKeyProvider.Gemini, baseUrl: "", model: assistant.model,
      modelHeavy: heavyOrEmpty(assistant.heavyModel, assistant.model), key: keys.geminiKey,
    });
  }
  return rows;
}

const keyTailOf = (key: string) => key.slice(-4);

function providerLabel(provider: AiKeyProvider): string {
  return AI_PROVIDERS[provider]?.label ?? `Hãng ${provider}`;
}

/** Dòng trong bộ nhớ → bản xem cho API. Không bao giờ chép `secret`. Hàm thuần. */
export function toAiKeyView(record: AiKeyRecord, position: number, usedToday: number): AiKeyView {
  return {
    id: record.id,
    position,
    provider: record.provider,
    provider_label: providerLabel(record.provider),
    base_url: record.provider === AiKeyProvider.OpenAICompatible ? record.baseUrl : "",
    model: record.model,
    model_heavy: record.modelHeavy,
    default_model: AI_PROVIDERS[record.provider]?.defaultModel ?? "",
    key_tail: record.keyTail ? `…${record.keyTail}` : "",
    daily_cap: record.dailyCap,
    used_today: usedToday,
    last_error: record.lastError,
    last_error_at: record.lastErrorAt ? record.lastErrorAt.toISOString() : null,
    broken: record.secret === null,
    verified_at: record.verifiedAt ? record.verifiedAt.toISOString() : null,
  };
}

export interface AddAiKeyDeps {
  fetcher?: typeof fetch;
  resolve?: (host: string) => Promise<string[]>;
}

export class AiKeyStore {
  private records: AiKeyRecord[] = [];
  readonly ledger: KeyUsageLedger;

  constructor(
    private readonly db: Db,
    private readonly encryptionKey: string,
    private readonly now: () => number = Date.now,
  ) {
    this.ledger = new KeyUsageLedger(
      (keyId, day) => {
        this.db.query(
          `INSERT INTO ai_key_usage (ai_key_id, usage_date, call_count) VALUES (?, ?, 1)
           ON DUPLICATE KEY UPDATE call_count = call_count + 1`, [keyId, day],
        ).catch((error) => log.warn(`ghi lượt dùng khóa #${keyId} lỗi: ${describeError(error)}`));
      },
      (keyId, problem, at) => this.rememberFailure(keyId, problem, at),
    );
  }

  /** Còn khóa nào dùng được — có thì bot chạy bằng chuỗi khóa, không thì bằng cài đặt cũ. */
  get hasUsableKeys(): boolean {
    return this.records.some((record) => record.secret !== null);
  }

  /** Nạp các khóa chưa gỡ (theo thứ tự) + số lượt hôm nay. Gọi lúc khởi động và sau mỗi lần sửa. */
  async load(): Promise<void> {
    const [rows] = await this.db.query<RowDataPacket[]>(
      `SELECT id, provider, base_url, model, model_heavy, secret, key_tail, priority, daily_cap, last_error, last_error_at, verified_at
       FROM ai_key WHERE deleted_at IS NULL ORDER BY priority, id`);
    this.records = rows.map((row) => {
      let secret: string | null = null;
      try {
        secret = decryptJson<string>(String(row.secret), this.encryptionKey);
      } catch {
        log.warn(`khóa AI #${row.id} không giải mã được (đổi SESSION_ENCRYPTION_KEY?) — bỏ qua, cần gỡ rồi thêm lại`);
      }
      return {
        id: Number(row.id), provider: Number(row.provider) as AiKeyProvider, baseUrl: String(row.base_url ?? ""),
        model: String(row.model ?? ""), modelHeavy: String(row.model_heavy ?? ""), secret, keyTail: String(row.key_tail ?? ""),
        priority: Number(row.priority), dailyCap: Number(row.daily_cap ?? 0), lastError: String(row.last_error ?? ""),
        lastErrorAt: row.last_error_at ? new Date(row.last_error_at as Date) : null,
        verifiedAt: row.verified_at ? new Date(row.verified_at as Date) : null,
      };
    });
    const day = vnDayKey(this.now());
    const [usage] = await this.db.query<RowDataPacket[]>("SELECT ai_key_id, call_count FROM ai_key_usage WHERE usage_date = ?", [day]);
    for (const row of usage) this.ledger.seed(Number(row.ai_key_id), day, Number(row.call_count));
  }

  list(): AiKeyView[] {
    const now = this.now();
    return this.records.map((record, index) => toAiKeyView(record, index + 1, this.ledger.usedOn(record.id, now)));
  }

  find(id: number): AiKeyView | undefined {
    return this.list().find((view) => view.id === id);
  }

  /** Chuỗi khóa cho trợ lý — mỗi khóa một client gọi hãng. Khóa không giải mã được thì bỏ. */
  buildChainKeys(): ChainKey[] {
    return this.list().flatMap((view) => {
      const record = this.records.find((item) => item.id === view.id);
      if (!record?.secret) return [];
      const info = AI_PROVIDERS[record.provider];
      if (!info) return [];
      const model = record.model || info.defaultModel;
      if (!model) return [];
      const client = record.provider === AiKeyProvider.Gemini
        ? new GeminiClient(record.secret, model)
        : new OpenAIClient(record.secret, model, [], fetch, record.provider === AiKeyProvider.OpenAICompatible ? record.baseUrl : info.baseUrl);
      return [{
        id: record.id, label: `số ${view.position} (${info.label} ${view.key_tail})`, client, model,
        heavyModel: record.modelHeavy, dailyCap: record.dailyCap,
      }];
    });
  }

  /** Kiểm trạm + gọi thử hãng rồi mới lưu, xếp cuối danh sách. Trả dòng mới + ghi chú (nếu có). */
  async add(input: AiKeyInput, actor: string, deps: AddAiKeyDeps = {}): Promise<{ view: AiKeyView; note: string }> {
    const duplicate = this.records.find((record) => record.provider === input.provider && record.secret === input.key
      && record.baseUrl === input.baseUrl);
    if (duplicate) throw invalid(`Khóa này đã có ở dòng số ${this.records.indexOf(duplicate) + 1}`);
    if (input.baseUrl) await assertPublicStation(input.baseUrl, deps.resolve);
    const probe = await probeAiKey({ provider: input.provider, key: input.key, baseUrl: input.baseUrl, model: input.model }, deps.fetcher);
    let model = input.model;
    if (!model && !AI_PROVIDERS[input.provider].defaultModel) {
      // Trạm tùy chỉnh chưa chọn mô hình: lấy mô hình đầu tiên trạm liệt kê (như ERP)
      model = probe.models[0] ?? "";
      if (!model) throw new AiKeyCheckError("Trạm không liệt kê mô hình nào — nhập tên mô hình ở «Tùy chọn».");
    }
    const [maxRows] = await this.db.query<RowDataPacket[]>("SELECT COALESCE(MAX(priority), 0) AS p FROM ai_key WHERE deleted_at IS NULL");
    const [result] = await this.db.query<ResultSetHeader>(
      `INSERT INTO ai_key (provider, base_url, model, model_heavy, secret, key_tail, priority, daily_cap, verified_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [input.provider, input.baseUrl, model, input.modelHeavy, encryptJson(input.key, this.encryptionKey), keyTailOf(input.key),
        Number(maxRows[0].p) + 1, input.dailyCap, new Date(this.now()), actor.slice(0, 100)],
    );
    await this.load();
    const view = this.find(result.insertId);
    if (!view) throw new Error("Vừa lưu khóa mà không đọc lại được");
    return { view, note: probe.note };
  }

  /** Trả bản cũ + bản mới (để ghi nhật ký các ô đổi), null = không có dòng. */
  async update(id: number, patch: AiKeyPatch, actor: string): Promise<{ before: AiKeyView; after: AiKeyView } | null> {
    const before = this.find(id);
    if (!before) return null;
    const sets: string[] = [];
    const values: unknown[] = [];
    if (patch.model !== undefined) { sets.push("model = ?"); values.push(patch.model); }
    if (patch.modelHeavy !== undefined) { sets.push("model_heavy = ?"); values.push(patch.modelHeavy); }
    if (patch.dailyCap !== undefined) { sets.push("daily_cap = ?"); values.push(patch.dailyCap); }
    if (patch.model === "" && !AI_PROVIDERS[before.provider]?.defaultModel) throw invalid("Hãng tùy chỉnh phải có tên mô hình");
    if (sets.length) {
      await this.db.query(`UPDATE ai_key SET ${sets.join(", ")}, updated_by = ? WHERE id = ? AND deleted_at IS NULL`, [...values, actor.slice(0, 100), id]);
      await this.load();
    }
    const after = this.find(id) ?? before;
    return { before, after };
  }

  /** Đưa khóa lên trước một bậc (đổi chỗ với dòng ngay trên). Trả vị trí mới, null = không có dòng / đã đứng đầu. */
  async moveUp(id: number, actor: string): Promise<number | null> {
    const index = this.records.findIndex((record) => record.id === id);
    if (index <= 0) return null;
    const current = this.records[index];
    const previous = this.records[index - 1];
    // Hai dòng trùng priority (sửa tay DB) thì vẫn tách được: dòng đưa lên lấy số nhỏ hơn
    const upper = Math.min(previous.priority, current.priority);
    const lower = upper === current.priority ? upper + 1 : current.priority;
    // Một câu UPDATE cho cả hai dòng — không có lúc nửa vời
    await this.db.query(
      `UPDATE ai_key SET priority = CASE id WHEN ? THEN ? WHEN ? THEN ? END, updated_by = ? WHERE id IN (?, ?)`,
      [current.id, upper, previous.id, lower, actor.slice(0, 100), current.id, previous.id],
    );
    await this.load();
    return index;
  }

  /** Gỡ khóa (đánh dấu deleted_at — bảng vẫn «đã từng có khóa» nên không chép lại từ cài đặt cũ). */
  async remove(id: number, actor: string): Promise<AiKeyView | null> {
    const view = this.find(id);
    if (!view) return null;
    await this.db.query("UPDATE ai_key SET deleted_at = ?, updated_by = ? WHERE id = ? AND deleted_at IS NULL", [new Date(this.now()), actor.slice(0, 100), id]);
    await this.load();
    return view;
  }

  /**
   * Chép MỘT LẦN từ cài đặt cũ: chỉ khi bảng ai_key chưa từng có dòng nào (kể cả dòng đã gỡ). Gọi lúc khởi động, sau khi
   * nạp cài đặt (app_setting phủ .env). Trả các dòng đã chép (rỗng = không làm gì).
   */
  async migrateLegacyKeys(assistant: LegacyAssistantConfig): Promise<LegacyKeyRow[]> {
    const [rows] = await this.db.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM ai_key");
    if (Number(rows[0].n) > 0) return [];
    const plan = planLegacyKeyRows(assistant);
    for (const [index, row] of plan.entries()) {
      // Không gọi thử hãng: khóa đang chạy thật, khởi động không được chờ / hỏng vì mạng
      await this.db.query(
        `INSERT INTO ai_key (provider, base_url, model, model_heavy, secret, key_tail, priority, daily_cap, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
        [row.provider, row.baseUrl, row.model, row.modelHeavy, encryptJson(row.key, this.encryptionKey), keyTailOf(row.key), index + 1, LEGACY_MIGRATION_ACTOR],
      );
    }
    return plan;
  }

  private rememberFailure(keyId: number, problem: KeyProblem, at: number): void {
    const record = this.records.find((item) => item.id === keyId);
    if (record) {
      record.lastError = problem.label;
      record.lastErrorAt = new Date(at);
    }
    this.db.query("UPDATE ai_key SET last_error = ?, last_error_at = ? WHERE id = ?", [problem.label.slice(0, 200), new Date(at), keyId])
      .catch((error) => log.warn(`ghi lỗi khóa #${keyId} lỗi: ${describeError(error)}`));
  }
}
