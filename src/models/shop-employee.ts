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
  /** Admin staff have no scheduled start; they clock in/out on Division 200 · Job 112. */
  isAdmin?: boolean;
}
