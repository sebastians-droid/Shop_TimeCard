import type { EquipmentAsset } from './equipment-asset';
import type { ShopEmployee } from './shop-employee';

export const ShopTimeEntryPTOTimeKeyToLabel = {
  PTOTimeKey04: '4 ',
  PTOTimeKey18: '8',
} as const;
export type ShopTimeEntryPTOTimeKey = keyof typeof ShopTimeEntryPTOTimeKeyToLabel;

export const ShopTimeEntryPTOTypeKeyToLabel = {
  Personal: 'Personal',
  Vacation: 'Vacation',
  Holiday: 'Holiday',
} as const;
export type ShopTimeEntryPTOTypeKey = keyof typeof ShopTimeEntryPTOTypeKeyToLabel;

export const ShopTimeEntryPayTypeKeyToLabel = {
  JR: 'JR · Job Rate',
  SR: 'SR · Shop Rate',
  DoubleTime: 'Double-Time',
} as const;
export type ShopTimeEntryPayTypeKey = keyof typeof ShopTimeEntryPayTypeKeyToLabel;

export const DEFAULT_PAY_TYPE: ShopTimeEntryPayTypeKey = 'SR';

export const ShopTimeEntryPTOApprovalKeyToLabel = {
  Pending: 'Pending',
  Approved: 'Approved',
  Denied: 'Denied',
} as const;
export type ShopTimeEntryPTOApprovalKey = keyof typeof ShopTimeEntryPTOApprovalKeyToLabel;

export interface ShopTimeEntry {
  id: string;
  timeEntry: string;
  asset?: Pick<EquipmentAsset, 'id' | 'asset'>;
  assetDivision?: number;
  clockIn?: string;
  clockOut?: string;
  division?: number;
  employee?: Pick<ShopEmployee, 'id' | 'autoNumber'>;
  hours?: number;
  jobNumber?: string;
  notes?: string;
  onCall?: boolean;
  payTypeKey?: ShopTimeEntryPayTypeKey;
  pTOTimeKey?: ShopTimeEntryPTOTimeKey;
  pTOTypeKey?: ShopTimeEntryPTOTypeKey;
  ptoApproval?: ShopTimeEntryPTOApprovalKey;
  workDate?: string;
}
