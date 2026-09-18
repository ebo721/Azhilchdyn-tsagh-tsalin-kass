  eightHourDays: number;
  twelveHourDays: number;
  leaveDays: number;
}

export type PayrollLineEmployeeType = typeof PayrollLineEmployeeType[keyof typeof PayrollLineEmployeeType];


export const PayrollLineEmployeeType = {
  shift: 'shift',
  office: 'office',
} as const;

export interface PayrollLine {
  employeeId: number;
  employeeName: string;
  role: string;
  employeeType: PayrollLineEmployeeType;
  daysWorked: number;
  hours: number;
  gross: number;
  socialInsuranceSalary: number;
  socialInsurance: number;
  taxableIncome: number;
  calculatedIncomeTax: number;
  taxRelief: number;
  incomeTax: number;
  advanceAmount: number;
  manualDeduction: number;
  deductions: number;
  carryoverAmount: number;
  payable: number;
  paidAmount: number;
  /** @nullable */
  paymentDate: string | null;
  secondPaidAmount: number;
  /** @nullable */
  secondPaymentDate: string | null;
  remainingAmount: number;
  overpaidAmount: number;
  balanceAmount: number;
  net: number;
}

export interface PayrollAdjustment {
  employeeId: number;
  month: string;
  taxRelief: number;
  manualDeduction: number;
  paidAmount: number;
  /** @nullable */
  paymentDate?: string | null;
  secondPaidAmount: number;
  /** @nullable */
  secondPaymentDate?: string | null;
}

export interface PayrollAdjustmentInput {
  employeeId: number;
  /** @pattern ^\d{4}-(0[1-9]|1[0-2])$ */
  month: string;
  /** @minimum 0 */
  manualDeduction: number;
  /** @minimum 0 */
  paidAmount: number;
  /** @nullable */
  paymentDate?: string | null;
  /** @minimum 0 */
  secondPaidAmount: number;
  /** @nullable */
  secondPaymentDate?: string | null;
}

export interface PayrollSchedule {
  id: number;
  /** @pattern ^\d{4}-(0[1-9]|1[0-2])$ */
  effectiveFromMonth: string;
  /**
     * @minimum 1
     * @maximum 31
     */
  periodStartDay: number;
  /**
     * @minimum 1
     * @maximum 31
     */
  advanceCutoffDay: number;
  /**
     * @minimum 1
     * @maximum 31
     */
  periodEndDay: number;
  /**
     * @minimum 1
     * @maximum 31
     */
  advancePayDay: number;
  /**
     * @minimum 1
     * @maximum 31
     */
  finalPayDay: number;
}

export interface PayrollSummary {
  month: string;
  /** @pattern ^\d{4}-\d{2}-\d{2}$ */
  periodStart: string;
  /** @pattern ^\d{4}-\d{2}-\d{2}$ */
  advancePeriodEnd: string;
  /** @pattern ^\d{4}-\d{2}-\d{2}$ */
  periodEnd: string;
  /** @pattern ^\d{4}-\d{2}-\d{2}$ */
  advancePaymentDate: string;
  /** @pattern ^\d{4}-\d{2}-\d{2}$ */
  finalPaymentDate: string;
  schedule: PayrollSchedule;
  totalGross: number;
  totalSocialInsurance: number;
  totalIncomeTax: number;
  totalDeductions: number;
  totalNet: number;
  lines: PayrollLine[];
}

export type PayrollAdvanceLineEmployeeType = typeof PayrollAdvanceLineEmployeeType[keyof typeof PayrollAdvanceLineEmployeeType];


export const PayrollAdvanceLineEmployeeType = {
  shift: 'shift',
  office: 'office',
} as const;

export interface PayrollAdvanceLine {
  employeeId: number;
  employeeName: string;
  employeeType: PayrollAdvanceLineEmployeeType;
  baseSalary: number;
  daysWorked: number;
  dailySalary: number;
  totalSalary: number;
  advanceAmount: number;
  paid: boolean;
  /** @nullable */
  paymentDate?: string | null;
}

