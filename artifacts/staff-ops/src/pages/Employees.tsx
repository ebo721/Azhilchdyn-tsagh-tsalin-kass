/**
 * Employee page entrypoint.
 *
 * The implementation is kept in App.tsx for this incremental extraction so
 * that the existing shared deletion queue and helper closures retain their
 * exact behavior. This module provides the requested page boundary.
 */
export {
  EmployeesImpl as Employees,
  EmployeeModal,
  SalaryHistoryRowEditor,
} from '@/App';