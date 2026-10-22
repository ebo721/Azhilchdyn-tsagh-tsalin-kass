// Only owner-account declarations above the transaction header are trusted.
// A counterparty account in a transaction must never identify the statement.
const ownerAccountLabel = /^(?:дансны\s*(?:дугаар|№|номер)(?:\s*\((?:iban|ибан)\))?|(?:iban|ибан)(?:\s*(?:дансны\s*дугаар|дугаар|данс|account(?:\s*number)?|number))?|account\s*(?:number|no\.?))(?=\s|[:：]|$)[:：\s]*(.*)$/iu;
const shortAccountLabel = /^(?:данс|account)(?:\s*[:：]\s*(.*)|\s*)$/iu;

function clean(value: string) {
  return value.normalize("NFKC").replace(/[\u200B-\u200D\uFEFF]/gu, "").trim();
}

function accountIdentity(raw: string): string | null {
  const value = clean(raw).replace(/[\s-]/gu, "").toUpperCase();
  if (/^MN\d{18}$/.test(value)) {
    const rearranged = value.slice(4) + value.slice(0, 4);
    const digits = rearranged.replace(/[A-Z]/g, (letter) => String(letter.charCodeAt(0) - 55));
    let remainder = 0;
    for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
    if (remainder !== 1 || /^0+$/.test(value.slice(8))) return null;
    return `${value.slice(4, 8)}:${value.slice(8)}`;
  }
  // This importer reads Kapitron statements; its domestic account numbers
  // correspond to bank code 0030 and the zero-padded 12-digit IBAN BBAN.
  if (/^\d{8,12}$/.test(value) && !/^0+$/.test(value)) return `0030:${value.padStart(12, "0")}`;
  return null;
}

export function assertStatementAccountMatches(
  preamble: Map<number, string>[],
  selectedAccountNumber: string,
): void {
  const declarations: string[] = [];
  for (const row of preamble) {
    const cells = [...row].sort(([a], [b]) => a - b);
    for (let i = 0; i < cells.length; i++) {
      const text = clean(cells[i][1]);
      const label = ownerAccountLabel.exec(text) ?? shortAccountLabel.exec(text);
      if (!label) continue;
      const inlineValue = clean(label[1] ?? "");
      const value = inlineValue || cells.slice(i + 1).map(([, cell]) => clean(cell)).find(Boolean) || "";
      declarations.push(value);
    }
  }
  if (!declarations.length) {
    throw new Error("Хуулгын эзэмшигчийн дансны дугаар олдсонгүй. Дансны дугаар эсвэл IBAN-тай бүрэн .xlsx хуулга оруулна уу. Гүйлгээ хадгалаагүй.");
  }
  const identities = declarations.map(accountIdentity);
  if (identities.some((identity) => identity === null)) {
    throw new Error("Хуулгын эзэмшигчийн дансны дугаар эсвэл IBAN буруу, хоосон эсвэл унших боломжгүй байна. Гүйлгээ хадгалаагүй.");
  }
  if (new Set(identities).size !== 1) {
    throw new Error("Хуулгын эзэмшигчийн дансны мэдээллүүд хоорондоо зөрүүтэй байна. Гүйлгээ хадгалаагүй.");
  }
  const selected = accountIdentity(selectedAccountNumber);
  if (!selected) {
    throw new Error("Сонгосон банкны дансны дугаар эсвэл IBAN буруу байна. Дансны тохиргоог шалгана уу. Гүйлгээ хадгалаагүй.");
  }
  if (identities[0] !== selected) {
    const ending = (value: string) => clean(value).replace(/[\s-]/gu, "").slice(-4);
    throw new Error(`Хуулгын данс (…${ending(declarations[0])}) сонгосон данстай (…${ending(selectedAccountNumber)}) таарахгүй байна. Зөв дансаа сонгоно уу. Гүйлгээ хадгалаагүй.`);
  }
}