export interface PayrollAdvanceSummary {
  month: string;
  /** @pattern ^\d{4}-\d{2}-\d{2}$ */
  periodStart: string;
  /** @pattern ^\d{4}-\d{2}-\d{2}$ */
  advancePeriodEnd: string;
  /** @pattern ^\d{4}-\d{2}-\d{2}$ */
  periodEnd: string;
  /** @pattern ^\d{4}-\d{2}-\d{2}$ */
  advancePaymentDate: string;
  /** @pattern ^\d{4}-\d{2}-\d{2}$ */
  finalPaymentDate: string;
  schedule: PayrollSchedule;
  approved: boolean;
  /** @nullable */
  approvalDate: string | null;
  approvedAt?: string;
  totalAmount: number;
  lines: PayrollAdvanceLine[];
}

export interface PayrollAdvanceApprovalInput {
  /** @pattern ^\d{4}-(0[1-9]|1[0-2])$ */
  month: string;
  /** @pattern ^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$ */
  approvalDate: string;
}

export interface PayrollAdvancePaymentInput {
  /** @pattern ^\d{4}-(0[1-9]|1[0-2])$ */
  month: string;
  employeeId: number;
  /** @minimum 0 */
  advanceAmount: number;
  paid: boolean;
  /** @nullable */
  paymentDate?: string | null;
}

export interface PayrollScheduleInput {
  /**
     * @minimum 1
     * @maximum 31
     */
  periodStartDay: number;
  /**
     * @minimum 1
     * @maximum 31
     */
  advanceCutoffDay: number;
  /**
     * @minimum 1
     * @maximum 31
     */
  periodEndDay: number;
  /**
     * @minimum 1
     * @maximum 31
     */
  advancePayDay: number;
  /**
     * @minimum 1
     * @maximum 31
     */
  finalPayDay: number;
}

export type CashTransactionType = typeof CashTransactionType[keyof typeof CashTransactionType];


export const CashTransactionType = {
  income: 'income',
  expense: 'expense',
} as const;

export type CashTransactionTransactionKind = typeof CashTransactionTransactionKind[keyof typeof CashTransactionTransactionKind];


export const CashTransactionTransactionKind = {
  manual: 'manual',
  payroll: 'payroll',
  payroll_advance: 'payroll_advance',
  inventory_purchase: 'inventory_purchase',
  fixed_asset_purchase: 'fixed_asset_purchase',
  operating_expense: 'operating_expense',
  bank_transaction: 'bank_transaction',
} as const;

export interface CashTransaction {
  id: number;
  type: CashTransactionType;
  category: string;
  /** @nullable */
  subcategory: string | null;
  /** @nullable */
  accountId: number | null;
  /** @nullable */
  accountCode: string | null;
  /** @nullable */
  accountName: string | null;
  description: string;
  amount: number;
  date: string;
  /**
     * @nullable
     * @pattern ^\d{4}-(0[1-9]|1[0-2])$
     */
  incomeMonth: string | null;
  /** @nullable */
  bankTransactionId: number | null;
  /** @nullable */
  bankVerifiedAt: string | null;
  createdAt: string;
  editable: boolean;
  transactionKind: CashTransactionTransactionKind;
}

export interface BankAccount {
  id: number;
  bankName: string;
  accountNumber: string;
  createdAt: string;
}

export interface BankAccountInput {
  /**
     * @minLength 1
     * @maxLength 100
     */
  bankName: string;
  /**
     * @minLength 1
     * @maxLength 100
     */
  accountNumber: string;
}

export type UnclearTransactionSource = typeof UnclearTransactionSource[keyof typeof UnclearTransactionSource];


export const UnclearTransactionSource = {
  bank: 'bank',
  cash: 'cash',
} as const;

export type UnclearTransactionType = typeof UnclearTransactionType[keyof typeof UnclearTransactionType];


export const UnclearTransactionType = {
  income: 'income',
  expense: 'expense',
} as const;

export interface UnclearTransaction {
  id: number;
  source: UnclearTransactionSource;
  type: UnclearTransactionType;
  description: string;
  amount: number;
  occurredAt: string;
  /** @nullable */
  account?: string | null;
  /** @nullable */
  category?: string | null;
  unclearAt: string;
}

export type UnclearTransactionList = UnclearTransaction[];

