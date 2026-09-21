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
} as const;
export type ShopTimeEntryPTOTypeKey = keyof typeof ShopTimeEntryPTOTypeKeyToLabel;

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
  pTOTimeKey?: ShopTimeEntryPTOTimeKey;
  pTOTypeKey?: ShopTimeEntryPTOTypeKey;
  workDate?: string;
}
