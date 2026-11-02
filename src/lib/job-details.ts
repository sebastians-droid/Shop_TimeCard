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

  const division = manualDivision ? Number(manualDivision) : (draft.asset?.divisionCode ?? null);
  const assetName = draft.asset ? getAssetDisplayName(draft.asset) : '';
  const label =
    [assetName, jobNumber ? `Job ${jobNumber}` : ''].filter(Boolean).join(' · ') ||
    (manualDivision ? `Division ${manualDivision}` : AWAITING_ASSET_LABEL);
  return {
    label,
    fields: {
      timeEntry: `${employeeName} - ${label}`,
      asset: draft.asset ? { id: draft.asset.id, asset: assetName } : null,
      assetDivision: division,
      division,
      jobNumber,
    },
  };
}
