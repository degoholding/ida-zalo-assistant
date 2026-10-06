import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { AppConfig } from "../config.js";
import type { Db } from "../db/pool.js";
import { createLogger } from "../logger.js";
import { ApiError } from "../web/api/api-http.js";
import { readEnvValue, parseSettingInput } from "./setting-input-parser.js";
import { SETTING_DEFINITIONS, findSetting, type SettingDefinition, type SettingValue } from "./setting-registry.js";
import {
  buildSettingView,
  decodeStoredValue,
  effectiveValue,
  encodeStoredValue,
  sameSettingValue,
  type SettingState,
  type SettingView,
} from "./setting-values.js";

// Kho cài đặt: đọc bảng app_setting, phủ lên AppConfig đang chạy (mọi nơi giữ tham chiếu config thấy
// ngay). Không bao giờ log hay trả ra ngoài giá trị khóa bí mật.

const log = createLogger("settings");

interface WebEntry {
  value: SettingValue;
  broken: boolean;
}

export class SettingsStore {
  /** Khóa có dòng trong app_setting → giá trị đã giải mã (hoặc đánh dấu giải mã hỏng). */
  private readonly webEntries = new Map<string, WebEntry>();

  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  /** Đọc mọi dòng app_setting, giải mã khóa bí mật, phủ lên config. Gọi một lần lúc khởi động. */
  async load(): Promise<void> {
    const [rows] = await this.db.query<RowDataPacket[]>("SELECT setting_key, value, is_secret FROM app_setting");
    this.webEntries.clear();
    for (const row of rows) {
      const definition = findSetting(String(row.setting_key));
      if (!definition) continue; // khóa đã bỏ khỏi registry — để yên trong DB, không dùng
      const decoded = decodeStoredValue(String(row.value), Boolean(row.is_secret), this.config.sessionEncryptionKey);
      if (!decoded.ok) log.warn(`cài đặt «${definition.label}» không giải mã được — coi như chưa đặt, cần nhập lại`);
      this.webEntries.set(definition.key, decoded.ok ? { value: decoded.value, broken: false } : { value: null, broken: true });
    }
    for (const definition of SETTING_DEFINITIONS) this.apply(definition);
    if (this.webEntries.size) log.info(`đã nạp ${this.webEntries.size} cài đặt đặt trên web`);
  }

  describe(): SettingView[] {
    return SETTING_DEFINITIONS.filter((definition) => !definition.hidden).map((definition) => buildSettingView(definition, this.state(definition)));
  }

  /** Máy chủ tự ghi một khóa ẩn (vd tài khoản Google sau «Kết nối Google») — không qua kiểm giá trị của PATCH. */
  async saveInternal(key: string, value: SettingValue, actor: string): Promise<void> {
    const definition = findSetting(key);
    if (!definition?.hidden) throw new Error(`saveInternal chỉ dành cho khóa ẩn, không phải ${key}`);
    await this.db.query(
      `INSERT INTO app_setting (setting_key, value, is_secret, updated_by) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE value = VALUES(value), is_secret = VALUES(is_secret), updated_by = VALUES(updated_by)`,
      [key, encodeStoredValue(definition, value, this.config.sessionEncryptionKey), definition.secret ? 1 : 0, actor.slice(0, 100)],
    );
    this.webEntries.set(key, { value, broken: false });
    this.apply(definition);
  }

  /**
   * Lưu nhiều khóa một lượt: kiểm hết rồi mới ghi (một khóa sai thì không ghi khóa nào), một transaction.
   * Khóa bí mật gửi rỗng / null = giữ nguyên. Trả danh sách khóa thật sự đổi.
   */
  async save(changes: Record<string, unknown>, actor: string): Promise<string[]> {
    const pending: { definition: SettingDefinition; value: SettingValue }[] = [];
    for (const [key, raw] of Object.entries(changes)) {
      const definition = findSetting(key);
      // Khóa ẩn coi như không có — chỉ máy chủ ghi (saveInternal)
      if (!definition || definition.hidden) throw new ApiError(422, "validation_error", `Không có cài đặt ${key}`);
      if (definition.secret && (raw === "" || raw === null || raw === undefined)) continue;
      const value = parseSettingInput(definition, raw);
      const current = effectiveValue(definition, this.state(definition));
      // Đang lấy từ .env / mặc định mà gửi lại đúng giá trị đó thì không ghi gì
      if (sameSettingValue(value, current) && !this.webEntries.get(key)?.broken) continue;
      pending.push({ definition, value });
    }
    if (!pending.length) return [];

    const connection = await this.db.getConnection();
    try {
      await connection.beginTransaction();
      for (const { definition, value } of pending) {
        await connection.query(
          `INSERT INTO app_setting (setting_key, value, is_secret, updated_by) VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE value = VALUES(value), is_secret = VALUES(is_secret), updated_by = VALUES(updated_by)`,
          [definition.key, encodeStoredValue(definition, value, this.config.sessionEncryptionKey), definition.secret ? 1 : 0, actor.slice(0, 100)],
        );
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      throw error;
    } finally {
      connection.release();
    }
    for (const { definition, value } of pending) {
      this.webEntries.set(definition.key, { value, broken: false });
      this.apply(definition);
    }
    return pending.map(({ definition }) => definition.key);
  }

  /** Xóa dòng → quay về .env / mặc định, phủ lại config. Trả false nếu khóa vốn không đặt trên web. */
  async reset(key: string): Promise<boolean> {
    const definition = findSetting(key);
    if (!definition) throw new ApiError(404, "not_found", `Không có cài đặt ${key}`);
    const [result] = await this.db.query<ResultSetHeader>("DELETE FROM app_setting WHERE setting_key = ?", [key]);
    const existed = this.webEntries.delete(key) || result.affectedRows > 0;
    this.apply(definition);
    return existed;
  }

  /** Giá trị đang hiệu lực đã giải mã — CHỈ dùng nội bộ máy chủ (vd Google client), không đưa ra API. */
  getSecret(key: string): SettingValue {
    const definition = findSetting(key);
    return definition ? effectiveValue(definition, this.state(definition)) : null;
  }

  private state(definition: SettingDefinition): SettingState {
    const entry = this.webEntries.get(definition.key);
    return {
      hasRow: entry !== undefined,
      webValue: entry?.value ?? null,
      broken: entry?.broken ?? false,
      envValue: readEnvValue(definition, this.env),
    };
  }

  private apply(definition: SettingDefinition): void {
    definition.applyTo(this.config, effectiveValue(definition, this.state(definition)));
  }
}
