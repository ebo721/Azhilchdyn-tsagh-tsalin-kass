  "name": zod.string().min(1),
  "category": zod.string().min(1),
  "unit": zod.enum(['ширхэг', 'кг', 'грамм', 'литр', 'мл', 'метр', 'багц', 'хайрцаг']),
  "quantity": zod.number().gt(updateInventoryPurchaseBodyItemsItemQuantityExclusiveMin),
  "unitPrice": zod.number().min(updateInventoryPurchaseBodyItemsItemUnitPriceMin)
})).min(1)
})

export const UpdateInventoryPurchaseResponse = zod.object({
  "id": zod.number().int(),
  "materialType": zod.enum(['food', 'supply']),
  "accountId": zod.number().int().nullable(),
  "accountCode": zod.string().nullable(),
  "accountName": zod.string().nullable(),
  "supplierName": zod.string(),
  "hasReceipt": zod.boolean(),
  "date": zod.string(),
  "totalAmount": zod.number(),
  "paid": zod.boolean(),
  "paymentDate": zod.string().nullish(),
  "paymentAmount": zod.number().nullish(),
  "createdAt": zod.string(),
  "editable": zod.boolean(),
  "items": zod.array(zod.object({
  "id": zod.number().int(),
  "inventoryItemId": zod.number().int(),
  "name": zod.string(),
  "category": zod.string(),
  "unit": zod.string(),
  "quantity": zod.number(),
  "unitPrice": zod.number(),
  "totalAmount": zod.number()
}))
})


/**
 * @summary Delete inventory purchase, reverse stock and remove cash transaction
 */
export const DeleteInventoryPurchaseParams = zod.object({
  "id": zod.coerce.number().int()
})

export const DeleteInventoryPurchaseResponse = zod.void()


/**
 * @summary Mark an inventory purchase as paid and create its cash expense
 */
export const ConfirmInventoryPurchasePaymentParams = zod.object({
  "id": zod.coerce.number().int()
})

export const confirmInventoryPurchasePaymentBodyDateRegExp = new RegExp('^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])$');
export const confirmInventoryPurchasePaymentBodyAmountExclusiveMin = 0;



export const ConfirmInventoryPurchasePaymentBody = zod.object({
  "date": zod.string().regex(confirmInventoryPurchasePaymentBodyDateRegExp),
  "amount": zod.number().gt(confirmInventoryPurchasePaymentBodyAmountExclusiveMin),
  "bankTransactionId": zod.number().int().nullish()
})

export const ConfirmInventoryPurchasePaymentResponse = zod.object({
  "id": zod.number().int(),
  "materialType": zod.enum(['food', 'supply']),
  "accountId": zod.number().int().nullable(),
  "accountCode": zod.string().nullable(),
  "accountName": zod.string().nullable(),
  "supplierName": zod.string(),
  "hasReceipt": zod.boolean(),
  "date": zod.string(),
  "totalAmount": zod.number(),
  "paid": zod.boolean(),
  "paymentDate": zod.string().nullish(),
  "paymentAmount": zod.number().nullish(),
  "createdAt": zod.string(),
  "editable": zod.boolean(),
  "items": zod.array(zod.object({
  "id": zod.number().int(),
  "inventoryItemId": zod.number().int(),
  "name": zod.string(),
  "category": zod.string(),
  "unit": zod.string(),
  "quantity": zod.number(),
  "unitPrice": zod.number(),
  "totalAmount": zod.number()
}))
})


/**
 * @summary Cancel an inventory purchase payment and remove its cash expense
 */
export const CancelInventoryPurchasePaymentParams = zod.object({
  "id": zod.coerce.number().int()
})

export const CancelInventoryPurchasePaymentResponse = zod.object({
  "id": zod.number().int(),
  "materialType": zod.enum(['food', 'supply']),
  "accountId": zod.number().int().nullable(),
  "accountCode": zod.string().nullable(),
  "accountName": zod.string().nullable(),
  "supplierName": zod.string(),
  "hasReceipt": zod.boolean(),
  "date": zod.string(),
  "totalAmount": zod.number(),
  "paid": zod.boolean(),
  "paymentDate": zod.string().nullish(),
  "paymentAmount": zod.number().nullish(),
  "createdAt": zod.string(),
  "editable": zod.boolean(),
  "items": zod.array(zod.object({
  "id": zod.number().int(),
  "inventoryItemId": zod.number().int(),
  "name": zod.string(),
  "category": zod.string(),
  "unit": zod.string(),
  "quantity": zod.number(),
  "unitPrice": zod.number(),
  "totalAmount": zod.number()
}))
})


