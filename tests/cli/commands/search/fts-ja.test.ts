// T025 / ADR-0012: 日本語クエリ + mixed + LIKE fallback の単体テスト。
// fts.test.ts (英語ベース) と意図して分離: 障害切り分けと grep の容易さのため。
import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it, test } from "bun:test";
import { searchFts } from "../../../../src/cli/commands/search/fts.ts";
import * as messagesDao from "../../../../src/storage/dao/messages.ts";
import { openDatabase } from "../../../../src/storage/db.ts";
import type { MessageUpsertInput } from "../../../../src/storage/types.ts";

function seed(
  db: Database,
  overrides: Partial<MessageUpsertInput> & { text: string; ts: string },
): void {
  const row: MessageUpsertInput = {
    team_id: "T1",
    channel_id: "C1",
    thread_ts: null,
    user_id: "U1",
    type: "message",
    subtype: null,
    edited_ts: null,
    raw_json: "{}",
    fetched_at: 1700000000,
    ...overrides,
  };
  messagesDao.upsert(db, row);
}

describe("searchFts (Japanese / trigram)", () => {
  let db: Database;
  beforeEach(() => {
    db = openDatabase({ path: ":memory:" });
  });
  afterEach(() => {
    db.close();
  });

  test("(ja-1) カタカナ部分文字列: リマインド", () => {
    seed(db, { ts: "1700000001.000000", text: "リマインドします" });
    seed(db, { ts: "1700000002.000000", text: "明日のリマインドです" });
    seed(db, { ts: "1700000003.000000", text: "おはようございます" });
    const rows = searchFts({
      db,
      team_id: "T1",
      query: "リマインド",
      channel_id: null,
      user_id: null,
      limit: 10,
    });
    expect(rows.length).toBe(2);
    const texts = rows.map((r) => r.text).sort();
    expect(texts).toEqual(["明日のリマインドです", "リマインドします"].sort());
  });

  test("(ja-2) 漢字+ひらがな混在: 集う会", () => {
    seed(db, { ts: "1700000001.000000", text: "集う会の予定" });
    seed(db, { ts: "1700000002.000000", text: "集う会の幹事" });
    seed(db, { ts: "1700000003.000000", text: "全く無関係な投稿" });
    const rows = searchFts({
      db,
      team_id: "T1",
      query: "集う会",
      channel_id: null,
      user_id: null,
      limit: 10,
    });
    expect(rows.length).toBe(2);
    const texts = rows.map((r) => r.text).sort();
    expect(texts).toEqual(["集う会の予定", "集う会の幹事"].sort());
  });

  test("(ja-3) 漢字 3 文字 (複合語の中の部分一致): 宿泊費", () => {
    seed(db, { ts: "1700000001.000000", text: "宿泊費の精算をお願いします" });
    seed(db, { ts: "1700000002.000000", text: "宿泊費を立替えました" });
    seed(db, { ts: "1700000003.000000", text: "交通費の話" });
    const rows = searchFts({
      db,
      team_id: "T1",
      query: "宿泊費",
      channel_id: null,
      user_id: null,
      limit: 10,
    });
    expect(rows.length).toBe(2);
    for (const r of rows) {
      expect(r.text ?? "").toContain("宿泊費");
    }
  });

  test("(ja-4) ASCII 略語 case-insensitive: KDG / kdg", () => {
    seed(db, { ts: "1700000001.000000", text: "KDGミーティング" });
    seed(db, { ts: "1700000002.000000", text: "kdg定例" });
    seed(db, { ts: "1700000003.000000", text: "別の話題です" });
    const rows = searchFts({
      db,
      team_id: "T1",
      query: "KDG",
      channel_id: null,
      user_id: null,
      limit: 10,
    });
    expect(rows.length).toBe(2);
  });

  test("(ja-5) ひらがな + 送り仮名: 打ち合わせ", () => {
    seed(db, { ts: "1700000001.000000", text: "明日打ち合わせ" });
    seed(db, { ts: "1700000002.000000", text: "打ち合わせ予定です" });
    seed(db, { ts: "1700000003.000000", text: "スポーツ観戦" });
    const rows = searchFts({
      db,
      team_id: "T1",
      query: "打ち合わせ",
      channel_id: null,
      user_id: null,
      limit: 10,
    });
    expect(rows.length).toBe(2);
    for (const r of rows) {
      expect(r.text ?? "").toContain("打ち合わせ");
    }
  });

  test("(mix-1) 連続 ASCII + CJK 'KDGミーティング' が hit", () => {
    seed(db, { ts: "1700000001.000000", text: "KDGミーティング 議事録" });
    seed(db, { ts: "1700000002.000000", text: "KDG 議事録 (separated)" });
    seed(db, { ts: "1700000003.000000", text: "別の話題" });
    const rows = searchFts({
      db,
      team_id: "T1",
      query: "KDGミーティング",
      channel_id: null,
      user_id: null,
      limit: 10,
    });
    expect(rows.length).toBe(1);
    expect(rows[0]?.text).toBe("KDGミーティング 議事録");
  });

  // mix-2: スペース挟みのフレーズ ('meeting 議事') は trigram phrase MATCH では
  // 連続 3-gram が空白を跨いで生成されない (`g 議` ` 議事` 等が hit しない実装も多い)
  // ため、現挙動の固定 assert は脆い。本タスクの非ゴールであることを文章で残す。
  // 詳細は ADR-0012 を参照し、fallback 戦略 (AND 化、CJK 区切りでの自動分割など) は
  // 別タスクで再検討する。
  it.skip("(mix-2) documents non-goal: phrase across whitespace, see ADR-0012", () => {
    // 意図的に空。挙動を assert で凍結しないために skip で残す。
  });

  test("(ja-deleted) deleted=1 行は除外される", () => {
    seed(db, { ts: "1700000001.000000", text: "リマインドします" });
    seed(db, { ts: "1700000002.000000", text: "リマインドを削除予定" });
    messagesDao.markDeleted(db, "T1", "C1", "1700000002.000000");
    const rows = searchFts({
      db,
      team_id: "T1",
      query: "リマインド",
      channel_id: null,
      user_id: null,
      limit: 10,
    });
    expect(rows.length).toBe(1);
    expect(rows[0]?.text).toBe("リマインドします");
  });
});