export interface BankTransactionCashTransferInput {
  /**
     * @minLength 1
     * @maxLength 200
     */
  category: string;
  /**
     * @nullable
     * @pattern ^\d{4}-(0[1-9]|1[0-2])$
     */
  incomeMonth: string | null;
}

export interface BankTransactionCashLinkInput {
  /** @minimum 1 */
  cashTransactionId: number;
}

export type CashTransactionSuggestionType = typeof CashTransactionSuggestionType[keyof typeof CashTransactionSuggestionType];


export const CashTransactionSuggestionType = {
  income: 'income',
  expense: 'expense',
} as const;

export type CashTransactionSuggestionTransactionKind = typeof CashTransactionSuggestionTransactionKind[keyof typeof CashTransactionSuggestionTransactionKind];


export const CashTransactionSuggestionTransactionKind = {
  manual: 'manual',
  payroll: 'payroll',
  payroll_advance: 'payroll_advance',
  inventory_purchase: 'inventory_purchase',
  fixed_asset_purchase: 'fixed_asset_purchase',
  operating_expense: 'operating_expense',
  bank_transaction: 'bank_transaction',
} as const;

export interface CashTransactionSuggestion {
  id: number;
  type: CashTransactionSuggestionType;
  category: string;
  /** @nullable */
  subcategory: string | null;
  description: string;
  amount: number;
  date: string;
  /** @nullable */
  bankTransactionId: number | null;
  /** @nullable */
  bankVerifiedAt: string | null;
  createdAt: string;
  editable: boolean;
  transactionKind: CashTransactionSuggestionTransactionKind;
  score: number;
}

export type CashTransactionInputType = typeof CashTransactionInputType[keyof typeof CashTransactionInputType];


export const CashTransactionInputType = {
  income: 'income',
  expense: 'expense',
} as const;

export interface CashTransactionInput {
  type: CashTransactionInputType;
  /** @minLength 1 */
  category: string;
  /** @minLength 1 */
  description: string;
  /** @minimum 0 */
  amount: number;
  date: string;
  /**
     * @nullable
     * @pattern ^\d{4}-(0[1-9]|1[0-2])$
     */
  incomeMonth: string | null;
}

export interface CashIncomeMonthUpdate {
  /** @pattern ^\d{4}-(0[1-9]|1[0-2])$ */
  incomeMonth: string;
}

export interface CashClosure {
  id: number;
  date: string;
  closedAt: string;
}

export interface CashClosureInput {
  /** @pattern ^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$ */
  date: string;
}

export interface CashSummary {
  balance: number;
  income: number;
  expense: number;
  todayIncome: number;
  todayExpense: number;
}

export type BankTransactionType = typeof BankTransactionType[keyof typeof BankTransactionType];


export const BankTransactionType = {
  income: 'income',
  expense: 'expense',
} as const;

export interface BankTransaction {
  id: number;
  transactionAt: string;
  type: BankTransactionType;
  amount: number;
  /** @nullable */
  accountId: number | null;
  /** @nullable */
  accountCode: string | null;
  /** @nullable */
  accountName: string | null;
  account: string;
  counterparty: string;
  description: string;
  /** @nullable */
  executedAt: string | null;
  /** @nullable */
  balance: number | null;
  /** @nullable */
  transferredAt: string | null;
  /** @nullable */
  cashTransactionId: number | null;
  /** @nullable */
  bankAccountId: number | null;
  /** @nullable */
  bankName: string | null;
  /** @nullable */
  bankAccountNumber: string | null;
  createdAt: string;
}

export interface BankTransactionAccountInput {
  /**
     * @minimum 1
     * @nullable
     */
  accountId: number | null;
}

export type BankTransactionJournalReviewItemType = typeof BankTransactionJournalReviewItemType[keyof typeof BankTransactionJournalReviewItemType];


export const BankTransactionJournalReviewItemType = {
  income: 'income',
  expense: 'expense',
} as const;

export type BankTransactionPurchaseMatchType = typeof BankTransactionPurchaseMatchType[keyof typeof BankTransactionPurchaseMatchType];


export const BankTransactionPurchaseMatchType = {
  inventory_purchase: 'inventory_purchase',
  operating_expense: 'operating_expense',
} as const;

