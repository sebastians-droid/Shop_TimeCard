import type { ShopEmployee } from '@/models/shop-employee';

export type AppShopEmployee = ShopEmployee & {
  employeeName: string;
  employeeCode: number;
};

export const mapShopEmployees = (employees: ShopEmployee[]): AppShopEmployee[] =>
  employees
    .map((employee: ShopEmployee) => ({
      ...employee,
      empNum: Number(employee.empNum),
    }))
    .filter((employee: ShopEmployee) => Number.isFinite(employee.empNum) && (employee.empNum as number) > 0)
    .map((employee: ShopEmployee) => ({
      ...employee,
      employeeName: employee.employee?.name1 || employee.autoNumber || `Employee ${employee.empNum}`,
      employeeCode: employee.empNum as number,
    }))
    .sort((employeeA: AppShopEmployee, employeeB: AppShopEmployee) => employeeA.employeeName.localeCompare(employeeB.employeeName));