describe("searchFts (LIKE fallback for queries shorter than trigram boundary)", () => {
  let db: Database;
  beforeEach(() => {
    db = openDatabase({ path: ":memory:" });
  });
  afterEach(() => {
    db.close();
  });

  test("(lk-1) 2 文字 ASCII 'OR' は LIKE fallback で hit", () => {
    seed(db, { ts: "1700000001.000000", text: "we use OR for fallback" });
    seed(db, { ts: "1700000002.000000", text: "no match" });
    const rows = searchFts({
      db,
      team_id: "T1",
      query: "OR",
      channel_id: null,
      user_id: null,
      limit: 10,
    });
    expect(rows.length).toBe(1);
    expect(rows[0]?.text).toContain("OR");
  });

  test("(lk-2) 1 文字日本語 'あ' は LIKE で広く hit", () => {
    seed(db, { ts: "1700000001.000000", text: "あいうえお" });
    seed(db, { ts: "1700000002.000000", text: "ありがとう" });
    seed(db, { ts: "1700000003.000000", text: "おやすみ" });
    const rows = searchFts({
      db,
      team_id: "T1",
      query: "あ",
      channel_id: null,
      user_id: null,
      limit: 10,
    });
    expect(rows.length).toBe(2);
    const texts = rows.map((r) => r.text).sort();
    expect(texts).toEqual(["あいうえお", "ありがとう"].sort());
  });

  test("(lk-3) LIKE のメタ文字 '%' は ESCAPE で literal 扱い", () => {
    seed(db, { ts: "1700000001.000000", text: "達成率 100% です" });
    seed(db, { ts: "1700000002.000000", text: "100 ABC で別" });
    const rows = searchFts({
      db,
      team_id: "T1",
      query: "0%",
      channel_id: null,
      user_id: null,
      limit: 10,
    });
    expect(rows.length).toBe(1);
    expect(rows[0]?.text).toContain("100%");
  });

  test("(lk-4) LIKE のメタ文字 '_' は ESCAPE で literal 扱い", () => {
    seed(db, { ts: "1700000001.000000", text: "a_b done" });
    seed(db, { ts: "1700000002.000000", text: "acb done" });
    seed(db, { ts: "1700000003.000000", text: "axb done" });
    const rows = searchFts({
      db,
      team_id: "T1",
      query: "a_b",
      channel_id: null,
      user_id: null,
      limit: 10,
    });
    expect(rows.length).toBe(1);
    expect(rows[0]?.text).toBe("a_b done");
  });

  test("(lk-5) ASCII 大文字小文字無関係 (LIKE fallback)", () => {
    seed(db, { ts: "1700000001.000000", text: "OR fallback path" });
    seed(db, { ts: "1700000002.000000", text: "or lower" });
    const rows = searchFts({
      db,
      team_id: "T1",
      query: "Or",
      channel_id: null,
      user_id: null,
      limit: 10,
    });
    expect(rows.length).toBe(2);
  });

  test("(lk-deleted) LIKE fallback でも deleted=1 行は除外", () => {
    seed(db, { ts: "1700000001.000000", text: "OR alive" });
    seed(db, { ts: "1700000002.000000", text: "OR removed" });
    messagesDao.markDeleted(db, "T1", "C1", "1700000002.000000");
    const rows = searchFts({
      db,
      team_id: "T1",
      query: "OR",
      channel_id: null,
      user_id: null,
      limit: 10,
    });
    expect(rows.length).toBe(1);
    expect(rows[0]?.text).toBe("OR alive");
  });

  test("(lk-filters) LIKE fallback でも channel_id / user_id filter が効く", () => {
    seed(db, { ts: "1700000001.000000", channel_id: "C1", user_id: "U1", text: "OR cu" });
    seed(db, {
      ts: "1700000002.000000",
      channel_id: "C2",
      user_id: "U1",
      text: "OR other channel",
    });
    seed(db, { ts: "1700000003.000000", channel_id: "C1", user_id: "U2", text: "OR other user" });
    const rows = searchFts({
      db,
      team_id: "T1",
      query: "OR",
      channel_id: "C1",
      user_id: "U1",
      limit: 10,
    });
    expect(rows.length).toBe(1);
    expect(rows[0]?.text).toBe("OR cu");
  });

  test("(lk-empty) 空文字クエリは [] を返す (LIKE fallback の `%` パターン暴発を防ぐ)", () => {
    seed(db, { ts: "1700000001.000000", text: "anything" });
    const rows = searchFts({
      db,
      team_id: "T1",
      query: "",
      channel_id: null,
      user_id: null,
      limit: 10,
    });
    expect(rows.length).toBe(0);
  });

  test("(lk-order) LIKE fallback は ts DESC 順", () => {
    seed(db, { ts: "1700000001.000000", text: "OR oldest" });
    seed(db, { ts: "1700000003.000000", text: "OR newest" });
    seed(db, { ts: "1700000002.000000", text: "OR middle" });
    const rows = searchFts({
      db,
      team_id: "T1",
      query: "OR",
      channel_id: null,
      user_id: null,
      limit: 10,
    });
    expect(rows.length).toBe(3);
    expect(rows[0]?.text).toBe("OR newest");
    expect(rows[2]?.text).toBe("OR oldest");
  });
});
