import type { ShopEmployee } from '@/models/shop-employee';

export type AppShopEmployee = ShopEmployee & {
  employeeName: string;
  employeeCode: number;
  isRoadMech: boolean;
  isAdmin: boolean;
  isPartsRunner: boolean;
};

const NAME_SUFFIXES = new Set(['JR', 'SR', 'II', 'III', 'IV', 'V']);
const LAST_NAME_PARTICLES = new Set(['VAN', 'VON', 'DE', 'DEL', 'DA', 'DI', 'LA', 'LE', 'ST', 'SAINT', 'DER', 'DEN', 'TER']);

function tokenizeName(value: string): string[] {
  return value.trim().split(/\s+/).filter(Boolean);
}

function isSuffix(token: string): boolean {
  return NAME_SUFFIXES.has(token.replace(/\./g, '').toUpperCase());
}

function isParticle(token: string): boolean {
  return LAST_NAME_PARTICLES.has(token.replace(/\./g, '').toUpperCase());
}

function toMiddleInitial(token: string): string {
  const letter = token.replace(/\./g, '').trim();
  return letter ? letter[0].toUpperCase() : '';
}

function formatGivenNames(tokens: string[]): string {
  if (tokens.length === 0) return '';
  const [first, ...middle] = tokens;
  const initials = middle.map(toMiddleInitial).filter(Boolean).join(' ');
  return initials ? `${first} ${initials}` : first;
}

function takeLastName(tokens: string[]): { last: string; given: string[] } {
  if (tokens.length === 0) return { last: '', given: [] };
  if (tokens.length === 1) return { last: tokens[0], given: [] };

  let lastStart = tokens.length - 1;
  while (lastStart > 1 && isParticle(tokens[lastStart - 1])) {
    lastStart -= 1;
  }

  return {
    last: tokens.slice(lastStart).join(' '),
    given: tokens.slice(0, lastStart),
  };
}

/**
 * ComputerEase stores names as FIRST M LAST. Shop screens always show
 * LAST, FIRST M so lists sort by last name.
 */
export function formatEmployeeDisplayName(raw?: string | null): string {
  const trimmed = (raw ?? '').trim().replace(/\s+/g, ' ');
  if (!trimmed) return '';

  if (trimmed.includes(',')) {
    const [lastPart, ...rest] = trimmed.split(',');
    const last = lastPart.trim();
    const given = formatGivenNames(tokenizeName(rest.join(',')));
    return given ? `${last}, ${given}` : last;
  }

  const tokens = tokenizeName(trimmed);
  if (tokens.length < 2) return trimmed;

  let suffix = '';
  if (tokens.length >= 3 && isSuffix(tokens[tokens.length - 1])) {
    suffix = tokens.pop()!.replace(/\./g, '').toUpperCase();
  }

  const { last, given } = takeLastName(tokens);
  const givenNames = formatGivenNames(given);
  const lastWithSuffix = suffix ? `${last} ${suffix}` : last;
  return givenNames ? `${lastWithSuffix}, ${givenNames}` : lastWithSuffix;
}

export function shopEmployeeDisplayName(employee: Pick<ShopEmployee, 'autoNumber' | 'employee'>): string {
  return formatEmployeeDisplayName(employee.employee?.name1) || employee.autoNumber || '—';
}

export type EmployeeMechanicType = 'admin' | 'partsRunner' | 'road' | 'shop';

export const MECHANIC_TYPE_ORDER: EmployeeMechanicType[] = ['shop', 'road', 'partsRunner', 'admin'];

export function employeeMechanicType(employee: {
  isRoadMech?: boolean;
  isAdmin?: boolean;
  isPartsRunner?: boolean;
}): EmployeeMechanicType {
  if (employee.isAdmin) return 'admin';
  if (employee.isPartsRunner) return 'partsRunner';
  if (employee.isRoadMech) return 'road';
  return 'shop';
}

export function employeeMechanicTypeLabel(employee: {
  isRoadMech?: boolean;
  isAdmin?: boolean;
  isPartsRunner?: boolean;
}): string {
  switch (employeeMechanicType(employee)) {
    case 'admin':
      return 'Admin';
    case 'partsRunner':
      return 'Parts runner';
    case 'road':
      return 'Road mechanic';
    case 'shop':
      return 'Shop mechanic';
  }
}

export function compareEmployeesByTypeThenName(
  employeeA: { isRoadMech?: boolean; isAdmin?: boolean; isPartsRunner?: boolean },
  employeeB: { isRoadMech?: boolean; isAdmin?: boolean; isPartsRunner?: boolean },
  nameA: string,
  nameB: string,
): number {
  const typeOrder = MECHANIC_TYPE_ORDER.indexOf(employeeMechanicType(employeeA)) - MECHANIC_TYPE_ORDER.indexOf(employeeMechanicType(employeeB));
  return typeOrder !== 0 ? typeOrder : nameA.localeCompare(nameB);
}

export const mapShopEmployees = (employees: ShopEmployee[]): AppShopEmployee[] =>
  employees
    .map((employee: ShopEmployee) => ({
      ...employee,
      empNum: Number(employee.empNum),
    }))
    .filter((employee: ShopEmployee) => Number.isFinite(employee.empNum) && (employee.empNum as number) > 0)
    .map((employee: ShopEmployee) => ({
      ...employee,
      employeeName: formatEmployeeDisplayName(employee.employee?.name1) || employee.autoNumber || `Employee ${employee.empNum}`,
      employeeCode: employee.empNum as number,
      isRoadMech: employee.isRoadMech === true,
      isAdmin: employee.isAdmin === true,
      isPartsRunner: employee.isPartsRunner === true,
    }))
    .sort((employeeA: AppShopEmployee, employeeB: AppShopEmployee) => employeeA.employeeName.localeCompare(employeeB.employeeName));
