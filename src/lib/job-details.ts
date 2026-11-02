import { getAssetDisplayName } from '@/lib/entry-helpers';
import { AWAITING_ASSET_LABEL } from '@/lib/time-rules';
import type { EquipmentAsset } from '@/models/equipment-asset';
import type { ShopTimeEntry } from '@/models/shop-time-entry';

/** What a person typed or picked for a job: the asset, division, and job number. */
export type JobDetailsDraft = {
  asset?: Pick<EquipmentAsset, 'id' | 'asset' | 'divisionCode'>;
  division: string;
  jobNumber: string;
};

/**
 * The fields a job edit writes. A cleared asset, division, or job number is
 * sent as null or empty rather than left out: an omitted field keeps its old
 * value in Dataverse, so a removal would silently not happen.
 */
export type JobDetailsFields = {
  timeEntry: string;
  asset: { id: string; asset: string } | null;
  assetDivision: number | null;
  division: number | null;
  jobNumber: string;
};

/**
 * The two stored division fields. `assetDivision` is the division the entry is
 * paid under: the typed one, else the asset's. `division` keeps the asset's own
 * code, so when the two differ the typed division was a deliberate override and
 * `getEntryDivision` stops following the asset's live division.
 */
export function divisionFields(
  assetCode: number | undefined,
  typedDivision: string,
): { assetDivision: number | null; division: number | null } {
  const typed = typedDivision.trim();
  const assetDivision = typed ? Number(typed) : (assetCode ?? null);
  return { assetDivision, division: assetCode ?? assetDivision };
}

/** `divisionFields` for a new entry, where an unknown division is left out rather than cleared. */
export function storedDivisions(assetCode: number | undefined, typedDivision: string) {
  const { assetDivision, division } = divisionFields(assetCode, typedDivision);
  return { assetDivision: assetDivision ?? undefined, division: division ?? undefined };
}

/** "4821 - Main St Bridge", or the bare number when the job isn't in the list. */
export function formatJobLabel(jobNumber: string, jobNames: Map<string, string>): string {
  const number = jobNumber.trim();
  const name = jobNames.get(number.toLowerCase());
  return name ? `${number} - ${name}` : number;
}

/** The entry as it reads once the job fields are saved, for an optimistic cache update. */
export function withJobDetails<Entry extends ShopTimeEntry>(entry: Entry, fields: JobDetailsFields & { notes?: string }): Entry {
  return {
    ...entry,
    timeEntry: fields.timeEntry,
    asset: fields.asset ?? undefined,
    assetDivision: fields.assetDivision ?? undefined,
    division: fields.division ?? undefined,
    jobNumber: fields.jobNumber || undefined,
    notes: fields.notes === undefined ? entry.notes : fields.notes || undefined,
  };
}

/**
 * Builds the job fields for an edit, or explains why the edit can't be saved.
 * A row with no asset, division, or job number is only allowed when it is
 * unassigned time (`allowUnassigned`); a job must keep at least one.
 */
export function buildJobDetails(
  employeeName: string,
  draft: JobDetailsDraft,
  { allowUnassigned = false }: { allowUnassigned?: boolean } = {},
): { fields: JobDetailsFields; label: string } | { error: string } {
  const manualDivision = draft.division.trim();
  const jobNumber = draft.jobNumber.trim();
  if (manualDivision && !Number.isFinite(Number(manualDivision))) return { error: 'Division must be a number.' };
  if (!draft.asset && !manualDivision && !jobNumber && !allowUnassigned) {
    return { error: 'A job needs an asset, division, or job number. Delete the row instead to remove it entirely.' };
  }

  const { assetDivision, division } = divisionFields(draft.asset?.divisionCode, manualDivision);
  const assetName = draft.asset ? getAssetDisplayName(draft.asset) : '';
  const label =
    [assetName, jobNumber ? `Job ${jobNumber}` : ''].filter(Boolean).join(' · ') ||
    (manualDivision ? `Division ${manualDivision}` : AWAITING_ASSET_LABEL);
  return {
    label,
    fields: {
      timeEntry: `${employeeName} - ${label}`,
      asset: draft.asset ? { id: draft.asset.id, asset: assetName } : null,
      assetDivision,
      division,
      jobNumber,
    },
  };
}