/**
 * @summary Suggest unlinked bank expenses for an inventory purchase payment
 */
export const ListInventoryPurchasePaymentBankSuggestionsParams = zod.object({
  "id": zod.coerce.number().int()
})

export const ListInventoryPurchasePaymentBankSuggestionsResponseItem = zod.object({
  "id": zod.number().int(),
  "transactionAt": zod.coerce.date(),
  "amount": zod.number(),
  "description": zod.string(),
  "score": zod.number()
})
export const ListInventoryPurchasePaymentBankSuggestionsResponse = zod.array(ListInventoryPurchasePaymentBankSuggestionsResponseItem)


/**
 * @summary Move a misclassified inventory purchase to operating expenses, choosing its category. Stock and any cash/bank link are carried over; blocked if the purchase's stock has already been issued.
 */
export const ReclassifyInventoryPurchaseAsExpenseParams = zod.object({
  "id": zod.coerce.number().int()
})




export const ReclassifyInventoryPurchaseAsExpenseBody = zod.object({
  "accountId": zod.number().int().min(1)
})

export const reclassifyInventoryPurchaseAsExpenseResponseDateRegExp = new RegExp('^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])$');
export const reclassifyInventoryPurchaseAsExpenseResponseAmountMin = 0;



export const ReclassifyInventoryPurchaseAsExpenseResponse = zod.object({
  "id": zod.number().int(),
  "description": zod.string(),
  "category": zod.string(),
  "accountId": zod.number().int(),
  "date": zod.string().regex(reclassifyInventoryPurchaseAsExpenseResponseDateRegExp),
  "amount": zod.number().min(reclassifyInventoryPurchaseAsExpenseResponseAmountMin),
  "paymentDate": zod.string().nullable(),
  "paymentAmount": zod.number().nullable(),
  "bankTransactionId": zod.number().int().nullable(),
  "cashTransactionId": zod.number().int().nullable(),
  "createdAt": zod.coerce.date()
})


export const listOperatingExpensesResponseDateRegExp = new RegExp('^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])$');
export const listOperatingExpensesResponseAmountMin = 0;



export const ListOperatingExpensesResponseItem = zod.object({
  "id": zod.number().int(),
  "description": zod.string(),
  "category": zod.string(),
  "accountId": zod.number().int(),
  "date": zod.string().regex(listOperatingExpensesResponseDateRegExp),
  "amount": zod.number().min(listOperatingExpensesResponseAmountMin),
  "paymentDate": zod.string().nullable(),
  "paymentAmount": zod.number().nullable(),
  "bankTransactionId": zod.number().int().nullable(),
  "cashTransactionId": zod.number().int().nullable(),
  "createdAt": zod.coerce.date()
})
export const ListOperatingExpensesResponse = zod.array(ListOperatingExpensesResponseItem)




export const createOperatingExpenseBodyDateRegExp = new RegExp('^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])$');
export const createOperatingExpenseBodyAmountExclusiveMin = 0;



export const CreateOperatingExpenseBody = zod.object({
  "description": zod.string().min(1),
  "accountId": zod.number().int().min(1),
  "date": zod.string().regex(createOperatingExpenseBodyDateRegExp),
  "amount": zod.number().gt(createOperatingExpenseBodyAmountExclusiveMin)
})

export const createOperatingExpenseResponseDateRegExp = new RegExp('^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])$');
export const createOperatingExpenseResponseAmountMin = 0;



