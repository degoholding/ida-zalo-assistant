// Phase 10 phase 6 — nạp danh mục NV / ĐL trên MySQL THẬT: nạp 2 lần không nhân mục, sửa khu vực thì cập nhật, mục Confirmed
// giữ liên hệ, xác nhận (409 khi liên hệ đã gắn mục khác, điền SĐT), bỏ gắn, khớp lại, ListSpec lọc khu vực + Danh bạ JOIN.
//
// Chạy: TEST_DATABASE_URL=mysql://root:<mật khẩu>@127.0.0.1:3308/<csdl_thử> npm test

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import * as XLSX from "xlsx";
import { importCatalog } from "../src/catalog/catalog-import-service.js";
import { confirmMatch, rematchAll, unlinkMatch } from "../src/catalog/catalog-match-actions.js";
import { CatalogMatchStatus, ContactKind } from "../src/constants.js";
import { runMigrations } from "../src/db/migrate.js";
import { createPool, type Db } from "../src/db/pool.js";
import { getCatalogDetail, listCatalog } from "../src/web/api/catalog-api.js";
import { getContactDetail, listContacts } from "../src/web/api/contacts-api.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

function workbook(huyRegion: string, huyPhone = "0912345678"): Buffer {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ["Mã NV*", "Họ tên*", "SĐT", "Khu vực*", "Vùng sales", "Mã người quản lý"],
    ["NV001", "Huy", huyPhone, huyRegion, "Cần Thơ", ""],
    ["NV002", "Tâm", "", "Đông Nam Bộ", "Đồng Nai", "NV001"],
    ["NV003", "Minh", "", "Miền Tây", "", ""],
  ]), "NhanVien");
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ["Mã ĐL*", "Tên đại lý*", "Khu vực*", "Mã NV phụ trách*"],
    ["DL001", "ĐL Thành Công", "Miền Tây", "NV001"],
    ["DL002", "ĐL Hòa Bình", "Miền Tây", ""],
  ]), "DaiLy");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

