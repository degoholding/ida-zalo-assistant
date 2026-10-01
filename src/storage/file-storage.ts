import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import type { Readable } from "node:stream";
import path from "node:path";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { AppConfig } from "../config.js";

export interface FileStorage {
  /** Ghi tệp, trả về khóa đã lưu (đường dẫn tương đối trong kho). */
  put(key: string, body: Buffer, contentType: string): Promise<string>;
  /** Xóa theo đúng khóa put() đã trả về. Tệp không còn thì coi như đã xóa. */
  delete(storedKey: string): Promise<void>;
  /** Mở luồng đọc để trả tệp về trình duyệt — không nạp cả tệp vào bộ nhớ. */
  read(storedKey: string): Promise<Readable>;
}

class LocalFileStorage implements FileStorage {
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
}

class R2FileStorage implements FileStorage {
  private readonly client: S3Client;

  constructor(private readonly options: AppConfig["r2"]) {
    this.client = new S3Client({
      region: "auto",
      endpoint: `https://${options.accountId}.r2.cloudflarestorage.com`,
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
}

export function createFileStorage(config: AppConfig): FileStorage {
  if (config.storageDriver === "r2") {
    const { accountId, accessKeyId, secretAccessKey, bucket } = config.r2;
    if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
      throw new Error("STORAGE_DRIVER=r2 cần đủ R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET");
    }
    return new R2FileStorage(config.r2);
  }
  return new LocalFileStorage(path.join(config.dataDir, "files"));
}