export const CreateOperatingExpenseResponse = zod.object({
  "id": zod.number().int(),
  "description": zod.string(),
  "category": zod.string(),
  "accountId": zod.number().int(),
  "date": zod.string().regex(createOperatingExpenseResponseDateRegExp),
  "amount": zod.number().min(createOperatingExpenseResponseAmountMin),
  "paymentDate": zod.string().nullable(),
  "paymentAmount": zod.number().nullable(),
  "bankTransactionId": zod.number().int().nullable(),
  "cashTransactionId": zod.number().int().nullable(),
  "createdAt": zod.coerce.date()
})


export const UpdateOperatingExpenseParams = zod.object({
  "id": zod.coerce.number().int()
})



export const updateOperatingExpenseBodyDateRegExp = new RegExp('^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])$');
export const updateOperatingExpenseBodyAmountExclusiveMin = 0;



export const UpdateOperatingExpenseBody = zod.object({
  "description": zod.string().min(1),
  "accountId": zod.number().int().min(1),
  "date": zod.string().regex(updateOperatingExpenseBodyDateRegExp),
  "amount": zod.number().gt(updateOperatingExpenseBodyAmountExclusiveMin)
})

export const updateOperatingExpenseResponseDateRegExp = new RegExp('^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])$');
export const updateOperatingExpenseResponseAmountMin = 0;



export const UpdateOperatingExpenseResponse = zod.object({
  "id": zod.number().int(),
  "description": zod.string(),
  "category": zod.string(),
  "accountId": zod.number().int(),
  "date": zod.string().regex(updateOperatingExpenseResponseDateRegExp),
  "amount": zod.number().min(updateOperatingExpenseResponseAmountMin),
  "paymentDate": zod.string().nullable(),
  "paymentAmount": zod.number().nullable(),
  "bankTransactionId": zod.number().int().nullable(),
  "cashTransactionId": zod.number().int().nullable(),
  "createdAt": zod.coerce.date()
})


export const DeleteOperatingExpenseParams = zod.object({
  "id": zod.coerce.number().int()
})

export const DeleteOperatingExpenseResponse = zod.void()


export const ListOperatingExpensePaymentBankSuggestionsParams = zod.object({
  "id": zod.coerce.number().int()
})

export const ListOperatingExpensePaymentBankSuggestionsResponseItem = zod.object({
  "id": zod.number().int(),
  "transactionAt": zod.coerce.date(),
  "amount": zod.number(),
  "description": zod.string(),
  "score": zod.number()
})
export const ListOperatingExpensePaymentBankSuggestionsResponse = zod.array(ListOperatingExpensePaymentBankSuggestionsResponseItem)


export const ConfirmOperatingExpensePaymentParams = zod.object({
  "id": zod.coerce.number().int()
})

export const confirmOperatingExpensePaymentBodyDateRegExp = new RegExp('^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])$');
export const confirmOperatingExpensePaymentBodyAmountExclusiveMin = 0;




export const ConfirmOperatingExpensePaymentBody = zod.object({
  "date": zod.string().regex(confirmOperatingExpensePaymentBodyDateRegExp),
  "amount": zod.number().gt(confirmOperatingExpensePaymentBodyAmountExclusiveMin),
  "bankTransactionId": zod.number().int().min(1).optional()
})

export const confirmOperatingExpensePaymentResponseDateRegExp = new RegExp('^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])$');
export const confirmOperatingExpensePaymentResponseAmountMin = 0;



export const ConfirmOperatingExpensePaymentResponse = zod.object({
  "id": zod.number().int(),
  "description": zod.string(),
  "category": zod.string(),
  "accountId": zod.number().int(),
  "date": zod.string().regex(confirmOperatingExpensePaymentResponseDateRegExp),
  "amount": zod.number().min(confirmOperatingExpensePaymentResponseAmountMin),
  "paymentDate": zod.string().nullable(),
  "paymentAmount": zod.number().nullable(),
  "bankTransactionId": zod.number().int().nullable(),
  "cashTransactionId": zod.number().int().nullable(),
  "createdAt": zod.coerce.date()
})


export const CancelOperatingExpensePaymentParams = zod.object({
  "id": zod.coerce.number().int()
})

export const cancelOperatingExpensePaymentResponseDateRegExp = new RegExp('^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])$');
export const cancelOperatingExpensePaymentResponseAmountMin = 0;



