import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError } from "../web/api/api-http.js";
import {
  DRIVE_API_DISABLED_TEXT,
  FOLDER_LINK_INVALID_TEXT,
  FOLDER_NOT_FOUND_TEXT,
  RECONNECT_DRIVE_TEXT,
  describeDriveFailure,
  parseDriveFolderId,
} from "./drive-error-messages.js";

const FOLDER_ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";

test("parses folder ids from Drive URLs and from a bare id", () => {
  assert.equal(parseDriveFolderId(`https://drive.google.com/drive/folders/${FOLDER_ID}`), FOLDER_ID);
  assert.equal(parseDriveFolderId(`https://drive.google.com/drive/folders/${FOLDER_ID}?usp=sharing`), FOLDER_ID);
  assert.equal(parseDriveFolderId(`https://drive.google.com/drive/u/0/folders/${FOLDER_ID}`), FOLDER_ID);
  assert.equal(parseDriveFolderId(`https://drive.google.com/open?id=${FOLDER_ID}`), FOLDER_ID);
  assert.equal(parseDriveFolderId(` ${FOLDER_ID} `), FOLDER_ID);
});

const rejects = (fn: () => unknown, message: string) =>
  assert.throws(fn, (error) => error instanceof ApiError && error.status === 422 && error.message === message);

test("rejects an empty link, a non-Drive link and a malformed bare id", () => {
  rejects(() => parseDriveFolderId(""), "Chưa có link thư mục");
  rejects(() => parseDriveFolderId("   "), "Chưa có link thư mục");
  rejects(() => parseDriveFolderId("https://docs.google.com/document/d/abc/edit"), FOLDER_LINK_INVALID_TEXT);
  rejects(() => parseDriveFolderId("https://drive.google.com/drive/my-drive"), FOLDER_LINK_INVALID_TEXT);
  rejects(() => parseDriveFolderId("abc"), FOLDER_LINK_INVALID_TEXT);
});

test("maps Drive API failures to actionable Vietnamese messages", () => {
  assert.equal(describeDriveFailure(403, { error: { message: "Google Drive API has not been used in project 123", details: [{ reason: "SERVICE_DISABLED" }] } }).message, DRIVE_API_DISABLED_TEXT);
  assert.equal(describeDriveFailure(403, { error: { message: "Google Drive API has not been used in project 123" } }).message, DRIVE_API_DISABLED_TEXT);
  assert.equal(describeDriveFailure(401, { error: { message: "Invalid Credentials" } }).message, RECONNECT_DRIVE_TEXT);
  assert.equal(describeDriveFailure(404, { error: { message: "File not found" } }).message, FOLDER_NOT_FOUND_TEXT);
  assert.equal(describeDriveFailure(403, { error: { message: "The caller does not have permission" } }).message, FOLDER_NOT_FOUND_TEXT);
  assert.match(describeDriveFailure(500, { error: { message: "backend error" } }).message, /Google Drive báo lỗi 500/);
  assert.match(describeDriveFailure(500, null).message, /Google Drive báo lỗi 500/);
});
