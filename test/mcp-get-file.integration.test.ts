// 27/10/2026 — công cụ MCP get_file đầu-cuối trên MySQL THẬT + cổng /mcp HTTP thật + kho tệp đĩa tạm.
//   Bật MCP_FILE_RAW (cổng /mcp): ảnh trả khối image, PDF trả tệp nhúng, PDF quá trần trả link ký sẵn tải được; lúc tải kiểm lại
//   khóa (thu hồi → 403), phạm vi của tệp (đổi nhóm → 404), chữ ký (sửa → 403), hạn (quá → 403).
//   Tắt MCP_FILE_RAW (cổng /mcp-off; mặc định là BẬT): ảnh / PDF không ra tệp gốc, chỉ chữ đã bóc sẵn (nếu có).
//   Chung: xlsx / txt bóc chữ tại chỗ, cất attachment_text khi CHƯA có (có rồi không đè), ghi âm báo không nghe được, nhóm Mật /
//   ngoài phạm vi bị chặn, tệp chưa có trong kho báo rõ, quá trần tệp / phút → rate_limited.
//
// Chạy: TEST_DATABASE_URL=mysql://root:test@127.0.0.1:3317/bot_tro_ly_test_a4 node --import tsx --test test/mcp-get-file.integration.test.ts

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { RowDataPacket } from "mysql2";
import * as XLSX from "xlsx";
import { createMcpKey, revokeMcpKey } from "../src/auth/mcp-api-key-store.js";
import type { AppConfig } from "../src/config.js";
import { AttachmentStatus, McpAccessLevel, UserRole } from "../src/constants.js";
import { FILES_PER_MINUTE, PDF_INLINE_MAX_BYTES, resetFileQuota } from "../src/data-access/operations/file-get-operation.js";
import { runMigrations } from "../src/db/migrate.js";
import { createPool, type Db } from "../src/db/pool.js";
import { FILE_LINK_TTL_SECONDS, serveMcpFileLink, signFileLink } from "../src/mcp/mcp-file-links.js";
import { createMcpGateway, type McpGateway } from "../src/mcp/mcp-http-handler.js";
import { LocalFileStorage } from "../src/storage/file-storage.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const SECRET = "khoa-ky-thu-nghiem-0123456789abcdef0123456789";
const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const TINY_PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