export const CancelOperatingExpensePaymentResponse = zod.object({
  "id": zod.number().int(),
  "description": zod.string(),
  "category": zod.string(),
  "accountId": zod.number().int(),
  "date": zod.string().regex(cancelOperatingExpensePaymentResponseDateRegExp),
  "amount": zod.number().min(cancelOperatingExpensePaymentResponseAmountMin),
  "paymentDate": zod.string().nullable(),
  "paymentAmount": zod.number().nullable(),
  "bankTransactionId": zod.number().int().nullable(),
  "cashTransactionId": zod.number().int().nullable(),
  "createdAt": zod.coerce.date()
})


/**
 * @summary List inventory suppliers with aggregated purchases
 */
export const ListInventorySuppliersResponseItem = zod.object({
  "id": zod.number().int(),
  "name": zod.string(),
  "purchaseCount": zod.number().int(),
  "totalAmount": zod.number(),
  "unpaidAmount": zod.number().describe('totalAmount minus what has actually been paid across this supplier\'s purchases'),
  "items": zod.array(zod.object({
  "name": zod.string(),
  "unit": zod.string(),
  "quantity": zod.number(),
  "totalAmount": zod.number()
}))
})
export const ListInventorySuppliersResponse = zod.array(ListInventorySuppliersResponseItem)


/**
 * @summary Rename an inventory supplier and its purchase history
 */
export const UpdateInventorySupplierParams = zod.object({
  "id": zod.coerce.number().int()
})




export const UpdateInventorySupplierBody = zod.object({
  "name": zod.string().min(1)
})

export const UpdateInventorySupplierResponse = zod.object({
  "id": zod.number().int(),
  "name": zod.string(),
  "purchaseCount": zod.number().int(),
  "totalAmount": zod.number(),
  "unpaidAmount": zod.number().describe('totalAmount minus what has actually been paid across this supplier\'s purchases'),
  "items": zod.array(zod.object({
  "name": zod.string(),
  "unit": zod.string(),
  "quantity": zod.number(),
  "totalAmount": zod.number()
}))
})


/**
 * @summary Remove a supplier from the supplier directory without deleting purchase history
 */
export const DeleteInventorySupplierParams = zod.object({
  "id": zod.coerce.number().int()
})

export const DeleteInventorySupplierResponse = zod.void()


/**
 * @summary List inventory catalog and stock
 */
export const ListInventoryItemsResponseItem = zod.object({
  "id": zod.number().int(),
  "materialType": zod.enum(['food', 'supply']),
  "name": zod.string(),
  "category": zod.string(),
  "unit": zod.string(),
  "quantity": zod.number(),
  "totalValue": zod.number().describe('FIFO value of remaining stock (sum of unconsumed purchase lots at their original unit price)'),
  "createdAt": zod.string()
})
export const ListInventoryItemsResponse = zod.array(ListInventoryItemsResponseItem)


/**
 * @summary Update inventory item category
 */
export const UpdateInventoryItemParams = zod.object({
  "id": zod.coerce.number().int()
})





export const UpdateInventoryItemBody = zod.object({
  "name": zod.string().min(1),
  "category": zod.string().min(1)
})

export const UpdateInventoryItemResponse = zod.object({
  "id": zod.number().int(),
  "materialType": zod.enum(['food', 'supply']),
  "name": zod.string(),
  "category": zod.string(),
  "unit": zod.string(),
  "quantity": zod.number(),
  "totalValue": zod.number().describe('FIFO value of remaining stock (sum of unconsumed purchase lots at their original unit price)'),
  "createdAt": zod.string()
})


/**
 * @summary List inventory issues
 */
export const ListInventoryIssuesResponseItem = zod.object({
  "id": zod.number().int(),
  "inventoryItemId": zod.number().int(),
  "itemName": zod.string(),
  "unit": zod.string(),
  "date": zod.string(),
  "quantity": zod.number(),
  "totalCost": zod.number().describe('FIFO cost of the stock consumed by this issue'),
  "purpose": zod.string(),
  "createdAt": zod.string()
})
export const ListInventoryIssuesResponse = zod.array(ListInventoryIssuesResponseItem)


