import { Router, type Request, type Response } from 'express';
import type Database from 'better-sqlite3';
import {
  DEFAULT_ABSENCE_KEYWORDS,
  parseAbsenceKeywords,
  normalizeKeywordList,
  getTodayJST,
} from '@household-tasks/shared';
import { getDb } from '../db.js';
import { getNowISO } from '../test-time.js';
import { broadcast } from './kanban.js';

const router: ReturnType<typeof Router> = Router();

const KEYWORDS_KEY = 'absence_keywords';

export type AbsenceDayRow = {
  date: string;
  summary: string | null;
  source: string;
};

export function readAbsenceKeywords(db: Database.Database): string[] {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(KEYWORDS_KEY) as
    | { value: string }
    | undefined;
  return parseAbsenceKeywords(row?.value);
}

/**
 * 指定日が不在日なら行を返す。カンバン・スケジューラの判定はすべてここを通す。
 */
export function findAbsenceDay(db: Database.Database, date: string): AbsenceDayRow | null {
  const row = db.prepare('SELECT date, summary, source FROM absence_days WHERE date = ?').get(date) as
    | AbsenceDayRow
    | undefined;
  return row ?? null;
}

/** 今日が不在日か（カンバンの絞り込み用） */
export function isAbsentToday(db: Database.Database): AbsenceDayRow | null {
  return findAbsenceDay(db, getTodayJST());
}

// GET /api/absence — キーワード・今日の不在判定・登録済みの不在日
router.get('/', (_req: Request, res: Response) => {
  const db = getDb();
  const today = getTodayJST();

  // 過去の不在日は消さずに残す（履歴として意味がある）が、一覧は今日以降だけ返す
  const days = db.prepare(
    'SELECT date, summary, source FROM absence_days WHERE date >= ? ORDER BY date ASC'
  ).all(today) as AbsenceDayRow[];

  const hiddenCount = db.prepare(
    "SELECT COUNT(*) as c FROM task_definitions WHERE is_active = 1 AND absence_behavior = 'hidden'"
  ).get() as { c: number };

  res.json({
    keywords: readAbsenceKeywords(db),
    defaultKeywords: DEFAULT_ABSENCE_KEYWORDS,
    today: findAbsenceDay(db, today),
    days,
    hiddenTaskCount: hiddenCount.c,
  });
});

// PUT /api/absence/keywords — 不在判定に使うキーワードを保存
router.put('/keywords', (req: Request, res: Response) => {
  const { keywords } = req.body ?? {};

  if (!Array.isArray(keywords)) {
    res.status(400).json({ error: 'keywords must be an array of strings' });
    return;
  }

  const normalized = normalizeKeywordList(keywords);

  const db = getDb();
  db.prepare(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(KEYWORDS_KEY, JSON.stringify(normalized), getNowISO());

  // キーワードを変えても既存の不在日は入れ替わらない（次回の同期で反映される）。
  // 手で消したいときは DELETE /api/absence/days/:date を使う。
  res.json({ keywords: normalized });
});

/**
 * POST /api/absence/days — 不在日を入れ替える（Home Assistant の同期用）。
 *
 * `source: 'calendar'` の行を**全て置き換える**冪等な操作。差分更新にしないのは、
 * カレンダーから予定が消えた（旅行が中止になった）ときに不在日が残り続けるのを防ぐため。
 * 手動で足した日（source='manual'）は触らない。
 */
router.post('/days', (req: Request, res: Response) => {
  const { days, source } = req.body ?? {};

  if (!Array.isArray(days)) {
    res.status(400).json({ error: 'days must be an array' });
    return;
  }

  const src = typeof source === 'string' && source === 'manual' ? 'manual' : 'calendar';
  const now = getNowISO();

  type Incoming = { date: string; summary: string | null };
  const parsed: Incoming[] = [];
  for (const entry of days) {
    const date = typeof entry === 'string' ? entry : entry?.date;
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ error: `invalid date: ${JSON.stringify(entry)}` });
      return;
    }
    const summary =
      typeof entry === 'object' && entry !== null && typeof entry.summary === 'string'
        ? entry.summary
        : null;
    parsed.push({ date, summary });
  }

  const db = getDb();
  const before = isAbsentToday(db);

  const replace = db.transaction(() => {
    db.prepare('DELETE FROM absence_days WHERE source = ?').run(src);
    const insert = db.prepare(`
      INSERT INTO absence_days (date, summary, source, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(date) DO UPDATE SET
        summary = excluded.summary,
        source = excluded.source,
        updated_at = excluded.updated_at
    `);
    for (const day of parsed) {
      insert.run(day.date, day.summary, src, now);
    }
  });
  replace();

  const after = isAbsentToday(db);

  // 今日の不在状態が変わったらカンバンの見た目が変わるので通知する
  if ((before?.date ?? null) !== (after?.date ?? null)) {
    broadcast({ type: 'absence_changed', today: after });
  }

  res.json({ saved: parsed.length, source: src, today: after });
});

// DELETE /api/absence/days/:date — 不在日を1日ぶん取り消す
router.delete('/days/:date', (req: Request, res: Response) => {
  const date = String(req.params.date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ error: 'invalid date' });
    return;
  }

  const db = getDb();
  const before = isAbsentToday(db);
  const result = db.prepare('DELETE FROM absence_days WHERE date = ?').run(date);
  const after = isAbsentToday(db);

  if ((before?.date ?? null) !== (after?.date ?? null)) {
    broadcast({ type: 'absence_changed', today: after });
  }

  res.json({ deleted: result.changes, today: after });
});

export default router;
