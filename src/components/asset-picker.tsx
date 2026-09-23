import { useMemo, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

import { Input } from '@/components/ui/input';
import type { EquipmentAsset } from '@/models/equipment-asset';
import { getAssetDisplayName } from '@/lib/entry-helpers';

export type AssetPickerProps = {
  assets: EquipmentAsset[];
  value: string;
  onChange: (asset: Pick<EquipmentAsset, 'id' | 'asset' | 'divisionCode'> | undefined) => void;
  currentAsset?: Pick<EquipmentAsset, 'id' | 'asset' | 'divisionCode'>;
};

export function AssetPicker({ assets, value, onChange, currentAsset }: AssetPickerProps) {
  const [search, setSearch] = useState<string>('');
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const trimmedSearch = search.trim();
  const allAssets = useMemo(() => {
    const assetsById = new Map<string, EquipmentAsset>();
    [...assets, ...(currentAsset ? [currentAsset as EquipmentAsset] : [])].forEach((asset: EquipmentAsset) => {
      if (asset.id) {
        assetsById.set(asset.id, asset);
      }
    });
    return Array.from(assetsById.values()).sort((assetA: EquipmentAsset, assetB: EquipmentAsset) =>
      getAssetDisplayName(assetA).localeCompare(getAssetDisplayName(assetB), undefined, { numeric: true, sensitivity: 'base' }),
    );
  }, [assets, currentAsset]);
  const selectedAsset = allAssets.find((asset: EquipmentAsset) => asset.id === value);
  const inputValue = search || (selectedAsset ? getAssetDisplayName(selectedAsset) : '');
  const validAssets = allAssets.filter((asset: EquipmentAsset) => asset.id);
  const filteredAssets = validAssets.filter((asset: EquipmentAsset) => getAssetDisplayName(asset).toLowerCase().includes(trimmedSearch.toLowerCase()));
  const assetToSelect = filteredAssets.find((asset: EquipmentAsset) => getAssetDisplayName(asset).toLowerCase() === trimmedSearch.toLowerCase()) ?? filteredAssets[0];
  const handleSelect = (assetId: string) => {
    const selected = allAssets.find((asset: EquipmentAsset) => asset.id === assetId);
    onChange(selected ? { id: selected.id, asset: getAssetDisplayName(selected), divisionCode: selected.divisionCode } : undefined);
    setSearch(selected ? getAssetDisplayName(selected) : '');
    setIsOpen(false);
  };
  const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(event.target.value);
    setIsOpen(true);
    if (value) {
      onChange(undefined);
    }
  };

  return (
    <div className="relative">
      <Input className={`bg-background pr-10 ${value ? 'font-semibold' : ''}`} value={inputValue} onChange={handleSearchChange} onFocus={() => setIsOpen(true)} onBlur={() => window.setTimeout(() => setIsOpen(false), 150)} onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => { if (event.key === 'Enter' && assetToSelect?.id) { event.preventDefault(); handleSelect(assetToSelect.id); } }} placeholder="Search assets" />
      <ChevronDown className="pointer-events-none absolute right-3 top-3 h-4 w-4 text-muted-foreground" />
      {isOpen ? (
        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border border-border bg-popover text-popover-foreground shadow-md">
          {filteredAssets.length === 0 ? <p className="p-3 text-sm text-muted-foreground">No asset matches &ldquo;{inputValue}&rdquo;.</p> : null}
          {filteredAssets.map((asset: EquipmentAsset) => (
            <button key={asset.id} type="button" className={`flex w-full items-center gap-2 border-b border-border px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted focus:bg-muted focus:outline-none ${value === asset.id ? 'font-semibold' : ''}`} onMouseDown={(event: React.MouseEvent<HTMLButtonElement>) => event.preventDefault()} onClick={() => handleSelect(asset.id)}>
              <Check className={`h-4 w-4 ${value === asset.id ? '' : 'invisible'}`} />
              <span>{getAssetDisplayName(asset)}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