/**
 * @summary Issue inventory stock
 */
export const createInventoryIssueBodyDateRegExp = new RegExp('^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])$');
export const createInventoryIssueBodyQuantityExclusiveMin = 0;




export const CreateInventoryIssueBody = zod.object({
  "inventoryItemId": zod.number().int(),
  "date": zod.string().regex(createInventoryIssueBodyDateRegExp),
  "quantity": zod.number().gt(createInventoryIssueBodyQuantityExclusiveMin),
  "purpose": zod.string().min(1)
})

export const CreateInventoryIssueResponse = zod.object({
  "id": zod.number().int(),
  "inventoryItemId": zod.number().int(),
  "itemName": zod.string(),
  "unit": zod.string(),
  "date": zod.string(),
  "quantity": zod.number(),
  "totalCost": zod.number().describe('FIFO cost of the stock consumed by this issue'),
  "purpose": zod.string(),
  "createdAt": zod.string()
})


/**
 * @summary Update inventory issue and rebalance stock
 */
export const UpdateInventoryIssueParams = zod.object({
  "id": zod.coerce.number().int()
})

export const updateInventoryIssueBodyDateRegExp = new RegExp('^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])$');
export const updateInventoryIssueBodyQuantityExclusiveMin = 0;




export const UpdateInventoryIssueBody = zod.object({
  "inventoryItemId": zod.number().int(),
  "date": zod.string().regex(updateInventoryIssueBodyDateRegExp),
  "quantity": zod.number().gt(updateInventoryIssueBodyQuantityExclusiveMin),
  "purpose": zod.string().min(1)
})

export const UpdateInventoryIssueResponse = zod.object({
  "id": zod.number().int(),
  "inventoryItemId": zod.number().int(),
  "itemName": zod.string(),
  "unit": zod.string(),
  "date": zod.string(),
  "quantity": zod.number(),
  "totalCost": zod.number().describe('FIFO cost of the stock consumed by this issue'),
  "purpose": zod.string(),
  "createdAt": zod.string()
})


/**
 * @summary Delete inventory issue and restore stock
 */
export const DeleteInventoryIssueParams = zod.object({
  "id": zod.coerce.number().int()
})

export const DeleteInventoryIssueResponse = zod.void()


/**
 * @summary List equipment and fixed assets
 */



export const ListFixedAssetsResponseItem = zod.object({
  "id": zod.number().int(),
  "name": zod.string(),
  "unitPrice": zod.number(),
  "quantity": zod.number().int(),
  "totalAmount": zod.number(),
  "date": zod.string(),
  "purchased": zod.boolean(),
  "bankTransactionId": zod.number().int().min(1).nullable(),
  "createdAt": zod.string()
})
export const ListFixedAssetsResponse = zod.array(ListFixedAssetsResponseItem)


/**
 * @summary Register equipment or fixed asset
 */

export const createFixedAssetBodyUnitPriceExclusiveMin = 0;


export const createFixedAssetBodyDateRegExp = new RegExp('^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])$');


export const CreateFixedAssetBody = zod.object({
  "name": zod.string().min(1),
  "unitPrice": zod.number().gt(createFixedAssetBodyUnitPriceExclusiveMin),
  "quantity": zod.number().int().min(1),
  "date": zod.string().regex(createFixedAssetBodyDateRegExp),
  "purchased": zod.boolean()
})




export const CreateFixedAssetResponse = zod.object({
  "id": zod.number().int(),
  "name": zod.string(),
  "unitPrice": zod.number(),
  "quantity": zod.number().int(),
  "totalAmount": zod.number(),
  "date": zod.string(),
  "purchased": zod.boolean(),
  "bankTransactionId": zod.number().int().min(1).nullable(),
  "createdAt": zod.string()
})


/**
 * @summary Update equipment or fixed asset and its linked cash transaction
 */
export const UpdateFixedAssetParams = zod.object({
  "id": zod.coerce.number().int()
})


export const updateFixedAssetBodyUnitPriceExclusiveMin = 0;


export const updateFixedAssetBodyDateRegExp = new RegExp('^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])$');


