export interface Employee {
  id: string;
  name1: string;
}

export interface ShopEmployee {
  id: string;
  autoNumber: string;
  employee?: Pick<Employee, 'id' | 'name1'>;
  empNum?: number;
  /** Road mechanics have no scheduled start; their paid day begins at clock-in. */
  isRoadMech?: boolean;
  /** Admin staff punch in/out on their own account; time is always Division 200 / Job 112. */
  isAdmin?: boolean;
}
