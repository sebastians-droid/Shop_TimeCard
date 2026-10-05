import { getEntryPaidMinutes, isPtoEntry, type EmployeePayProfile } from '@/lib/time-rules';
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