export const UpdateFixedAssetBody = zod.object({
  "name": zod.string().min(1),
  "unitPrice": zod.number().gt(updateFixedAssetBodyUnitPriceExclusiveMin),
  "quantity": zod.number().int().min(1),
  "date": zod.string().regex(updateFixedAssetBodyDateRegExp),
  "purchased": zod.boolean()
})




export const UpdateFixedAssetResponse = zod.object({
  "id": zod.number().int(),
  "name": zod.string(),
  "unitPrice": zod.number(),
  "quantity": zod.number().int(),
  "totalAmount": zod.number(),
  "date": zod.string(),
  "purchased": zod.boolean(),
  "bankTransactionId": zod.number().int().min(1).nullable(),
  "createdAt": zod.string()
})


/**
 * @summary Delete equipment or fixed asset and its linked cash transaction
 */
export const DeleteFixedAssetParams = zod.object({
  "id": zod.coerce.number().int()
})

export const DeleteFixedAssetResponse = zod.void()


/**
 * @summary List deletion approval requests
 */
export const ListDeletionRequestsResponseItem = zod.object({
  "id": zod.number().int(),
  "targetPath": zod.string(),
  "label": zod.string(),
  "requesterRole": zod.enum(['admin', 'hr', 'accountant', 'warehouse']),
  "status": zod.enum(['pending', 'executing', 'completed', 'failed', 'cancelled']),
  "requestedAt": zod.string(),
  "approvedAt": zod.string().nullish(),
  "completedAt": zod.string().nullish(),
  "error": zod.string().nullish()
})
export const ListDeletionRequestsResponse = zod.array(ListDeletionRequestsResponseItem)


/**
 * @summary Queue an operation for admin deletion approval
 */




export const CreateDeletionRequestBody = zod.object({
  "targetPath": zod.string().min(1),
  "label": zod.string().min(1)
})

export const CreateDeletionRequestResponse = zod.object({
  "id": zod.number().int(),
  "targetPath": zod.string(),
  "label": zod.string(),
  "requesterRole": zod.enum(['admin', 'hr', 'accountant', 'warehouse']),
  "status": zod.enum(['pending', 'executing', 'completed', 'failed', 'cancelled']),
  "requestedAt": zod.string(),
  "approvedAt": zod.string().nullish(),
  "completedAt": zod.string().nullish(),
  "error": zod.string().nullish()
})


/**
 * @summary Approve and execute a queued deletion
 */
export const ApproveDeletionRequestParams = zod.object({
  "id": zod.coerce.number().int()
})

export const ApproveDeletionRequestResponse = zod.object({
  "id": zod.number().int(),
  "targetPath": zod.string(),
  "label": zod.string(),
  "requesterRole": zod.enum(['admin', 'hr', 'accountant', 'warehouse']),
  "status": zod.enum(['pending', 'executing', 'completed', 'failed', 'cancelled']),
  "requestedAt": zod.string(),
  "approvedAt": zod.string().nullish(),
  "completedAt": zod.string().nullish(),
  "error": zod.string().nullish()
})


/**
 * @summary Cancel a queued deletion request
 */
export const CancelDeletionRequestParams = zod.object({
  "id": zod.coerce.number().int()
})

export const CancelDeletionRequestResponse = zod.object({
  "id": zod.number().int(),
  "targetPath": zod.string(),
  "label": zod.string(),
  "requesterRole": zod.enum(['admin', 'hr', 'accountant', 'warehouse']),
  "status": zod.enum(['pending', 'executing', 'completed', 'failed', 'cancelled']),
  "requestedAt": zod.string(),
  "approvedAt": zod.string().nullish(),
  "completedAt": zod.string().nullish(),
  "error": zod.string().nullish()
})


/**
 * @summary List journal entries
 */
export const listJournalEntriesQueryDateFromRegExp = new RegExp('^\\d{4}-\\d{2}-\\d{2}$');
export const listJournalEntriesQueryDateToRegExp = new RegExp('^\\d{4}-\\d{2}-\\d{2}$');



