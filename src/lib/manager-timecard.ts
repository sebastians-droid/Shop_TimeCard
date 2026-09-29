import type { EquipmentAsset } from '@/models/equipment-asset';
import type { ShopTimeEntry, ShopTimeEntryPayTypeKey, ShopTimeEntryPTOTypeKey } from '@/models/shop-time-entry';
import { DEFAULT_PAY_TYPE } from '@/models/shop-time-entry';
import type { PtoHours } from '@/lib/entry-helpers';

/** Form state for editing an existing time entry. */
export type EditableEntry = {
  assetId: string;
  assetRecord?: Pick<EquipmentAsset, 'id' | 'asset' | 'divisionCode'>;
  division: string;
  jobNumber: string;
  notes: string;
  payTypeKey: ShopTimeEntryPayTypeKey;
  clockInTime: string;
  clockOutTime: string;
};

/** Form state for a manager-added entry, which also needs a target employee. */
export type NewEntryDraft = EditableEntry & {
  employeeId: string;
};

export type PtoDraft = {
  employeeId: string;
  hours: PtoHours;
  type: ShopTimeEntryPTOTypeKey | '';
};

/** One employee's roll-up for a single day in the manager timecard list. */
export type EmployeeDailySummary = {
  employeeKey: string;
  employeeName: string;
  employeeNumber: string;
  entries: ShopTimeEntry[];
  activeCount: number;
  totalMinutes: number;
  noLunch: boolean;
  lunchDeducted: boolean;
  onCall: boolean;
};

export const emptyEntryDraft = (employeeId = ''): NewEntryDraft => ({
  employeeId,
  assetId: '',
  assetRecord: undefined,
  division: '',
  jobNumber: '',
  notes: '',
  payTypeKey: DEFAULT_PAY_TYPE,
  clockInTime: '',
  clockOutTime: '',
});

export const emptyPtoDraft = (employeeId = ''): PtoDraft => ({
  employeeId,
  hours: 8,
  type: '',
});
