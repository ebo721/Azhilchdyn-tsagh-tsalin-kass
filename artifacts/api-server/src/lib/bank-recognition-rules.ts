export type BankKeywordRecognitionRule = {
  id: string;
  direction: "income" | "expense";
  keywords: readonly string[];
  accountCode: string;
};

export const bankKeywordRecognitionRules: readonly BankKeywordRecognitionRule[] = [
  { id: "salary", direction: "expense", keywords: ["цалин", "salary"], accountCode: "6000" },
  { id: "social-insurance", direction: "expense", keywords: ["ндш", "нийгмийн даатгал"], accountCode: "6010" },
  { id: "rent", direction: "expense", keywords: ["түрээс", "rent"], accountCode: "6100" },
  { id: "transport", direction: "expense", keywords: ["тээвэр", "шатахуун", "такси"], accountCode: "6200" },
  { id: "utilities", direction: "expense", keywords: ["цахилгаан", "дулаан", "усны төлбөр"], accountCode: "6300" },
  { id: "communications", direction: "expense", keywords: ["интернет", "интернэт", "харилцаа холбоо"], accountCode: "6400" },
  { id: "repairs", direction: "expense", keywords: ["засвар", "засвар үйлчилгээ"], accountCode: "6500" },
  { id: "vat", direction: "expense", keywords: ["нөат", "noat", "vat"], accountCode: "2200" },
] as const;