export const ListJournalEntriesQueryParams = zod.object({
  "dateFrom": zod.coerce.string().regex(listJournalEntriesQueryDateFromRegExp).optional(),
  "dateTo": zod.coerce.string().regex(listJournalEntriesQueryDateToRegExp).optional(),
  "sourceType": zod.coerce.string().optional(),
  "accountId": zod.coerce.number().int().min(1).optional(),
  "status": zod.enum(['draft', 'posted', 'void']).optional()
})

export const listJournalEntriesResponseDateRegExp = new RegExp('^\\d{4}-\\d{2}-\\d{2}$');


export const ListJournalEntriesResponseItem = zod.object({
  "id": zod.number().int(),
  "date": zod.string().regex(listJournalEntriesResponseDateRegExp),
  "description": zod.string(),
  "sourceType": zod.string(),
  "sourceId": zod.number().int().nullable(),
  "status": zod.enum(['draft', 'posted', 'void']),
  "createdBy": zod.number().int().nullable(),
  "createdAt": zod.coerce.date(),
  "totalDebit": zod.number(),
  "totalCredit": zod.number()
})
export const ListJournalEntriesResponse = zod.array(ListJournalEntriesResponseItem)


/**
 * @summary Create a manual journal entry
 */
export const createJournalEntryBodyDateRegExp = new RegExp('^\\d{4}-\\d{2}-\\d{2}$');


export const createJournalEntryBodyLinesItemDebitMin = 0;

export const createJournalEntryBodyLinesItemCreditMin = 0;

export const createJournalEntryBodyLinesMin = 2;



export const CreateJournalEntryBody = zod.object({
  "date": zod.string().regex(createJournalEntryBodyDateRegExp),
  "description": zod.string().min(1),
  "lines": zod.array(zod.object({
  "accountId": zod.number().int().min(1),
  "debit": zod.number().min(createJournalEntryBodyLinesItemDebitMin),
  "credit": zod.number().min(createJournalEntryBodyLinesItemCreditMin),
  "memo": zod.string().nullish()
})).min(createJournalEntryBodyLinesMin)
})

export const createJournalEntryResponseOneDateRegExp = new RegExp('^\\d{4}-\\d{2}-\\d{2}$');
export const createJournalEntryResponseTwoLinesItemDebitMin = 0;

export const createJournalEntryResponseTwoLinesItemCreditMin = 0;



export const CreateJournalEntryResponse = zod.object({
  "id": zod.number().int(),
  "date": zod.string().regex(createJournalEntryResponseOneDateRegExp),
  "description": zod.string(),
  "sourceType": zod.string(),
  "sourceId": zod.number().int().nullable(),
  "status": zod.enum(['draft', 'posted', 'void']),
  "createdBy": zod.number().int().nullable(),
  "createdAt": zod.coerce.date(),
  "totalDebit": zod.number(),
  "totalCredit": zod.number()
}).and(zod.object({
  "lines": zod.array(zod.object({
  "id": zod.number().int(),
  "accountId": zod.number().int(),
  "debit": zod.number().min(createJournalEntryResponseTwoLinesItemDebitMin),
  "credit": zod.number().min(createJournalEntryResponseTwoLinesItemCreditMin),
  "memo": zod.string().nullable()
})),
  "voidedAt": zod.coerce.date().nullable(),
  "voidedBy": zod.number().int().nullable()
}))


/**
 * @summary Get a journal entry with lines
 */
export const GetJournalEntryParams = zod.object({
  "id": zod.coerce.number().int()
})

export const getJournalEntryResponseOneDateRegExp = new RegExp('^\\d{4}-\\d{2}-\\d{2}$');
export const getJournalEntryResponseTwoLinesItemDebitMin = 0;

export const getJournalEntryResponseTwoLinesItemCreditMin = 0;



export const GetJournalEntryResponse = zod.object({
  "id": zod.number().int(),
  "date": zod.string().regex(getJournalEntryResponseOneDateRegExp),
  "description": zod.string(),
  "sourceType": zod.string(),
  "sourceId": zod.number().int().nullable(),
  "status": zod.enum(['draft', 'posted', 'void']),
  "createdBy": zod.number().int().nullable(),
  "createdAt": zod.coerce.date(),
  "totalDebit": zod.number(),
  "totalCredit": zod.number()
}).and(zod.object({
  "lines": zod.array(zod.object({
  "id": zod.number().int(),
  "accountId": zod.number().int(),
  "debit": zod.number().min(getJournalEntryResponseTwoLinesItemDebitMin),
  "credit": zod.number().min(getJournalEntryResponseTwoLinesItemCreditMin),
  "memo": zod.string().nullable()
})),
  "voidedAt": zod.coerce.date().nullable(),
  "voidedBy": zod.number().int().nullable()
}))


