export type EmployeeInsuranceRowStatus = 'matched' | 'ambiguous' | 'unmatched' | 'conflict' | 'invalid';
export type EmployeeInsuranceRowChoice = number | null | undefined;

const statusLabels: Record<EmployeeInsuranceRowStatus, { label: string; cls: string }> = {
  matched: { label: 'Таарсан', cls: 'bg-primary/10 text-primary' },
  ambiguous: { label: 'Олон нэр төстэй', cls: 'bg-accent/35 text-foreground' },
  unmatched: { label: 'Олдсонгүй', cls: 'bg-sky-100 text-sky-800' },
  conflict: { label: 'Зөрчилтэй', cls: 'bg-orange-100 text-orange-800' },
  invalid: { label: 'Буруу мөр', cls: 'bg-destructive/10 text-destructive' },
};

export function getEmployeeInsuranceRowPresentation(
  status: EmployeeInsuranceRowStatus,
  issues: string[],
  choice: EmployeeInsuranceRowChoice,
) {
  if (status !== 'ambiguous' || choice === undefined) {
    return { ...statusLabels[status], issues };
  }

  return choice === null
    ? { label: 'Алгасахаар сонгосон', cls: 'bg-muted text-muted-foreground', issues: [] }
    : { label: 'Сонгосон', cls: 'bg-primary/10 text-primary', issues: [] };
}
