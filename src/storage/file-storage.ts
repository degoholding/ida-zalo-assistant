import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import type { Readable } from "node:stream";
import path from "node:path";
import { DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { AppConfig } from "../config.js";

export interface FileStorage {
  /** Ghi tệp, trả về khóa đã lưu (đường dẫn tương đối trong kho). */
  put(key: string, body: Buffer, contentType: string): Promise<string>;
  /** Xóa theo đúng khóa put() đã trả về. Tệp không còn thì coi như đã xóa. */
  delete(storedKey: string): Promise<void>;
  /** Mở luồng đọc để trả tệp về trình duyệt — không nạp cả tệp vào bộ nhớ. */
  read(storedKey: string): Promise<Readable>;
  /** Liệt kê tệp dưới một tiền tố khóa (vd «backups/») — dọn bản sao lưu cũ. Trả khóa đúng dạng put() trả về. */
  list?(prefix: string): Promise<StoredObject[]>;
}

export interface StoredObject {
  key: string;
  lastModified: Date;
  bytes: number;
}

export class LocalFileStorage implements FileStorage {
  constructor(private readonly rootDir: string) {}

  async put(key: string, body: Buffer): Promise<string> {
    const target = path.join(this.rootDir, key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, body);
    return key;
  }

  async delete(storedKey: string): Promise<void> {
    await fs.rm(path.join(this.rootDir, storedKey), { force: true });
  }

  async read(storedKey: string): Promise<Readable> {
    const target = path.resolve(this.rootDir, storedKey);
    // Khóa lưu đến từ DB, nhưng vẫn chặn thoát ra ngoài thư mục kho
    if (!target.startsWith(path.resolve(this.rootDir) + path.sep)) throw new Error("Khóa lưu không hợp lệ");
    await fs.access(target);
    return createReadStream(target);
  }

  async list(prefix: string): Promise<StoredObject[]> {
    const base = path.resolve(this.rootDir, prefix);
    if (!base.startsWith(path.resolve(this.rootDir))) throw new Error("Tiền tố không hợp lệ");
    const entries = await fs.readdir(base, { withFileTypes: true, recursive: true }).catch(() => []);
    const objects: StoredObject[] = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const full = path.join(entry.parentPath, entry.name);
      const stat = await fs.stat(full);
      objects.push({ key: path.relative(this.rootDir, full).split(path.sep).join("/"), lastModified: stat.mtime, bytes: stat.size });
    }
    return objects;
  }

  /** Đường dẫn tệp thật của một khóa (để chuyển sang R2). */
  pathOf(storedKey: string): string {
    return path.resolve(this.rootDir, storedKey);
  }
}

export class R2FileStorage implements FileStorage {
  private readonly client: S3Client;

  constructor(private readonly options: AppConfig["r2"]) {
    this.client = new S3Client({
      region: "auto",
      endpoint: options.endpoint,
      credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey },
    });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<string> {
    const fullKey = `${this.options.prefix}${key}`;
    await this.client.send(
      new PutObjectCommand({ Bucket: this.options.bucket, Key: fullKey, Body: body, ContentType: contentType }),
    );
    return fullKey;
  }

  async delete(storedKey: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.options.bucket, Key: storedKey }));
  }

  async read(storedKey: string): Promise<Readable> {
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.options.bucket, Key: storedKey }));
    if (!response.Body) throw new Error("R2 không trả nội dung tệp");
    return response.Body as Readable;
  }

  async list(prefix: string): Promise<StoredObject[]> {
    const objects: StoredObject[] = [];
    let token: string | undefined;
    do {
      const page = await this.client.send(new ListObjectsV2Command({
        Bucket: this.options.bucket, Prefix: `${this.options.prefix}${prefix}`, ContinuationToken: token,
      }));
      for (const item of page.Contents ?? []) {
        if (item.Key) objects.push({ key: item.Key, lastModified: item.LastModified ?? new Date(0), bytes: Number(item.Size ?? 0) });
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return objects;
  }

  get prefix(): string {
    return this.options.prefix;
  }

  /** Khóa đã lưu trên R2 luôn mang tiền tố R2_PREFIX — khóa không có tiền tố là tệp còn nằm ở đĩa (chưa chuyển). */
  owns(storedKey: string): boolean {
    return storedKey.startsWith(this.options.prefix);
  }
}

/**
 * Lúc chuyển từ đĩa sang R2 (08/10/2026): tệp mới ghi lên R2; tệp cũ (khóa chưa mang tiền tố R2) vẫn đọc / xóa ở đĩa cho
 * tới khi lệnh `npm run cli -- storage-to-r2` chép hết lên R2. Nhờ vậy bật R2 không phải dừng bot chờ chép.
 */
export class R2WithLocalFallback implements FileStorage {
  constructor(readonly r2: R2FileStorage, readonly local: LocalFileStorage) {}

  get r2Prefix(): string {
    return this.r2.prefix;
  }

  put(key: string, body: Buffer, contentType: string): Promise<string> {
    return this.r2.put(key, body, contentType);
  }

  delete(storedKey: string): Promise<void> {
    return this.r2.owns(storedKey) ? this.r2.delete(storedKey) : this.local.delete(storedKey);
  }

  read(storedKey: string): Promise<Readable> {
    return this.r2.owns(storedKey) ? this.r2.read(storedKey) : this.local.read(storedKey);
  }

  list(prefix: string): Promise<StoredObject[]> {
    return this.r2.list(prefix);
  }
}

export function createFileStorage(config: AppConfig): FileStorage {
  if (config.storageDriver === "r2") {
    const { endpoint, accessKeyId, secretAccessKey, bucket } = config.r2;
    if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
      throw new Error("STORAGE_DRIVER=r2 cần đủ R2_ENDPOINT (hoặc R2_ACCOUNT_ID), R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET");
    }
    // Tiền tố là thứ phân biệt khóa R2 với khóa tệp còn ở đĩa (R2WithLocalFallback) — để trống thì không phân biệt được
    if (!config.r2.prefix.endsWith("/") || config.r2.prefix.length < 2) throw new Error("R2_PREFIX phải có dạng «ten-thu-muc/», vd bot-tro-ly/");
    return new R2WithLocalFallback(new R2FileStorage(config.r2), new LocalFileStorage(path.join(config.dataDir, "files")));
  }
  return new LocalFileStorage(path.join(config.dataDir, "files"));
}