describe("MCP get_file (MySQL + HTTP thật)", { skip: !databaseUrl && "chưa đặt TEST_DATABASE_URL" }, () => {
  let db: Db;
  let rawGateway: McpGateway;
  let maskedGateway: McpGateway;
  let server: http.Server;
  let base = "";
  let rootDir = "";
  let storage: LocalFileStorage;
  let token = "";
  let keyId = 0;
  const files: Record<string, number> = {};
  const groups: Record<string, number> = {};

  const configWith = (fileRaw: boolean) => ({
    mcp: { enabled: true, allowedHosts: ["127.0.0.1"], rateLimitPerMinute: 1000, maxConcurrentPerKey: 4, maxConcurrent: 3, queueWaitMs: 1000, badKeyLimitPerMinute: 1000, publicUrl: "", fileRaw },
    privacy: { maskPersonalData: true },
    sessionEncryptionKey: SECRET,
  } as unknown as AppConfig);

  before(async () => {
    await runMigrations(databaseUrl!);
    db = createPool(databaseUrl!);
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-get-file-"));
    storage = new LocalFileStorage(rootDir);
    rawGateway = createMcpGateway(db, configWith(true), { storage });
    maskedGateway = createMcpGateway(db, configWith(false), { storage });
    server = http.createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://localhost");
      const run = async () => {
        if (url.pathname === "/mcp") return rawGateway.handle(request, response, "198.51.100.7");
        if (url.pathname === "/mcp-off") return maskedGateway.handle(request, response, "198.51.100.7");
        if (await serveMcpFileLink({ db, storage, secret: SECRET, maskPersonalData: true }, url.pathname, url, request.method ?? "GET", response)) return;
        response.writeHead(404).end();
      };
      run().catch(() => response.destroy());
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(async () => {
    await new Promise((resolve) => server?.close(resolve));
    await rawGateway?.close();
    await maskedGateway?.close();
    await db?.end();
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  const insertId = async (sql: string, params: unknown[]) => Number((await db.query<any>(sql, params))[0].insertId);

  async function addFile(name: string, groupId: number, body: Buffer | null, status = AttachmentStatus.Stored): Promise<number> {
    const messageId = await insertId("INSERT INTO message (group_id, zalo_msg_id, kind, sender_uid, sender_name, sent_at, text) VALUES (?, ?, 0, 'u1', 'Người gửi', NOW(3), '')",
      [groupId, `m-${name}-${Math.random()}`]);
    const ext = name.split(".").pop()!;
    const key = body ? await storage.put(`t/${messageId}-${name}`, body) : null;
    return insertId("INSERT INTO attachment (message_id, group_id, file_name, file_ext, source_url, storage_key, stored_bytes, status) VALUES (?, ?, ?, ?, 'https://f', ?, ?, ?)",
      [messageId, groupId, name, ext, key, body ? body.length : null, status]);
  }

  async function callGetFile(id: number, gatewayPath = "/mcp") {
    const client = new Client({ name: "get-file-it", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}${gatewayPath}`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
    try {
      return await client.callTool({ name: "get_file", arguments: { attachment_id: id } });
    } finally { await client.close(); }
  }

  beforeEach(async () => {
    resetFileQuota();
    await db.query("SET FOREIGN_KEY_CHECKS = 0");
    for (const table of ["attachment_text", "attachment", "message", "zalo_group", "user_group_scope", "mcp_call_log", "app_user"]) await db.query(`TRUNCATE TABLE ${table}`);
    await db.query("DELETE FROM mcp_api_key");
    await db.query("SET FOREIGN_KEY_CHECKS = 1");
    const userId = await insertId("INSERT INTO app_user (username, email, full_name, role, all_groups, is_active) VALUES ('sep', 'sep@ida.vn', 'Sếp', ?, 0, 1)", [UserRole.Manager]);
    groups.ok = await insertId("INSERT INTO zalo_group (thread_type, zalo_group_id, name, read_messages) VALUES (1, 'g-ok', 'Nhóm Kho', 1)", []);
    groups.secret = await insertId("INSERT INTO zalo_group (thread_type, zalo_group_id, name, read_messages, is_confidential) VALUES (1, 'g-mat', 'Nhóm Mật', 1, 1)", []);
    groups.other = await insertId("INSERT INTO zalo_group (thread_type, zalo_group_id, name, read_messages) VALUES (1, 'g-khac', 'Nhóm khác', 1)", []);
    await db.query("INSERT INTO user_group_scope (user_id, group_id) VALUES (?, ?), (?, ?)", [userId, groups.ok, userId, groups.secret]);
    const created = await createMcpKey(db, { userId, name: "k", accessLevel: McpAccessLevel.Read, days: 30, includeConfidential: false });
    token = created.token;
    keyId = created.id;

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Mặt hàng", "Số lượng"], ["Phân bón NPK", 120]]), "Kho");
    files.png = await addFile("anh.png", groups.ok, PNG_1X1);
    files.pdf = await addFile("baogia.pdf", groups.ok, TINY_PDF);
    files.bigPdf = await addFile("lon.pdf", groups.ok, Buffer.concat([TINY_PDF, Buffer.alloc(PDF_INLINE_MAX_BYTES + 10, 32)]));
    files.xlsx = await addFile("ton-kho.xlsx", groups.ok, XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer);
    files.txt = await addFile("ghi-chu.txt", groups.ok, Buffer.from("﻿Dòng một\nDòng hai, gọi 0912345678", "utf8"));
    files.mp3 = await addFile("hop.mp3", groups.ok, Buffer.from("ID3fake"));
    await db.query("INSERT INTO attachment_text (attachment_id, method, char_count, summary, text) VALUES (?, 'gemini', 9, 'gỡ băng', 'Gỡ băng.')", [files.mp3]);
    files.skipped = await addFile("bo-qua.jpg", groups.ok, null, AttachmentStatus.Skipped);
    files.secret = await addFile("mat.png", groups.secret, PNG_1X1);
    files.other = await addFile("khac.png", groups.other, PNG_1X1);
  });

  const structured = (result: any) => result.structuredContent as Record<string, any>;

  test("bật tệp gốc: ảnh → khối image base64 đúng mime; PDF nhỏ → tệp nhúng application/pdf", async () => {
    const image = await callGetFile(files.png) as any;
    assert.ok(!image.isError, JSON.stringify(image));
    const block = image.content.find((item: any) => item.type === "image");
    assert.equal(block.mimeType, "image/png");
    assert.deepEqual(Buffer.from(block.data, "base64"), PNG_1X1);
    assert.equal(structured(image).delivered, "image");

    const pdf = await callGetFile(files.pdf) as any;
    const resource = pdf.content.find((item: any) => item.type === "resource");
    assert.equal(resource.resource.mimeType, "application/pdf");
    assert.deepEqual(Buffer.from(resource.resource.blob, "base64"), TINY_PDF);
  });

  test("TẮT tệp gốc (MCP_FILE_RAW=false): ảnh / PDF không ra tệp gốc, không link; có chữ bóc sẵn thì trả chữ đã che", async () => {
    const image = await callGetFile(files.png, "/mcp-off") as any;
    assert.ok(!image.isError);
    assert.ok(!image.content.some((item: any) => item.type !== "text"), "không khối image");
    assert.deepEqual([structured(image).status, structured(image).download_url], ["not_extracted", null]);
    assert.match(structured(image).notices.join(" "), /MCP_FILE_RAW/);
    await db.query("INSERT INTO attachment_text (attachment_id, method, char_count, summary, text) VALUES (?, 'gemini', 30, 'ảnh', 'Hóa đơn, SĐT 0912345678')", [files.pdf]);
    const pdf = await callGetFile(files.pdf, "/mcp-off") as any;
    assert.ok(!pdf.content.some((item: any) => item.type === "resource"));
    assert.equal(structured(pdf).delivered, "text");
    assert.ok(!structured(pdf).text.includes("0912345678"), "chữ trả về đã che SĐT");
    const big = structured(await callGetFile(files.bigPdf, "/mcp-off"));
    assert.equal(big.download_url, null);
  });

  test("xlsx / txt bóc chữ tại chỗ (đã che SĐT), cất attachment_text khi chưa có; có rồi thì không đè", async () => {
    const sheet = structured(await callGetFile(files.xlsx, "/mcp-off"));
    assert.equal(sheet.delivered, "text");
    assert.match(sheet.text, /Phân bón NPK/);
    const text = structured(await callGetFile(files.txt, "/mcp-off"));
    assert.match(text.text, /^Dòng một\nDòng hai/, "bỏ BOM đầu tệp");
    assert.ok(!text.text.includes("0912345678"));
    const [rows] = await db.query<RowDataPacket[]>("SELECT method FROM attachment_text WHERE attachment_id IN (?, ?) ORDER BY attachment_id", [files.xlsx, files.txt]);
    assert.deepEqual(rows.map((row) => row.method), ["xlsx", "text"]);

    await db.query("UPDATE attachment_text SET method = 'gemini', text = 'Bản đọc cũ' WHERE attachment_id = ?", [files.xlsx]);
    assert.equal(structured(await callGetFile(files.xlsx)).text, "Bản đọc cũ");
    const [kept] = await db.query<RowDataPacket[]>("SELECT method, text FROM attachment_text WHERE attachment_id = ?", [files.xlsx]);
    assert.deepEqual([kept[0].method, kept[0].text], ["gemini", "Bản đọc cũ"]);
  });

  test("PDF quá trần → link ký sẵn tải đúng tệp; sửa chữ ký / quá hạn → 403; khóa thu hồi → 403; tệp đổi sang nhóm ngoài phạm vi → 404", async () => {
    const big = structured(await callGetFile(files.bigPdf));
    assert.deepEqual([big.status, big.delivered], ["link", "link"]);
    assert.ok(big.download_url.startsWith(`${base}/mcp-files/${files.bigPdf}?`));
    const download = await fetch(big.download_url);
    assert.equal(download.status, 200);
    assert.equal((await download.arrayBuffer()).byteLength, PDF_INLINE_MAX_BYTES + 10 + TINY_PDF.length);
    assert.equal((await fetch(big.download_url.replace(/s=.{4}/, "s=AAAA"))).status, 403);
    assert.equal((await fetch(big.download_url.replace(/s=[^&]+/, "s=ngan"))).status, 403, "chữ ký sai độ dài không làm sập (500)");
    const expired = signFileLink(base, files.bigPdf, keyId, SECRET, Date.now() - (FILE_LINK_TTL_SECONDS + 5) * 1000);
    assert.equal((await fetch(expired)).status, 403);

    await db.query("UPDATE attachment SET group_id = ? WHERE id = ?", [groups.other, files.bigPdf]);
    await db.query("UPDATE message m JOIN attachment a ON a.message_id = m.id SET m.group_id = ? WHERE a.id = ?", [groups.other, files.bigPdf]);
    assert.equal((await fetch(big.download_url)).status, 404, "lúc tải kiểm lại phạm vi của tệp");

    const pdfLink = signFileLink(base, files.pdf, keyId, SECRET);
    assert.equal((await fetch(pdfLink)).status, 200);
    await revokeMcpKey(db, keyId, "test");
    assert.equal((await fetch(pdfLink)).status, 403);
  });

  test("ghi âm: báo không nghe được và chỉ sang get_file_text; tệp chưa có trong kho báo rõ", async () => {
    const audio = structured(await callGetFile(files.mp3));
    assert.equal(audio.status, "unsupported");
    assert.match(audio.notices.join(" "), /get_file_text/);
    const skipped = structured(await callGetFile(files.skipped));
    assert.equal(skipped.status, "not_stored");
    assert.match(skipped.notices.join(" "), /Lấy file/);
  });

  test("nhóm Mật (khóa không cờ Mật) và nhóm ngoài phạm vi → bị chặn, không lộ tệp", async () => {
    for (const id of [files.secret, files.other]) {
      const result = await callGetFile(id) as any;
      assert.equal(result.isError, true);
      assert.ok(!result.content.some((item: any) => item.type === "image"));
    }
  });

  test(`quá ${FILES_PER_MINUTE} tệp / phút → rate_limited`, async () => {
    for (let index = 0; index < FILES_PER_MINUTE; index += 1) assert.ok(!(await callGetFile(files.skipped) as any).isError);
    const limited = await callGetFile(files.skipped) as any;
    assert.equal(limited.isError, true);
    assert.match(JSON.stringify(limited.content), /rate_limited/);
  });
});
