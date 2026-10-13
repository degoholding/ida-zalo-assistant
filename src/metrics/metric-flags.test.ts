import assert from "node:assert/strict";
import { test } from "node:test";
import { MetricFlag } from "../constants.js";
import { computeFlags, type FlagInput } from "./metric-flags.js";

const row = (id: number, date: string, value: number | null, baseFlags = 0, groupKey = "a|b|c"): FlagInput => ({ id, groupKey, date, value, baseFlags });

test("negative value", () => assert.equal(computeFlags([row(1, "2026-10-12", -5)]).get(1), MetricFlag.Negative));

test("deviation above 30% versus the previous day with data", () => {
  const flags = computeFlags([row(1, "2026-10-09", 100), row(2, "2026-10-12", 131)]);
  assert.equal(flags.get(1), 0);
  assert.equal(flags.get(2), MetricFlag.Deviation);
  assert.equal(computeFlags([row(1, "2026-10-09", 100), row(2, "2026-10-12", 130)]).get(2), 0); // đúng 30% không vượt ngưỡng
});

test("drop of more than 30% is flagged too", () => {
  assert.equal(computeFlags([row(1, "2026-10-11", 100), row(2, "2026-10-12", 60)]).get(2), MetricFlag.Deviation);
});

test("previous zero is skipped, previous older than 31 days is ignored", () => {
  assert.equal(computeFlags([row(1, "2026-10-10", 0), row(2, "2026-10-12", 50)]).get(2), 0);
  assert.equal(computeFlags([row(1, "2026-08-01", 100), row(2, "2026-10-12", 500)]).get(2), 0);
});

test("unparsed rows keep base flags and do not become the previous value", () => {
  const flags = computeFlags([row(1, "2026-10-10", 100), row(2, "2026-10-11", null, MetricFlag.Unparsed), row(3, "2026-10-12", 200)]);
  assert.equal(flags.get(2), MetricFlag.Unparsed);
  assert.equal(flags.get(3), MetricFlag.Deviation);
});

test("groups are independent and base flags are preserved", () => {
  const flags = computeFlags([row(1, "2026-10-11", 100, MetricFlag.UnknownStaff, "x"), row(2, "2026-10-12", 500, 0, "y")]);
  assert.equal(flags.get(1), MetricFlag.UnknownStaff);
  assert.equal(flags.get(2), 0);
});