export interface BankTransactionPurchaseMatch {
  type: BankTransactionPurchaseMatchType;
  /** @minimum 1 */
  id: number;
}

export interface BankTransactionJournalReviewItem {
  id: number;
  /** @pattern ^\d{4}-\d{2}-\d{2}$ */
  date: string;
  transactionAt: string;
  type: BankTransactionJournalReviewItemType;
  description: string;
  amount: number;
  counterparty: string;
  /** @nullable */
  suggestedAccountId: number | null;
  /** @nullable */
  suggestedAccountName: string | null;
  existingPurchaseMatch?: BankTransactionPurchaseMatch;
}

export interface ExistingInventoryPurchaseLink {
  /** @minimum 1 */
  inventoryPurchaseId: number;
}

export type InventoryPurchaseInputMaterialType = typeof InventoryPurchaseInputMaterialType[keyof typeof InventoryPurchaseInputMaterialType];


export const InventoryPurchaseInputMaterialType = {
  food: 'food',
  supply: 'supply',
} as const;

export type InventoryPurchaseItemInputUnit = typeof InventoryPurchaseItemInputUnit[keyof typeof InventoryPurchaseItemInputUnit];


export const InventoryPurchaseItemInputUnit = {
  ширхэг: 'ширхэг',
  кг: 'кг',
  грамм: 'грамм',
  литр: 'литр',
  мл: 'мл',
  метр: 'метр',
  багц: 'багц',
  хайрцаг: 'хайрцаг',
} as const;

export interface InventoryPurchaseItemInput {
  inventoryItemId?: number;
  /** @minLength 1 */
  name: string;
  /** @minLength 1 */
  category: string;
  unit: InventoryPurchaseItemInputUnit;
  /** @exclusiveMinimum 0 */
  quantity: number;
  /** @minimum 0 */
  unitPrice: number;
}

export interface InventoryPurchaseInput {
  materialType: InventoryPurchaseInputMaterialType;
  /** @minLength 1 */
  supplierName: string;
  hasReceipt: boolean;
  /** @pattern ^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$ */
  date: string;
  /** @minItems 1 */
  items: InventoryPurchaseItemInput[];
}

export type BankPurchaseLinkInput = ExistingInventoryPurchaseLink | InventoryPurchaseInput;

export interface BankPurchaseLinkResult {
  /** @minimum 1 */
  bankTransactionId: number;
  /** @minimum 1 */
  inventoryPurchaseId: number;
  /** @minimum 1 */
  cashTransactionId: number;
  /** @minimum 1 */
  journalEntryId: number;
}

export interface ExistingOperatingExpenseLink {
  /** @minimum 1 */
  operatingExpenseId: number;
}

export interface OperatingExpenseInput {
  /** @minLength 1 */
  description: string;
  /** @minimum 1 */
  accountId: number;
  /** @pattern ^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$ */
  date: string;
  /** @exclusiveMinimum 0 */
  amount: number;
}

export type BankExpenseLinkInput = ExistingOperatingExpenseLink | OperatingExpenseInput;

export interface BankExpenseLinkResult {
  /** @minimum 1 */
  bankTransactionId: number;
  /** @minimum 1 */
  operatingExpenseId: number;
  /** @minimum 1 */
  cashTransactionId: number;
  /** @minimum 1 */
  journalEntryId: number;
}

export interface ExistingFixedAssetLink {
  /** @minimum 1 */
  fixedAssetId: number;
}

export interface NewFixedAssetBankPurchaseInput {
  /** @minLength 1 */
  name: string;
  /** @exclusiveMinimum 0 */
  unitPrice: number;
  /** @minimum 1 */
  quantity: number;
  /** @pattern ^\d{4}-\d{2}-\d{2}$ */
  date: string;
}

export type BankFixedAssetLinkInput = ExistingFixedAssetLink | NewFixedAssetBankPurchaseInput;

export interface BankFixedAssetLinkResult {
  /** @minimum 1 */
  bankTransactionId: number;
  /** @minimum 1 */
  fixedAssetId: number;
  /** @minimum 1 */
  cashTransactionId: number;
  /** @minimum 1 */
  journalEntryId: number;
}

