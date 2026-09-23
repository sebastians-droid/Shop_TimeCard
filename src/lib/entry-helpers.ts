import { format, startOfDay, startOfWeek, endOfWeek } from 'date-fns';

import type { EquipmentAsset } from '@/models/equipment-asset';
import type { ShopTimeEntry, ShopTimeEntryPTOTimeKey } from '@/models/shop-time-entry';
import type { AppShopEmployee } from '@/lib/shop-employees';
import { isPtoEntry, stripNoLunchMarker } from '@/lib/time-rules';

export type PtoHours = 4 | 8;

export const PTO_TIME_KEY_BY_HOURS: Record<PtoHours, ShopTimeEntryPTOTimeKey> = { 4: 'PTOTimeKey04', 8: 'PTOTimeKey18' };

export const getAssetDisplayName = (asset?: EquipmentAsset | Pick<EquipmentAsset, 'id' | 'asset'> | null) => {
  if (!asset) return 'Unassigned asset';
  return asset.asset || 'Unassigned asset';
};

export const getEntryAssetName = (entry: ShopTimeEntry, assets: EquipmentAsset[]) => {
  if (isPtoEntry(entry)) return 'PTO';
  const matchedAsset = entry.asset?.id ? assets.find((asset: EquipmentAsset) => asset.id === entry.asset?.id) : undefined;
  if (entry.asset?.asset || matchedAsset) return entry.asset?.asset || getAssetDisplayName(matchedAsset);
  return '';
};

export function getTimeEntryAssetName(entry: ShopTimeEntry, assets: EquipmentAsset[]) {
  if (isPtoEntry(entry)) return 'PTO';
  const matchedAsset = entry.asset?.id ? assets.find((asset: EquipmentAsset) => asset.id === entry.asset?.id) : undefined;
  if (entry.asset?.asset || matchedAsset) return entry.asset?.asset || getAssetDisplayName(matchedAsset);
  const timeEntryParts = entry.timeEntry.split(' - ');
  const savedAssetName = timeEntryParts.length > 1 ? timeEntryParts.slice(1).join(' - ').trim() : '';
  if (savedAssetName && savedAssetName !== 'Time entry') return savedAssetName;
  if (getEntryJobNumber(entry)) return `Job ${getEntryJobNumber(entry)}`;
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

export const getEntryEmployeeKey = (entry: ShopTimeEntry) => entry.employee?.id ?? entry.id;

export const getEntryEmployeeName = (entry: ShopTimeEntry, employees: AppShopEmployee[]) => {
  const employeeRecord = employees.find((employee: AppShopEmployee) => employee.id === entry.employee?.id);
  return employeeRecord?.employeeName ?? entry.employee?.autoNumber ?? 'Unknown employee';
};

export const getEntryEmployeeNumber = (entry: ShopTimeEntry, employees: AppShopEmployee[]) => {
  const employeeRecord = employees.find((employee: AppShopEmployee) => employee.id === entry.employee?.id);
  return String(employeeRecord?.employeeCode ?? entry.employee?.autoNumber ?? '—');
};

export const getEntryDivision = (entry: ShopTimeEntry, assets: EquipmentAsset[]) => {
  const matchedAsset = entry.asset?.id ? assets.find((asset: EquipmentAsset) => asset.id === entry.asset?.id) : undefined;
  return String(entry.assetDivision ?? matchedAsset?.divisionCode ?? '');
};

export const getEntryWorkDateKey = (entry: ShopTimeEntry) => (entry.clockIn ? format(new Date(entry.clockIn), 'yyyy-MM-dd') : 'No clock-in date');

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
