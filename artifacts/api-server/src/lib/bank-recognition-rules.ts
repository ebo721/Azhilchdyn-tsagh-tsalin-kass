export type BankKeywordRecognitionRule = {
  id: string;
  direction: "income" | "expense";
  keywords: readonly string[];
  accountCode: string;
};

export const bankKeywordRecognitionRules: readonly BankKeywordRecognitionRule[] = [
  { id: "cash-top-up", direction: "income", keywords: ["касс зузаатгал", "кассын зузаатгал"], accountCode: "1000" },
  { id: "salary", direction: "expense", keywords: ["цалин", "salary"], accountCode: "6000" },
  { id: "social-insurance", direction: "expense", keywords: ["ндш", "нийгмийн даатгал"], accountCode: "6010" },
  { id: "rent", direction: "expense", keywords: ["түрээс", "rent"], accountCode: "6100" },
  { id: "transport", direction: "expense", keywords: ["тээвэр", "тээврийн хөлс", "тээврийн төлбөр", "шатахуун", "бензин", "бинзен", "такси"], accountCode: "6200" },
  { id: "utilities", direction: "expense", keywords: ["цахилгаан", "дулаан", "усны төлбөр"], accountCode: "6300" },
  { id: "communications", direction: "expense", keywords: ["интернет", "интернэт", "харилцаа холбоо", "хостинг", "hosting"], accountCode: "6400" },
  { id: "repairs", direction: "expense", keywords: ["засвар", "засвар үйлчилгээ"], accountCode: "6500" },
  { id: "vat", direction: "expense", keywords: ["нөат", "noat", "vat"], accountCode: "2200" },
  { id: "supplies", direction: "expense", keywords: ["ахуйн бараа", "батерей", "агуулах цоож", "сангийн материал"], accountCode: "1510" },
  { id: "inventory", direction: "expense", keywords: ["ттт", "бараа татан авалт", "сүүний үнэ", "хүнс", "мах", "ногоо", "гоймон", "пүнтүүз", "ургамлын тос", "борц", "бургер", "хотдог", "тортилла"], accountCode: "1500" },
] as const;