export interface BankTransactionJournalPostInput {
  /** @minimum 1 */
  accountId: number;
}

export interface BankTransactionJournalPostResult {
  id: number;
  journalEntryId: number;
}

export interface BankTransactionImportResult {
  /** @minimum 0 */
  imported: number;
  /** @minimum 0 */
  skippedDuplicate: number;
  /** @minimum 0 */
  skippedZero: number;
  /** @minimum 0 */
  totalRead: number;
  /** @minimum 0 */
  recognized: number;
  /** @minimum 0 */
  unrecognized: number;
  /** @items.minimum 1 */
  transactionIds: number[];
}

export interface InventoryPurchaseItem {
  id: number;
  inventoryItemId: number;
  name: string;
  category: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
}

export type InventoryPurchaseMaterialType = typeof InventoryPurchaseMaterialType[keyof typeof InventoryPurchaseMaterialType];


export const InventoryPurchaseMaterialType = {
  food: 'food',
  supply: 'supply',
} as const;

export interface InventoryPurchase {
  id: number;
  materialType: InventoryPurchaseMaterialType;
  accountId: number | null;
  accountCode: string | null;
  accountName: string | null;
  supplierName: string;
  hasReceipt: boolean;
  date: string;
  totalAmount: number;
  paid: boolean;
  paymentDate?: string | null;
  paymentAmount?: number | null;
  createdAt: string;
  editable: boolean;
  items: InventoryPurchaseItem[];
}

export interface InventoryPurchasePaymentInput {
  /** @pattern ^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$ */
  date: string;
  /** @exclusiveMinimum 0 */
  amount: number;
  /** @nullable */
  bankTransactionId?: number | null;
}

export interface InventoryPurchaseBankSuggestion {
  id: number;
  transactionAt: string;
  amount: number;
  description: string;
  score: number;
}

export interface ReclassifyInventoryPurchaseAsExpenseInput {
  /** @minimum 1 */
  accountId: number;
}

export interface InventorySupplierUpdate {
  /** @minLength 1 */
  name: string;
}

export interface InventorySupplierItem {
  name: string;
  unit: string;
  quantity: number;
  totalAmount: number;
}

export interface InventorySupplier {
  id: number;
  name: string;
  purchaseCount: number;
  totalAmount: number;
  /** totalAmount minus what has actually been paid across this supplier's purchases */
  unpaidAmount: number;
  items: InventorySupplierItem[];
}

export type InventoryItemMaterialType = typeof InventoryItemMaterialType[keyof typeof InventoryItemMaterialType];


export const InventoryItemMaterialType = {
  food: 'food',
  supply: 'supply',
} as const;

export interface InventoryItem {
  id: number;
  materialType: InventoryItemMaterialType;
  name: string;
  category: string;
  unit: string;
  quantity: number;
  /** FIFO value of remaining stock (sum of unconsumed purchase lots at their original unit price) */
  totalValue: number;
  createdAt: string;
}

export interface InventoryItemUpdate {
  /** @minLength 1 */
  name: string;
  /** @minLength 1 */
  category: string;
}

export interface InventoryIssue {
  id: number;
  inventoryItemId: number;
  itemName: string;
  unit: string;
  date: string;
  quantity: number;
  /** FIFO cost of the stock consumed by this issue */
  totalCost: number;
  purpose: string;
  createdAt: string;
}

export interface InventoryIssueInput {
  inventoryItemId: number;
  /** @pattern ^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$ */
  date: string;
  /** @exclusiveMinimum 0 */
  quantity: number;
  /** @minLength 1 */
  purpose: string;
}

export interface OperatingExpense {
  id: number;
  description: string;
  category: string;
  accountId: number;
  /** @pattern ^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$ */
  date: string;
  /** @minimum 0 */
  amount: number;
  /** @nullable */
  paymentDate: string | null;
  /** @nullable */
  paymentAmount: number | null;
  /** @nullable */
  bankTransactionId: number | null;
  /** @nullable */
  cashTransactionId: number | null;
  createdAt: string;
}

export interface OperatingExpensePaymentInput {
  /** @pattern ^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$ */
  date: string;
  /** @exclusiveMinimum 0 */
  amount: number;
  /** @minimum 1 */
  bankTransactionId?: number;
}