/**
 * @summary Update a draft journal entry
 */
export const UpdateJournalEntryParams = zod.object({
  "id": zod.coerce.number().int()
})


export const updateJournalEntryBodyLinesItemDebitMin = 0;

export const updateJournalEntryBodyLinesItemCreditMin = 0;

export const updateJournalEntryBodyLinesMin = 2;



export const UpdateJournalEntryBody = zod.object({
  "lines": zod.array(zod.object({
  "accountId": zod.number().int().min(1),
  "debit": zod.number().min(updateJournalEntryBodyLinesItemDebitMin),
  "credit": zod.number().min(updateJournalEntryBodyLinesItemCreditMin),
  "memo": zod.string().nullish()
})).min(updateJournalEntryBodyLinesMin)
})

export const updateJournalEntryResponseOneDateRegExp = new RegExp('^\\d{4}-\\d{2}-\\d{2}$');
export const updateJournalEntryResponseTwoLinesItemDebitMin = 0;

export const updateJournalEntryResponseTwoLinesItemCreditMin = 0;



export const UpdateJournalEntryResponse = zod.object({
  "id": zod.number().int(),
  "date": zod.string().regex(updateJournalEntryResponseOneDateRegExp),
  "description": zod.string(),
  "sourceType": zod.string(),
  "sourceId": zod.number().int().nullable(),
  "status": zod.enum(['draft', 'posted', 'void']),
  "createdBy": zod.number().int().nullable(),
  "createdAt": zod.coerce.date(),
  "totalDebit": zod.number(),
  "totalCredit": zod.number()
}).and(zod.object({
  "lines": zod.array(zod.object({
  "id": zod.number().int(),
  "accountId": zod.number().int(),
  "debit": zod.number().min(updateJournalEntryResponseTwoLinesItemDebitMin),
  "credit": zod.number().min(updateJournalEntryResponseTwoLinesItemCreditMin),
  "memo": zod.string().nullable()
})),
  "voidedAt": zod.coerce.date().nullable(),
  "voidedBy": zod.number().int().nullable()
}))


/**
 * @summary Void a posted journal entry
 */
export const VoidJournalEntryParams = zod.object({
  "id": zod.coerce.number().int()
})

export const VoidJournalEntryResponse = zod.object({
  "reversalEntryId": zod.number().int()
})


/**
 * @summary Get the posted ledger for an account
 */
export const GetJournalAccountLedgerParams = zod.object({
  "id": zod.coerce.number().int()
})

export const getJournalAccountLedgerResponseEntriesItemDateRegExp = new RegExp('^\\d{4}-\\d{2}-\\d{2}$');


export const GetJournalAccountLedgerResponse = zod.object({
  "accountId": zod.number().int(),
  "code": zod.string(),
  "name": zod.string(),
  "normalBalance": zod.enum(['debit', 'credit']),
  "entries": zod.array(zod.object({
  "date": zod.string().regex(getJournalAccountLedgerResponseEntriesItemDateRegExp),
  "journalEntryId": zod.number().int(),
  "debit": zod.number(),
  "credit": zod.number(),
  "balance": zod.number()
}))
})


/**
 * @summary Get the posted trial balance
 */
export const GetJournalTrialBalanceResponse = zod.object({
  "balanced": zod.boolean(),
  "totalDebit": zod.number(),
  "totalCredit": zod.number(),
  "accounts": zod.array(zod.object({
  "accountId": zod.number().int(),
  "code": zod.string(),
  "name": zod.string(),
  "normalBalance": zod.enum(['debit', 'credit']),
  "debit": zod.number(),
  "credit": zod.number(),
  "balance": zod.number()
}))
})


