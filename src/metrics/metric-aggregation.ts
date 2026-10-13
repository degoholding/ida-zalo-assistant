import { foldText } from "../alerts/keyword-matcher.js";
import { MetricFlag } from "../constants.js";
import type { MetricAggregate } from "./metric-types.js";

// Phần THUẦN của truy vấn số liệu: khớp tên chỉ tiêu và gom dòng thành bảng tổng hợp. Truy vấn DB ở metric-query-service.ts.

export interface MetricCatalogItem {
  code: string;
  label: string;
  unit: string;
  aggregate: MetricAggregate;
  sourceId: number;
  sourceName: string;
  lastOkAt: Date | null;
}

/** Mã chỉ tiêu nào được nhắc trong câu: khớp nguyên cụm tên hoặc mã (gấp dấu, «ton_kho» ≈ «ton kho»). */
export function resolveMetricCodes(catalog: MetricCatalogItem[], text: string): string[] {
  const haystack = foldText(text);
  const found = new Set<string>();
  for (const item of catalog) {
    for (const name of [item.label, item.code.replace(/_/g, " ")]) {
      const folded = foldText(name);
      if (folded.trim() && haystack.includes(folded)) found.add(item.code);
    }
  }
  return [...found];
}

export type MetricGroupBy = "staff" | "area" | "metric" | "date";

export interface MetricFact {
  date: string;
  staffKey: string;
  staffName: string;
  areaKey: string;
  areaName: string;
  code: string;
  value: number | null;
  flags: number;
}

export interface MetricAggregateRow {
  key: string;
  label: string;
  value: number;
  previous: number | null;
  changePct: number | null;
  flagged: boolean;
}

export interface MetricAggregateResult {
  rows: MetricAggregateRow[];
  total: number;
  previousTotal: number;
}

/** Giá trị một ô (nhân viên, khu vực, chỉ tiêu) trong kỳ: sum → cộng; last → số của ngày cuối có số. */
function cellValues(facts: MetricFact[], aggregates: Map<string, MetricAggregate>): { fact: MetricFact; value: number }[] {
  const cells = new Map<string, { fact: MetricFact; value: number; lastDate: string }>();
  for (const fact of facts) {
    if (fact.value === null) continue;
    const key = [fact.staffKey, fact.areaKey, fact.code].join("\u0000");
    const cell = cells.get(key);
    if (!cell) {
      cells.set(key, { fact, value: fact.value, lastDate: fact.date });
    } else if ((aggregates.get(fact.code) ?? "sum") === "last") {
      if (fact.date >= cell.lastDate) { cell.value = fact.value; cell.lastDate = fact.date; cell.fact = fact; }
    } else {
      cell.value += fact.value;
    }
  }
  return [...cells.values()];
}

function groupOf(fact: MetricFact, groupBy: MetricGroupBy, labels: Map<string, string>): { key: string; label: string } {
  switch (groupBy) {
    case "staff": return { key: fact.staffKey, label: fact.staffName || fact.staffKey };
    case "area": return { key: fact.areaKey, label: fact.areaName || "(không rõ khu vực)" };
    case "metric": return { key: fact.code, label: labels.get(fact.code) ?? fact.code };
    case "date": return { key: fact.date, label: fact.date };
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Gộp dòng kỳ này + kỳ trước thành bảng. Với «date», mỗi ngày một dòng (sum/last chỉ khác khi nhiều dòng một ngày) và
 * không có kỳ trước theo dòng. `total` = tổng các dòng — chỉ có nghĩa khi lọc một chỉ tiêu.
 */
export function rollupFacts(
  current: MetricFact[], previous: MetricFact[], aggregates: Map<string, MetricAggregate>, groupBy: MetricGroupBy, labels: Map<string, string> = new Map(),
): MetricAggregateResult {
  const sumBy = (facts: MetricFact[], byDate: boolean) => {
    const totals = new Map<string, { label: string; value: number; flagged: boolean }>();
    const source = byDate ? facts : cellValues(facts, aggregates).map(({ fact, value }) => ({ ...fact, value }));
    for (const fact of source) {
      if (fact.value === null) continue;
      const group = groupOf(fact, groupBy, labels);
      const entry = totals.get(group.key) ?? { label: group.label, value: 0, flagged: false };
      entry.value += fact.value;
      entry.flagged ||= (fact.flags & (MetricFlag.Negative | MetricFlag.Deviation | MetricFlag.Unparsed | MetricFlag.UnknownStaff)) !== 0;
      totals.set(group.key, entry);
    }
    return totals;
  };
  const byDate = groupBy === "date";
  const now = sumBy(current, byDate);
  const before = byDate ? new Map<string, { value: number }>() : sumBy(previous, false);
  const rows: MetricAggregateRow[] = [...now.entries()].map(([key, entry]) => {
    const prior = before.get(key)?.value ?? null;
    return {
      key, label: entry.label, value: round2(entry.value), previous: prior === null ? null : round2(prior),
      changePct: prior === null || prior === 0 ? null : Math.round(((entry.value - prior) / Math.abs(prior)) * 1000) / 10,
      flagged: entry.flagged,
    };
  });
  rows.sort(byDate ? (a, b) => a.key.localeCompare(b.key) : (a, b) => b.value - a.value);
  const sum = (items: Iterable<{ value: number }>) => round2([...items].reduce((acc, item) => acc + item.value, 0));
  return { rows, total: sum(now.values()), previousTotal: byDate ? 0 : sum(before.values()) };
}
