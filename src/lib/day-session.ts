import { format, subDays } from 'date-fns';

import {
  dayPunchSessions,
  entryWorkDateKey,
  getEntryPaidMinutes,
  isAwaitingAsset,
  isPtoEntry,
  type EmployeePayProfile,
  type PunchSession,
} from '@/lib/time-rules';
import type { ShopTimeEntry } from '@/models/shop-time-entry';

export function laborEntries(entries: ShopTimeEntry[]): ShopTimeEntry[] {
  return entries.filter((entry) => !isPtoEntry(entry));
}

function byClockIn(left: ShopTimeEntry, right: ShopTimeEntry) {
  return new Date(left.clockIn ?? 0).getTime() - new Date(right.clockIn ?? 0).getTime();
}

/** Earliest labor clock-in for the day. Locked once the first punch is recorded. */
export function dayFirstClockIn(entries: ShopTimeEntry[]): string | undefined {
  const first = laborEntries(entries)
    .filter((entry) => entry.clockIn)
    .sort(byClockIn)[0];
  return first?.clockIn;
}

/**
 * Latest labor clock-out when every labor row is closed.
 * Undefined while someone is still clocked in.
 */
export function dayLastClockOut(entries: ShopTimeEntry[]): string | undefined {
  const labor = laborEntries(entries).filter((entry) => entry.clockIn);
  if (labor.length === 0 || labor.some((entry) => !entry.clockOut)) return undefined;
  return labor.reduce((latest, entry) => {
    const out = entry.clockOut ?? '';
    return out > latest ? out : latest;
  }, labor[0]?.clockOut ?? '');
}

/** A clock-in this soon after the last clock-out is a return from break, not a new shift. */
export const SHIFT_CONTINUES_MS = 4 * 60 * 60 * 1000;

/**
 * The work day a new clock-in belongs to: today, unless the employee is back
 * from a break, in which case it continues that shift's day. Without this a
 * break across midnight would split one shift into two days.
 */
export function workDateForClockIn(employeeEntries: ShopTimeEntry[], clockInIso: string): string {
  const at = new Date(clockInIso).getTime();
  const lastClosed = laborEntries(employeeEntries)
    .filter((entry) => entry.clockOut && new Date(entry.clockOut).getTime() <= at)
    .sort((left, right) => new Date(right.clockOut!).getTime() - new Date(left.clockOut!).getTime())[0];
  const continuing = lastClosed && at - new Date(lastClosed.clockOut!).getTime() < SHIFT_CONTINUES_MS;
  return (continuing && entryWorkDateKey(lastClosed)) || format(new Date(clockInIso), 'yyyy-MM-dd');
}

export function findLaborEntryCovering(entries: ShopTimeEntry[], atIso: string): ShopTimeEntry | undefined {
  const at = new Date(atIso).getTime();
  if (!Number.isFinite(at)) return undefined;
  return laborEntries(entries).find((entry) => {
    if (!entry.clockIn) return false;
    const start = new Date(entry.clockIn).getTime();
    const end = entry.clockOut ? new Date(entry.clockOut).getTime() : Number.POSITIVE_INFINITY;
    return at > start && at < end;
  });
}

export function validateForgottenAssetStart(entries: ShopTimeEntry[], atIso: string): string | undefined {
  const first = dayFirstClockIn(entries);
  if (!first) return 'Clock in before adding a forgotten asset.';
  const at = new Date(atIso).getTime();
  if (!Number.isFinite(at)) return 'Enter the time this asset started.';
  if (at <= new Date(first).getTime()) return "Asset start must be after the day's clock-in.";
  const last = dayLastClockOut(entries);
  if (last && at >= new Date(last).getTime()) return "Asset start must be before the day's clock-out.";
  if (!findLaborEntryCovering(entries, atIso)) return 'That time does not fall inside an existing punch.';
  return undefined;
}

export type ForgottenJobPatch = {
  id: string;
  clockIn?: string;
  clockOut?: string;
  hours: number;
};

export type ForgottenJobCreate = {
  clockIn: string;
  clockOut: string;
  hours: number;
  kind: 'new' | 'remainder';
  copyFrom?: ShopTimeEntry;
};