describe("phase 10 — nạp danh mục NV / ĐL", { skip: !databaseUrl && "chưa đặt TEST_DATABASE_URL" }, () => {
  let db: Db;
  const ids: Record<string, number> = {};

  async function addContact(uid: string, name: string, kind: ContactKind, phone: string | null = null): Promise<number> {
    const [result] = await db.query<ResultSetHeader>("INSERT INTO contact (zalo_uid, zalo_name, kind, phone) VALUES (?, ?, ?, ?)", [uid, name, kind, phone]);
    return result.insertId;
  }
  async function entryId(code: string): Promise<number> {
    const [rows] = await db.query<RowDataPacket[]>("SELECT id FROM catalog_entry WHERE code = ?", [code]);
    return Number(rows[0].id);
  }

  before(async () => {
    await runMigrations(databaseUrl!);
    db = createPool(databaseUrl!);
  });
  after(async () => { await db?.end(); });
  beforeEach(async () => {
    await db.query("DELETE FROM catalog_entry");
    await db.query("DELETE FROM contact WHERE zalo_uid LIKE 'ct-%'");
    ids.huy = await addContact("ct-huy", "Huy", ContactKind.Staff, "0912345678");
    ids.tam1 = await addContact("ct-tam1", "Tâm", ContactKind.Staff);
    ids.tam2 = await addContact("ct-tam2", "Tâm", ContactKind.Staff);
    ids.tc = await addContact("ct-tc", "Thành Công", ContactKind.Customer);
  });

  test("nạp lần 1: tạo mục, giải người phụ trách, khớp SĐT / tên / mơ hồ / không có", async () => {
    const summary = await importCatalog(db, workbook("Miền Tây"));
    assert.deepEqual({ created: summary.created, updated: summary.updated, errors: summary.errors.length }, { created: 4, updated: 0, errors: 1 });
    assert.deepEqual([summary.matched, summary.suggested, summary.unmatched], [2, 1, 1]);
    const huy = await getCatalogDetail(db, await entryId("NV001"));
    assert.equal(huy.match_status, CatalogMatchStatus.Matched);
    assert.equal(huy.contact_id, ids.huy);
    const tam = await getCatalogDetail(db, await entryId("NV002"));
    assert.equal(tam.match_status, CatalogMatchStatus.Suggested);
    assert.equal((tam.candidates as unknown[]).length, 2);
    assert.equal(tam.owner_name, "Huy");
    const dealer = await getCatalogDetail(db, await entryId("DL001"));
    assert.equal(dealer.match_status, CatalogMatchStatus.Matched);
    assert.equal(dealer.owner_name, "Huy");
  });

  test("nạp lần 2: không nhân mục, sửa khu vực thì cập nhật, mục Confirmed giữ liên hệ", async () => {
    await importCatalog(db, workbook("Miền Tây"));
    const tamId = await entryId("NV002");
    await confirmMatch(db, tamId, ids.tam2);
    const second = await importCatalog(db, workbook("Miền Đông"));
    assert.equal(second.created, 0);
    const [count] = await db.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM catalog_entry");
    assert.equal(Number(count[0].n), 4);
    const tam = await getCatalogDetail(db, tamId);
    assert.equal(tam.match_status, CatalogMatchStatus.Confirmed);
    assert.equal(tam.contact_id, ids.tam2);
    const list = await listCatalog(db, new URLSearchParams("region__eq=Miền Đông"));
    assert.equal(list.total, 1);
  });

  test("xác nhận: liên hệ đã gắn mục khác → 409; điền SĐT khi trống; bỏ gắn; khớp lại không đụng mục Confirmed", async () => {
    await importCatalog(db, workbook("Miền Tây"));
    const tamId = await entryId("NV002");
    const minhId = await entryId("NV003");
    await db.query("UPDATE catalog_entry SET phone = '0987000111' WHERE id = ?", [tamId]);
    await confirmMatch(db, tamId, ids.tam1);
    const [phone] = await db.query<RowDataPacket[]>("SELECT phone FROM contact WHERE id = ?", [ids.tam1]);
    assert.equal(phone[0].phone, "0987000111");
    await assert.rejects(confirmMatch(db, minhId, ids.tam1), (error: { status?: number }) => error.status === 409);
    await rematchAll(db);
    assert.equal((await getCatalogDetail(db, tamId)).contact_id, ids.tam1);
    await unlinkMatch(db, tamId);
    assert.equal((await getCatalogDetail(db, tamId)).match_status, CatalogMatchStatus.Unlinked);
    await assert.rejects(unlinkMatch(db, tamId), (error: { status?: number }) => error.status === 409);
  });

  test("review phase 10: «Bỏ gắn» giữ nguyên qua khớp lại / nạp lại cùng SĐT; ứng viên còn liên hệ vừa bỏ; nạp SĐT khác thì khớp lại", async () => {
    await importCatalog(db, workbook("Miền Tây"));
    const huyId = await entryId("NV001");
    assert.equal((await getCatalogDetail(db, huyId)).contact_id, ids.huy);
    await unlinkMatch(db, huyId);
    await rematchAll(db);
    await importCatalog(db, workbook("Miền Tây"));
    const detail = await getCatalogDetail(db, huyId);
    assert.equal(detail.match_status, CatalogMatchStatus.Unlinked);
    assert.equal(detail.contact_id, null);
    assert.ok((detail.candidates as { contact_id: number }[]).some((item) => item.contact_id === ids.huy));
    // Quản trị gắn tay lại được
    await confirmMatch(db, huyId, ids.huy);
    assert.equal((await getCatalogDetail(db, huyId)).match_status, CatalogMatchStatus.Confirmed);
    // Bỏ gắn lần nữa rồi nạp tệp có SĐT KHÁC → về khớp tự động
    await unlinkMatch(db, huyId);
    await importCatalog(db, workbook("Miền Tây", "0912000000"));
    assert.notEqual((await getCatalogDetail(db, huyId)).match_status, CatalogMatchStatus.Unlinked);
  });

  test("Danh bạ: JOIN cho khu vực / vùng / người phụ trách, lọc theo khu vực, SĐT ẩn khi không có quyền danh mục", async () => {
    await importCatalog(db, workbook("Miền Tây"));
    const params = new URLSearchParams("q=Thành Công");
    const result = await listContacts(db, params);
    const row = result.items[0] as Record<string, unknown>;
    assert.equal(row.catalog_code, "DL001");
    assert.equal(row.region, "Miền Tây");
    assert.equal(row.owner_name, "Huy");
    assert.equal((await listContacts(db, new URLSearchParams("region__eq=Miền Tây&catalog_kind=2"))).total, 1);
    const detail = await getContactDetail(db, ids.huy, false);
    assert.equal("phone" in detail, false);
    assert.equal((await getContactDetail(db, ids.huy)).phone, "0912345678");
  });
});
