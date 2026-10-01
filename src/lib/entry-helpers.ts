import { format, startOfDay, startOfWeek, endOfWeek } from 'date-fns';

import type { EquipmentAsset } from '@/models/equipment-asset';
import type { ShopTimeEntry, ShopTimeEntryPTOTimeKey } from '@/models/shop-time-entry';
import { formatEmployeeDisplayName, type AppShopEmployee } from '@/lib/shop-employees';
import { DEFAULT_SCHEDULED_START, isAwaitingAsset, isPtoEntry, stripNoLunchMarker } from '@/lib/time-rules';

export type PtoHours = 4 | 8;

export const PTO_TIME_KEY_BY_HOURS: Record<PtoHours, ShopTimeEntryPTOTimeKey> = { 4: 'PTOTimeKey04', 8: 'PTOTimeKey18' };

export const getAssetDisplayName = (asset?: EquipmentAsset | Pick<EquipmentAsset, 'id' | 'asset'> | null) => {
  if (!asset) return 'Unassigned asset';
  return asset.asset || 'Unassigned asset';
};

/**
 * Best available label for the work an entry covers. Assets can be unlinked or
 * deactivated after the fact, so this walks a fallback chain rather than
 * returning nothing: linked asset, then the name saved on the entry label, then
 * the job number or division. It always returns a non-empty string.
 */
export function getEntryAssetName(entry: ShopTimeEntry, assets: EquipmentAsset[]): string {
  if (isPtoEntry(entry)) return 'PTO';
  if (isAwaitingAsset(entry)) return 'Waiting';
  const matchedAsset = entry.asset?.id ? assets.find((asset: EquipmentAsset) => asset.id === entry.asset?.id) : undefined;
  if (entry.asset?.asset || matchedAsset) return entry.asset?.asset || getAssetDisplayName(matchedAsset);
  const timeEntryParts = entry.timeEntry.split(' - ');
  const savedAssetName = timeEntryParts.length > 1 ? timeEntryParts.slice(1).join(' - ').trim() : '';
  if (savedAssetName && savedAssetName !== 'Time entry') return savedAssetName;
  const jobNumber = getEntryJobNumber(entry);
  if (jobNumber) return `Job ${jobNumber}`;
  return entry.assetDivision ? `Division ${String(entry.assetDivision)}` : 'Unassigned asset';
}

export const getEntryJobNumber = (entry: ShopTimeEntry) => entry.jobNumber ?? '';

export const getPtoClockInIso = (date: Date) => {
  const ptoDate = startOfDay(date);
  ptoDate.setHours(8, 0, 0, 0);
  return ptoDate.toISOString();
};

export const formatTimeForInput = (dateTime?: string) => {
  if (!dateTime) return '';
  return format(new Date(dateTime), 'HH:mm');
};

export const mergeDateAndTime = (existingDateTime: string, timeValue: string) => {
  const date = new Date(existingDateTime);
  const [hours = '0', minutes = '0'] = timeValue.split(':');
  date.setHours(Number(hours), Number(minutes), 0, 0);
  return date.toISOString();
};

export const combineSelectedDateAndTime = (day: Date, timeValue: string) => {
  const date = startOfDay(day);
  const [hours = '0', minutes = '0'] = timeValue.split(':');
  date.setHours(Number(hours), Number(minutes), 0, 0);
  return date.toISOString();
};

export const EMPLOYEE_CODE_NOT_FOUND = 'Employee code not found. Enter your 4 digit employee number.';

/** Matches a kiosk-entered employee number against the shop roster. */
export const findEmployeeByCode = (employees: AppShopEmployee[], code: string) => {
  const parsed = Number(code.trim());
  if (!Number.isFinite(parsed)) return undefined;
  return employees.find((employee: AppShopEmployee) => employee.employeeCode === parsed);
};

export const getEntryEmployeeKey = (entry: ShopTimeEntry) => entry.employee?.id ?? entry.id;

export const getEntryEmployeeName = (entry: ShopTimeEntry, employees: AppShopEmployee[]) => {
  const employeeRecord = employees.find((employee: AppShopEmployee) => employee.id === entry.employee?.id);
  if (employeeRecord?.employeeName) return employeeRecord.employeeName;
  if (entry.employee?.autoNumber) return formatEmployeeDisplayName(entry.employee.autoNumber) || entry.employee.autoNumber;
  return 'Unknown employee';
};

export const getEntryEmployeeNumber = (entry: ShopTimeEntry, employees: AppShopEmployee[]) => {
  const employeeRecord = employees.find((employee: AppShopEmployee) => employee.id === entry.employee?.id);
  return String(employeeRecord?.employeeCode ?? entry.employee?.autoNumber ?? '—');
};

export const isInOpenPayrollWeek = (entry: ShopTimeEntry) => {
  const iso = entry.clockIn ?? entry.workDate;
  if (!iso) return false;
  const now = new Date();
  const entryDate = new Date(iso);
  return entryDate >= startOfWeek(now, { weekStartsOn: 0 }) && entryDate <= endOfWeek(now, { weekStartsOn: 0 });
};

export const getEntryDivision = (entry: ShopTimeEntry, assets: EquipmentAsset[]) => {
  const matchedAsset = entry.asset?.id ? assets.find((asset: EquipmentAsset) => asset.id === entry.asset?.id) : undefined;
  // Entries in the current payroll week track the asset's live division so a
  // reassignment applies to work that hasn't been paid yet. Earlier weeks keep
  // the division recorded at clock-in so already-exported payroll stays stable.
  if (matchedAsset?.divisionCode !== undefined && isInOpenPayrollWeek(entry)) {
    return String(matchedAsset.divisionCode);
  }
  return String(entry.assetDivision ?? matchedAsset?.divisionCode ?? '');
};

export const getEntryWorkDateKey = (entry: ShopTimeEntry) =>
  entry.clockIn ? format(new Date(entry.clockIn), 'yyyy-MM-dd') : 'No clock-in date';

export const getEmployeeNotes = (notes?: string) => stripNoLunchMarker(notes);

export const getWeekRange = (date: Date) => {
  const start = startOfWeek(date, { weekStartsOn: 0 });
  const end = endOfWeek(date, { weekStartsOn: 0 });
  return { start, end };
};

export const formatWeekRangeLabel = (date: Date) => {
  const { start, end } = getWeekRange(date);
  return `${format(start, 'M/d/yyyy')} - ${format(end, 'M/d/yyyy')}`;
};

export const formatScheduledStartTime = (time: string) => {
  const [hours = '0', minutes = '0'] = time.split(':');
  const date = new Date(1970, 0, 1, Number(hours), Number(minutes), 0, 0);
  if (!Number.isFinite(date.getTime())) return time;
  return format(date, 'p');
};

export const scheduledStartCaption = (employee: { isRoadMech?: boolean } | null | undefined, storedStart?: string) => {
  if (employee?.isRoadMech) return 'Starts at clock-in';
  return `Scheduled start ${formatScheduledStartTime(storedStart || DEFAULT_SCHEDULED_START)}`;
};
