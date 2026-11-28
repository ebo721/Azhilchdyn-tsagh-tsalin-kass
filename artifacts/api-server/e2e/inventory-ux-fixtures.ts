import type { Page } from "@playwright/test";

/** Isolated browser data: this suite never reads or changes a real database. */
export async function mockInventoryUx(page: Page) {
  const purchases = Array.from({ length: 42 }, (_, index) => ({
    id: 98500 + index,
    documentNumber: `2098/06/14/${String(index + 1).padStart(3, "0")}`,
    materialType: "food",
    accountId: 1,
    accountCode: "1500",
    accountName: "Хүнс",
    supplierName: index === 0 ? "Онцгой харилцагч" : `Харилцагч ${index}`,
    responsibleName: "Нярав",
    hasReceipt: index % 2 === 0,
    date: "2098-06-14",
    totalAmount: 100,
    paid: index < 2,
    paymentDate: index < 2 ? "2098-06-15" : null,
    paymentAmount: index < 2 ? 100 : null,
    paymentGroupBankTransactionId: null,
    bankConnection: index < 2 ? {
      id: 98600 + index, kind: "single", amount: 100,
      transactionAt: "2098-06-15T09:00:00Z",
      description: "Хүнсний төлбөр", account: "Банкны данс",
    } : null,
    createdAt: "2098-06-14T00:00:00Z",
    editable: false,
    items: [{
      id: 98800 + index, name: index === 3 ? "Онцгой будаа" : "Гурил",
      category: "Хүнс", unit: "кг", quantity: 1, unitPrice: 100, totalAmount: 100,
    }],
  }));
  const pending = [
    { id: 98700, date: "2098-06-15", amount: 100, description: "Бүртгэх хүнсний төлбөр", bankAccount: "Тест", accountCode: "1500", accountName: "Хүнс", materialType: "food" },
    { id: 98701, date: "2098-06-16", amount: 200, description: "Хоёр дахь төлбөр", bankAccount: "Тест", accountCode: "1500", accountName: "Хүнс", materialType: "food" },
    { id: 98702, date: "2098-05-15", amount: 300, description: "Өмнөх сарын төлбөр", bankAccount: "Тест", accountCode: "1500", accountName: "Хүнс", materialType: "food" },
    { id: 98703, date: "2098-06-15", amount: 400, description: "Хангамжийн төлбөр", bankAccount: "Тест", accountCode: "1510", accountName: "Хангамж", materialType: "supply" },
  ];
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ json:
      path === "/api/auth/me" ? { authenticated: true, id: 1, username: "inventory-ux", role: "admin" } :
      path === "/api/inventory/purchases" ? purchases :
      path === "/api/inventory/pending-purchases" ? pending : [],
    });
  });
  return { purchases, pending };
}
