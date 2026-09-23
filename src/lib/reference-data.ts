export const DIVISIONS = [
  { code: 101, picklist: 290180001, label: 'MILL. CLEAN UP' },
  { code: 200, picklist: 0, label: 'SHOP' },
  { code: 300, picklist: 4, label: 'MILL' },
  { code: 501, picklist: 9, label: 'HVE' },
  { code: 600, picklist: 8, label: 'GRIND' },
  { code: 700, picklist: 1, label: 'CON' },
  { code: 798, picklist: 7, label: 'FARM' },
  { code: 800, picklist: 3, label: 'S/S' },
  { code: 801, picklist: 5, label: 'VB S/S' },
  { code: 803, picklist: 2, label: 'BT' },
  { code: 900, picklist: 6, label: 'ADMIN' },
] as const;

export function divisionLabel(code?: number) {
  if (code == null) return '';
  const d = DIVISIONS.find(d => d.code === code);
  return d ? `${d.code} ${d.label}` : String(code);
}

export function picklistForCode(code: number) {
  return DIVISIONS.find(d => d.code === code)?.picklist;
}

export const EQUIPMENT_CATEGORIES = [
  { value: 0, label: 'AIR COMPRESSORS' }, { value: 1, label: 'AIR SCREED' }, { value: 2, label: 'ATVS' },
  { value: 3, label: 'AUTOMOBILE' }, { value: 4, label: 'ASPHALT PAVERS' }, { value: 5, label: 'POWER BUGGY' },
  { value: 6, label: 'BEADBLASTER' }, { value: 7, label: 'BULL DOZERS' }, { value: 8, label: 'HYDRO CRANES' },
  { value: 9, label: 'TRUCK CRANES' }, { value: 10, label: 'CRAWLER CRANES' }, { value: 11, label: 'CONCRETE PAVER' },
  { value: 12, label: 'CONCRETE TRUCKS' }, { value: 13, label: 'POLY MIXER' }, { value: 14, label: 'POLY PAVER' },
  { value: 15, label: 'POLY PAVER ATTACHMENTS' }, { value: 16, label: 'CONCRETE PLANT' },
  { value: 17, label: 'CONCRETE PLANT BLOWER' }, { value: 18, label: 'CONCRETE PLANT PRESSURE WASHER' },
  { value: 19, label: 'CRASH ATTENUATORS' }, { value: 20, label: 'CONVEYORS' }, { value: 21, label: 'DECK FINISHERS' },
  { value: 22, label: 'CORECUT DEEP SAW' }, { value: 23, label: 'DEEP SAWS' }, { value: 24, label: 'DOWEL HOLE DRILLS' },
  { value: 25, label: 'DRILLS' }, { value: 26, label: 'DUMP TRUCKS' }, { value: 27, label: 'EPOXY INJECTION MACHINE' },
  { value: 28, label: 'ELECTRIC CUTTERS' }, { value: 29, label: 'EXCAVATORS' }, { value: 30, label: 'EXCAVATOR ATTACHMENTS' },
  { value: 31, label: 'SWANK FARM' }, { value: 32, label: 'FLASHING ARROWS' }, { value: 33, label: 'FLAT TRUCKS' },
  { value: 34, label: 'FLOOR GRINDER' }, { value: 35, label: 'FORK LIFTS' }, { value: 36, label: 'FRONT LOADERS' },
  { value: 37, label: 'FRONT LOADER ATTACHMENT' }, { value: 38, label: 'GENERATORS' }, { value: 39, label: 'GROOVERS' },
  { value: 40, label: 'GRINDERS' }, { value: 41, label: 'GROUND HEATER' }, { value: 42, label: 'GROUND MACHINE' },
  { value: 43, label: 'HVE' }, { value: 44, label: 'LIGHT PLANTS' }, { value: 45, label: 'LIFE BOATS' },
  { value: 46, label: 'MAN LIFTS' }, { value: 47, label: 'BUCKET TRUCKS' }, { value: 48, label: 'MECHANIC TRUCKS' },
  { value: 49, label: 'MESSAGE BOARDS' }, { value: 50, label: 'SPEED MONITORS' }, { value: 51, label: 'TRAFFIC ALERT RADIOS' },
  { value: 52, label: 'TRAFFIC SIGNALS' }, { value: 53, label: 'OFF ROAD TRUCKS' }, { value: 54, label: 'PICK UP TRUCKS' },
  { value: 55, label: 'PILE DRIVERS' }, { value: 56, label: 'PIT INCINERATOR' }, { value: 57, label: 'POWER BROOMS' },
  { value: 58, label: 'WATER PUMPS' }, { value: 59, label: 'S/S PUMPS' }, { value: 60, label: 'RAMMER HAMMERS' },
  { value: 61, label: 'ROAD GRADER' }, { value: 62, label: 'ROCK SAWS' }, { value: 63, label: 'ROLLERS' },
  { value: 64, label: 'ROTOMILLS' }, { value: 65, label: 'ROTOMILL ATTACHMENTS' }, { value: 66, label: 'ROUTERS' },
  { value: 67, label: 'SANDBLASTERS' }, { value: 68, label: 'SHOT BLASTER' }, { value: 69, label: 'STRUCTURAL IMAGING' },
  { value: 70, label: 'SAWS' }, { value: 71, label: 'RAISED PAVEMENT SAW' }, { value: 72, label: 'SLIP FORM PAVER' },
  { value: 73, label: 'STRAW BLOWER' }, { value: 74, label: 'STRIPPING WAGONS' }, { value: 75, label: 'SURVEY EQUIPMENT' },
  { value: 76, label: 'SWEEPER TRUCKS' }, { value: 77, label: 'BOX TRAILERS' }, { value: 78, label: 'DROP DECK TRAILER' },
  { value: 79, label: 'FLAT BED TRAILERS' }, { value: 80, label: 'GROUT SILO TRAILER' }, { value: 81, label: 'HOT BOX TRAILERS' },
  { value: 82, label: 'LOWBOY TRAILERS' }, { value: 83, label: 'TRAILERS' }, { value: 84, label: 'TRENCHER' },
  { value: 85, label: 'TRENCHER TRUCK' }, { value: 86, label: 'TRUCK TRACTORS' }, { value: 87, label: 'TUGS' },
  { value: 88, label: 'WALL SAWS' }, { value: 89, label: 'HYDRO POWER PACK' }, { value: 90, label: 'WATER BLASTERS' },
  { value: 91, label: 'WELDERS' }, { value: 92, label: 'POWER WELDER ATTACHMENT' }, { value: 93, label: 'WOOD CHIPPER' },
] as const;

export function categoryLabel(value?: number) {
  if (value == null) return '';
  return EQUIPMENT_CATEGORIES.find(c => c.value === value)?.label ?? '';
}
