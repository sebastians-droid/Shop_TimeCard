export interface Employee {
  id: string;
  name1: string;
}

export interface ShopEmployee {
  id: string;
  autoNumber: string;
  employee?: Pick<Employee, 'id' | 'name1'>;
  empNum?: number;
}