export interface OperatingExpenseBankSuggestion {
  id: number;
  transactionAt: string;
  amount: number;
  description: string;
  score: number;
}

export interface FixedAsset {
  id: number;
  name: string;
  unitPrice: number;
  quantity: number;
  totalAmount: number;
  date: string;
  purchased: boolean;
  /**
     * @minimum 1
     * @nullable
     */
  bankTransactionId: number | null;
  createdAt: string;
}

export interface FixedAssetInput {
  /** @minLength 1 */
  name: string;
  /** @exclusiveMinimum 0 */
  unitPrice: number;
  /** @minimum 1 */
  quantity: number;
  /** @pattern ^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$ */
  date: string;
  purchased: boolean;
}

export type DeletionRequestRequesterRole = typeof DeletionRequestRequesterRole[keyof typeof DeletionRequestRequesterRole];


export const DeletionRequestRequesterRole = {
  admin: 'admin',
  hr: 'hr',
  accountant: 'accountant',
  warehouse: 'warehouse',
} as const;

export type DeletionRequestStatus = typeof DeletionRequestStatus[keyof typeof DeletionRequestStatus];


export const DeletionRequestStatus = {
  pending: 'pending',
  executing: 'executing',
  completed: 'completed',
  failed: 'failed',
  cancelled: 'cancelled',
} as const;

export interface DeletionRequest {
  id: number;
  targetPath: string;
  label: string;
  requesterRole: DeletionRequestRequesterRole;
  status: DeletionRequestStatus;
  requestedAt: string;
  /** @nullable */
  approvedAt?: string | null;
  /** @nullable */
  completedAt?: string | null;
  /** @nullable */
  error?: string | null;
}

export interface DeletionRequestInput {
  /** @minLength 1 */
  targetPath: string;
  /** @minLength 1 */
  label: string;
}

/**
 * Invalid request
 */
export type BadRequestResponse = ErrorResponse;

/**
 * Resource not found
 */
export type NotFoundResponse = ErrorResponse;

/**
 * Operation conflicts with the current resource state
 */
export type ConflictResponse = ErrorResponse;

export type JournalDateFromParameter = JournalDate;

export type JournalDateToParameter = JournalDate;

export type JournalSourceTypeParameter = string;

export type JournalAccountIdParameter = number;

export type JournalStatusParameter = typeof JournalStatusParameter[keyof typeof JournalStatusParameter];


export const JournalStatusParameter = {
  draft: 'draft',
  posted: 'posted',
  void: 'void',
} as const;

export type ListAttendanceParams = {
date?: string;
/**
 * @pattern ^\d{4}-(0[1-9]|1[0-2])$
 */
month?: string;
};

export type DeleteAttendanceParams = {
employeeId: number;
date: string;
};

export type ListShiftPlansParams = {
/**
 * @pattern ^\d{4}-(0[1-9]|1[0-2])$
 */
month: string;
};

export type GetPayrollParams = {
/**
 * @pattern ^\d{4}-(0[1-9]|1[0-2])$
 */
month?: string;
};

export type GetPayrollAdvanceParams = {
/**
 * @pattern ^\d{4}-(0[1-9]|1[0-2])$
 */
month?: string;
};

export type RevertPayrollAdvanceApprovalParams = {
/**
 * @pattern ^\d{4}-(0[1-9]|1[0-2])$
 */
month: string;
};

export type GetHourBalanceParams = {
/**
 * @pattern ^\d{4}-(0[1-9]|1[0-2])$
 */
month?: string;
};

export type ImportKapitronBankTransactionsParams = {
/**
 * @minimum 1
 */
bankAccountId: number;
};

export type ListJournalEntriesParams = {
/**
 * @pattern ^\d{4}-\d{2}-\d{2}$
 */
dateFrom?: JournalDateFromParameter;
/**
 * @pattern ^\d{4}-\d{2}-\d{2}$
 */
dateTo?: JournalDateToParameter;
sourceType?: JournalSourceTypeParameter;
/**
 * @minimum 1
 */
accountId?: JournalAccountIdParameter;
status?: JournalStatusParameter;
};