export type ForgottenJobInsert = {
  patches: ForgottenJobPatch[];
  creates: ForgottenJobCreate[];
  firstIn: string;
  lastOut: string;
};

function punchRange(entry: ShopTimeEntry) {
  return { start: new Date(entry.clockIn ?? 0).getTime(), end: new Date(entry.clockOut ?? 0).getTime() };
}

/**
 * Inserts a job into a closed day. Neighboring punches shrink immediately:
 * the job before ends at `startedAt`, and if this job ends before that punch
 * did, the leftover tail is kept. If the window reaches into the next punch,
 * that punch's clock-in moves to `endedAt`.
 */
export function planForgottenJobInsert(
  dayEntries: ShopTimeEntry[],
  startedAt: string,
  endedAt: string,
  payStart?: string | null,
  employee?: EmployeePayProfile | null,
): ForgottenJobInsert | { error: string } {
  const start = new Date(startedAt).getTime();
  const end = new Date(endedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return { error: 'Enter the start and end time for this job.' };
  if (end <= start) return { error: 'End time must be after start time.' };

  const firstIn = dayFirstClockIn(dayEntries);
  const lastOut = dayLastClockOut(dayEntries);
  if (!firstIn || !lastOut) return { error: 'Clock out on the timecard before adding a forgotten job.' };
  if (start <= new Date(firstIn).getTime()) return { error: "Job start must be after the day's clock-in." };
  if (end > new Date(lastOut).getTime()) return { error: "Job end must be at or before the day's clock-out." };
  const insideOneSession = dayPunchSessions(dayEntries).some(
    (session) => start >= new Date(session.start).getTime() && session.end && end <= new Date(session.end).getTime(),
  );
  if (!insideOneSession) {
    return { error: 'That window crosses a break when you were clocked out. Add a separate job for each side of the break.' };
  }

  const labor = laborEntries(dayEntries)
    .filter((entry) => entry.clockIn && entry.clockOut)
    .sort(byClockIn);
  const overlapping = labor.filter((entry) => {
    const { start: punchStart, end: punchEnd } = punchRange(entry);
    return punchStart < end && punchEnd > start;
  });
  if (overlapping.length === 0) return { error: 'That window does not fall inside an existing punch.' };
  if (
    overlapping.some((entry) => {
      const { start: punchStart, end: punchEnd } = punchRange(entry);
      return punchStart >= start && punchEnd <= end;
    })
  ) {
    return { error: 'That window covers an entire existing job. Shorten the end time or edit that job first.' };
  }

  const nextById = new Map(labor.map((entry) => [entry.id, { ...entry, clockIn: entry.clockIn!, clockOut: entry.clockOut! }]));
  let remainder: { clockIn: string; clockOut: string; template: ShopTimeEntry } | undefined;

  for (const entry of overlapping) {
    const next = nextById.get(entry.id);
    if (!next) continue;
    const punchStart = new Date(next.clockIn).getTime();
    const punchEnd = new Date(next.clockOut).getTime();
    const leftoverBefore = punchStart < start && punchEnd > start;
    const leftoverAfter = punchStart < end && punchEnd > end;
    if (leftoverBefore && leftoverAfter) {
      next.clockOut = startedAt;
      remainder = { clockIn: endedAt, clockOut: entry.clockOut!, template: entry };
    } else if (leftoverBefore) {
      next.clockOut = startedAt;
    } else if (leftoverAfter) {
      next.clockIn = endedAt;
    }
  }

  const createdJob: ShopTimeEntry = {
    id: 'provisional-new-job',
    timeEntry: 'Time entry',
    clockIn: startedAt,
    clockOut: endedAt,
  };
  const remainderJob: ShopTimeEntry | undefined = remainder
    ? {
        id: 'provisional-remainder',
        timeEntry: remainder.template.timeEntry,
        asset: remainder.template.asset,
        employee: remainder.template.employee,
        clockIn: remainder.clockIn,
        clockOut: remainder.clockOut,
      }
    : undefined;
  const dayAfter = [
    ...nextById.values(),
    createdJob,
    ...(remainderJob ? [remainderJob] : []),
    ...dayEntries.filter((entry) => isPtoEntry(entry)),
  ];

  const patches: ForgottenJobPatch[] = labor.flatMap((entry) => {
    const next = nextById.get(entry.id);
    if (!next || (next.clockIn === entry.clockIn && next.clockOut === entry.clockOut)) return [];
    return [
      {
        id: entry.id,
        clockIn: next.clockIn !== entry.clockIn ? next.clockIn : undefined,
        clockOut: next.clockOut !== entry.clockOut ? next.clockOut : undefined,
        hours: getEntryPaidMinutes(dayAfter, next, new Date(), payStart, employee) / 60,
      },
    ];
  });

  const creates: ForgottenJobCreate[] = [
    {
      clockIn: startedAt,
      clockOut: endedAt,
      hours: getEntryPaidMinutes(dayAfter, createdJob, new Date(), payStart, employee) / 60,
      kind: 'new',
    },
  ];
  if (remainder && remainderJob) {
    creates.push({
      clockIn: remainder.clockIn,
      clockOut: remainder.clockOut,
      hours: getEntryPaidMinutes(dayAfter, remainderJob, new Date(), payStart, employee) / 60,
      kind: 'remainder',
      copyFrom: remainder.template,
    });
  }

  return { patches, creates, firstIn, lastOut };
}

/** Road mechanics may reshape jobs on today and the seven days before it. Matches ROAD_MECH_EDIT_DAYS in api/shared/auth.js. */
export const ROAD_MECH_EDIT_DAYS = 7;

export function isWithinRoadMechEditWindow(dateKey: string, now = new Date()): boolean {
  return dateKey >= format(subDays(now, ROAD_MECH_EDIT_DAYS), 'yyyy-MM-dd');
}

function toMs(iso: string | undefined): number {
  return iso ? new Date(iso).getTime() : Number.NaN;
}

function sessionHolding(labor: ShopTimeEntry[], entry: ShopTimeEntry): PunchSession | undefined {
  const at = toMs(entry.clockIn);
  return dayPunchSessions(labor).find((session) => at >= toMs(session.start) && (!session.end || at <= toMs(session.end)));
}

export type JobTimeLocks = {
  /** The job starts at a clock-in punch, so its start cannot move. */
  startLocked: boolean;
  /** The job ends at a clock-out punch, or is still running. */
  endLocked: boolean;
  session?: PunchSession;
};

export function jobTimeLocks(dayEntries: ShopTimeEntry[], entry: ShopTimeEntry): JobTimeLocks {
  const session = sessionHolding(laborEntries(dayEntries), entry);
  if (!session) return { startLocked: true, endLocked: true };
  return {
    startLocked: toMs(entry.clockIn) === toMs(session.start),
    endLocked: !entry.clockOut || (session.end !== undefined && toMs(entry.clockOut) === toMs(session.end)),
    session,
  };
}

export type JobTimeWrite =
  { kind: 'patch'; id: string; clockIn?: string; clockOut?: string; hours?: number } | { kind: 'delete'; id: string };

export type JobTimeEdit = {
  /**
   * Ordered so every step leaves the day's punched spans untouched: rows grow
   * first, then shrink, then fully covered unassigned rows are removed. The
   * server rejects a road mechanic's write that would move a clock-in or clock-out.
   */
  writes: JobTimeWrite[];
  dayAfter: ShopTimeEntry[];
  /** Other jobs whose times moved to make room. */
  shiftedIds: string[];
  /** Unassigned rows the edited job now covers completely. */
  removedIds: string[];
};

/** Hours patches for closed labor rows whose stored hours no longer match the day as it now stands. */
export function planHoursRefresh(
  dayAfter: ShopTimeEntry[],
  payStart?: string | null,
  employee?: EmployeePayProfile | null,
  now = new Date(),
): JobTimeWrite[] {
  return laborEntries(dayAfter).flatMap((row): JobTimeWrite[] => {
    if (!row.clockIn || !row.clockOut) return [];
    const hours = getEntryPaidMinutes(dayAfter, row, now, payStart, employee) / 60;
    return Math.abs(hours - (row.hours ?? 0)) > 0.001 ? [{ kind: 'patch', id: row.id, hours }] : [];
  });
}

type Span = { clockIn: string; clockOut?: string };

function coveredJobError(row: ShopTimeEntry): { error: string } {
  const range = `${format(new Date(row.clockIn!), 'p')} – ${row.clockOut ? format(new Date(row.clockOut), 'p') : 'now'}`;
  return { error: `That would cover the whole ${range} job. Change or cancel that job first.` };
}

/**
 * Moves a job's start and end inside the session it already belongs to. The
 * neighbor on each side gives up or takes the difference, so the day stays
 * gap-free and its clock-in, clock-out, and breaks never change. An
 * unassigned row swallowed entirely is removed; swallowing a real job is refused.
 */
export function planJobTimeEdit(
  dayEntries: ShopTimeEntry[],
  entryId: string,
  startedAt: string,
  endedAt: string | undefined,
  payStart?: string | null,
  employee?: EmployeePayProfile | null,
  now = new Date(),
): JobTimeEdit | { error: string } {
  const labor = laborEntries(dayEntries)
    .filter((entry) => entry.clockIn)
    .sort(byClockIn);
  const target = labor.find((entry) => entry.id === entryId);
  if (!target?.clockIn) return { error: 'That job is no longer on this day. Reload and try again.' };

  const start = toMs(startedAt);
  const end = endedAt ? toMs(endedAt) : undefined;
  if (!Number.isFinite(start) || (end !== undefined && !Number.isFinite(end))) {
    return { error: 'Enter the start and end time for this job.' };
  }
  if (target.clockOut && end === undefined) return { error: 'Enter the end time for this job.' };
  if (!target.clockOut && end !== undefined) {
    return { error: 'This job is still running. Its end is set when you switch jobs or clock out.' };
  }
  if (end !== undefined && end <= start) return { error: 'End time must be after start time.' };

  const locks = jobTimeLocks(dayEntries, target);
  const session = locks.session;
  if (!session) return { error: 'That job is no longer on this day. Reload and try again.' };
  const oldStart = toMs(target.clockIn);
  const oldEnd = target.clockOut ? toMs(target.clockOut) : undefined;
  if (locks.startLocked && start !== oldStart) {
    return { error: `This job starts at your clock-in (${format(new Date(oldStart), 'p')}). Ask a manager to change a clock-in.` };
  }
  if (locks.endLocked && oldEnd !== undefined && end !== oldEnd) {
    return { error: `This job ends at your clock-out (${format(new Date(oldEnd), 'p')}). Ask a manager to change a clock-out.` };
  }
  const sessionStart = toMs(session.start);
  const sessionEnd = session.end ? toMs(session.end) : now.getTime();
  if (start < sessionStart || (end ?? start) > sessionEnd) {
    const span = `${format(new Date(sessionStart), 'p')} – ${session.end ? format(new Date(sessionEnd), 'p') : 'now'}`;
    return { error: `Job times must stay inside the time you were clocked in (${span}).` };
  }

  const others = labor.filter((row) => row.id !== target.id && toMs(row.clockIn) >= sessionStart && toMs(row.clockIn) <= sessionEnd);
  const before = others.filter((row) => toMs(row.clockIn) < oldStart);
  const after = others.filter((row) => toMs(row.clockIn) >= oldStart);
  const finalSpans = new Map<string, Span>([[target.id, { clockIn: startedAt, clockOut: endedAt }]]);
  const removed = new Set<string>();

  if (start < oldStart) {
    for (const row of [...before].reverse()) {
      const rowEnd = toMs(row.clockOut);
      if (rowEnd <= start) break;
      if (toMs(row.clockIn) >= start) {
        if (!isAwaitingAsset(row)) return coveredJobError(row);
        removed.add(row.id);
        continue;
      }
      finalSpans.set(row.id, { clockIn: row.clockIn!, clockOut: startedAt });
      break;
    }
  } else if (start > oldStart) {
    const previous = before[before.length - 1];
    if (!previous?.clockOut) return { error: 'There is no earlier job to take over that time.' };
    finalSpans.set(previous.id, { clockIn: previous.clockIn!, clockOut: startedAt });
  }

  if (end !== undefined && oldEnd !== undefined && end > oldEnd) {
    for (const row of after) {
      if (toMs(row.clockIn) >= end) break;
      const rowEnd = row.clockOut ? toMs(row.clockOut) : Number.POSITIVE_INFINITY;
      if (rowEnd <= end) {
        if (!isAwaitingAsset(row)) return coveredJobError(row);
        removed.add(row.id);
        continue;
      }
      finalSpans.set(row.id, { clockIn: endedAt!, clockOut: row.clockOut });
      break;
    }
  } else if (end !== undefined && oldEnd !== undefined && end < oldEnd) {
    const following = after.find((row) => !removed.has(row.id));
    if (!following) return { error: 'There is no later job to take over that time.' };
    finalSpans.set(following.id, { clockIn: endedAt!, clockOut: following.clockOut });
  }

  const dayAfter = dayEntries
    .filter((entry) => !removed.has(entry.id))
    .map((entry) => {
      const span = finalSpans.get(entry.id);
      return span ? { ...entry, clockIn: span.clockIn, clockOut: span.clockOut } : entry;
    });

  const grow: JobTimeWrite[] = [];
  const shrink: JobTimeWrite[] = [];
  const hoursOnly: JobTimeWrite[] = [];
  for (const row of labor) {
    if (removed.has(row.id)) continue;
    const span = finalSpans.get(row.id);
    const closedAfter = span ? span.clockOut : row.clockOut;
    const hours = closedAfter
      ? getEntryPaidMinutes(
          dayAfter,
          dayAfter.find((entry) => entry.id === row.id)!,
          now,
          payStart,
          employee,
        ) / 60
      : undefined;
    const hoursChanged = hours !== undefined && Math.abs(hours - (row.hours ?? 0)) > 0.001;
    const spanChanged = span && (toMs(span.clockIn) !== toMs(row.clockIn) || toMs(span.clockOut) !== toMs(row.clockOut));
    if (!span || !spanChanged) {
      if (hoursChanged) hoursOnly.push({ kind: 'patch', id: row.id, hours });
      continue;
    }
    const unionIn = toMs(span.clockIn) < toMs(row.clockIn) ? span.clockIn : row.clockIn!;
    const unionOut = row.clockOut && span.clockOut && toMs(span.clockOut) > toMs(row.clockOut) ? span.clockOut : row.clockOut;
    const grows = toMs(unionIn) !== toMs(row.clockIn) || toMs(unionOut) !== toMs(row.clockOut);
    const shrinks = toMs(unionIn) !== toMs(span.clockIn) || toMs(unionOut) !== toMs(span.clockOut);
    const finalWrite = (from: Span): JobTimeWrite => ({
      kind: 'patch',
      id: row.id,
      clockIn: toMs(span.clockIn) !== toMs(from.clockIn) ? span.clockIn : undefined,
      clockOut: span.clockOut && toMs(span.clockOut) !== toMs(from.clockOut) ? span.clockOut : undefined,
      hours,
    });
    if (grows && shrinks) {
      grow.push({
        kind: 'patch',
        id: row.id,
        clockIn: unionIn !== row.clockIn ? unionIn : undefined,
        clockOut: unionOut !== row.clockOut ? unionOut : undefined,
      });
      shrink.push(finalWrite({ clockIn: unionIn, clockOut: unionOut }));
    } else if (grows) {
      grow.push(finalWrite({ clockIn: row.clockIn!, clockOut: row.clockOut }));
    } else {
      shrink.push(finalWrite({ clockIn: row.clockIn!, clockOut: row.clockOut }));
    }
  }

  return {
    writes: [...grow, ...shrink, ...[...removed].map((id): JobTimeWrite => ({ kind: 'delete', id })), ...hoursOnly],
    dayAfter,
    shiftedIds: [...finalSpans.keys()].filter((id) => id !== target.id),
    removedIds: [...removed],
  };
}
