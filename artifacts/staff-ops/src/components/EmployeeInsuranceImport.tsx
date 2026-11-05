import { useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, FileSpreadsheet, RotateCcw, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LoadingBlock, Modal } from '@/components/ui-primitives';
import {
  getListEmployeesQueryKey,
  useApplyEmployeeInsuranceImport,
  usePreviewEmployeeInsuranceImport,
  type Employee,
  type EmployeeInsuranceImportPreview,
  type EmployeeInsuranceImportResult,
  type EmployeeInsuranceImportRow,
  type SocialInsuranceProfile,
} from '@workspace/api-client-react';

const MAX_BYTES = 1024 * 1024;
const statusLabels: Record<EmployeeInsuranceImportRow['status'], { label: string; cls: string }> = {
  matched: { label: 'Таарсан', cls: 'bg-primary/10 text-primary' },
  ambiguous: { label: 'Олон нэр төстэй', cls: 'bg-accent/35 text-foreground' },
  unmatched: { label: 'Олдсонгүй', cls: 'bg-sky-100 text-sky-800' },
  conflict: { label: 'Зөрчилтэй', cls: 'bg-orange-100 text-orange-800' },
  invalid: { label: 'Буруу мөр', cls: 'bg-destructive/10 text-destructive' },
};
const profileLabels: [keyof SocialInsuranceProfile, string][] = [
  ['givenName', 'Нэр (НДШ)'], ['parentName', 'Эцэг/эхийн нэр'], ['clanName', 'Ургийн овог'], ['registrationNumber', 'Регистр'],
  ['insuranceTypeCode', 'Даатгуулагчийн төрөл'], ['occupationCode', 'Мэргэжлийн код'], ['citizenship', 'Иргэншил'], ['email', 'Цахим шуудан'],
];

function toBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
const norm = (v?: string | null) => (v ?? '').trim().toLowerCase();
const errText = (e: unknown, fallback: string) => {
  const any = e as { data?: { error?: string }; message?: string } | null;
  return any?.data?.error || (e instanceof Error ? e.message : '') || fallback;
};
/** Existing nonempty parent/registration differs from import => explicit review required. */
function identityConflict(row: EmployeeInsuranceImportRow, emp?: Employee) {
  const cur = emp?.socialInsuranceProfile;
  if (!cur) return false;
  return (['parentName', 'registrationNumber'] as const).some((k) => norm(cur[k]) && norm(row.profile[k]) && norm(cur[k]) !== norm(row.profile[k]));
}

type Choice = number | null | undefined; // undefined = unresolved

function RowCard({ row, roster, choice, duplicate, disabled, onChoose }: { row: EmployeeInsuranceImportRow; roster: Employee[]; choice: Choice; duplicate: boolean; disabled: boolean; onChoose: (c: Choice) => void }) {
  const [q, setQ] = useState('');
  const byId = useMemo(() => new Map(roster.map((e) => [e.id, e])), [roster]);
  const candidateIds = new Set(row.candidates.map((c) => c.employeeId));
  const match = (e: Employee) => !q || `${e.name} ${e.socialInsuranceProfile?.parentName ?? ''} ${e.socialInsuranceProfile?.givenName ?? ''} ${e.socialInsuranceProfile?.registrationNumber ?? ''} ${e.role}`.toLowerCase().includes(q.toLowerCase());
  const others = roster.filter((e) => !candidateIds.has(e.id) && match(e));
  const target = typeof choice === 'number' ? byId.get(choice) : undefined;
  const st = statusLabels[row.status];
  const invalid = row.status === 'invalid';
  const reviewWarn = target && identityConflict(row, target);
  return <fieldset className="min-w-0" disabled={disabled}><article className={`min-w-0 rounded-xl border p-4 ${choice === undefined ? 'border-accent bg-accent/5' : duplicate ? 'border-destructive bg-destructive/5' : 'border-border bg-card'}`} data-testid={`employee-insurance-row-${row.rowNumber}`}>
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <p className="font-mono text-[10px] font-bold uppercase tracking-[.15em] text-muted-foreground">Мөр {row.rowNumber}</p>
        <p className="text-sm font-bold">{[row.profile.parentName, row.profile.givenName || row.name].filter(Boolean).join(' ') || '—'}</p>
        <p className="text-xs text-muted-foreground">Регистр: <span className="font-mono">{row.profile.registrationNumber || '—'}</span>{row.profile.clanName && <> · Овог: {row.profile.clanName}</>}{row.phone && <> · Утас: {row.phone}</>}</p>
      </div>
      <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${st.cls}`} data-testid={`status-import-row-${row.rowNumber}`}>{st.label}</span>
    </div>
    {row.issues.length > 0 && <ul className="mt-2 space-y-0.5 text-[11px] text-destructive">{row.issues.map((i) => <li key={i} className="flex gap-1"><AlertTriangle className="mt-0.5 size-3 shrink-0" />{i}</li>)}</ul>}
    <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1.4fr_auto] sm:items-end">
      {!invalid && <label className="text-[11px] font-semibold">Хайх<Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Нэр, эцэг/эхийн нэр, регистр" className="mt-1 h-9" data-testid={`input-search-import-employee-${row.rowNumber}`} /></label>}
      {!invalid && <label className="text-[11px] font-semibold">Ажилтан сонгох<select value={typeof choice === 'number' ? String(choice) : ''} onChange={(e) => onChoose(e.target.value ? Number(e.target.value) : undefined)} className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-2 text-sm" data-testid={`select-import-employee-${row.rowNumber}`}>
        <option value="">{choice === null ? 'Алгасна' : '— Сонгоно уу —'}</option>
        {row.candidates.length > 0 && <optgroup label="Санал болгосон">{row.candidates.map((c) => <option key={c.employeeId} value={c.employeeId}>{c.name}{c.parentName ? ` · ${c.parentName}` : ''}{c.registrationNumber ? ` · ${c.registrationNumber}` : ''} · {c.role}{c.status === 'inactive' ? ' (идэвхгүй)' : ''}</option>)}</optgroup>}
        {others.length > 0 && <optgroup label="Бүх ажилтан">{others.map((e) => <option key={e.id} value={e.id}>{e.name}{e.socialInsuranceProfile?.parentName ? ` · ${e.socialInsuranceProfile.parentName}` : ''}{e.socialInsuranceProfile?.registrationNumber ? ` · ${e.socialInsuranceProfile.registrationNumber}` : ''} · {e.role}</option>)}</optgroup>}
      </select></label>}
      <Button type="button" size="sm" variant={choice === null ? 'default' : 'outline'} onClick={() => onChoose(null)} aria-pressed={choice === null} data-testid={`button-skip-import-row-${row.rowNumber}`}>{choice === null ? 'Алгасахаар сонгосон' : 'Алгасах'}</Button>
    </div>
    {duplicate && <p role="alert" className="mt-2 text-[11px] font-semibold text-destructive">Энэ ажилтныг өөр мөрөнд давхар сонгосон байна.</p>}
    {target && <div className="mt-3 overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[420px] text-left text-[11px]"><thead className="bg-secondary/40 text-muted-foreground"><tr><th className="px-3 py-1.5">Талбар</th><th className="px-3 py-1.5">Одоогийн ({target.name})</th><th className="px-3 py-1.5">Excel</th></tr></thead>
        <tbody>{profileLabels.map(([k, label]) => {
          const cur = target.socialInsuranceProfile?.[k] ?? '';
          const next = row.profile[k] ?? '';
          const changes = !!next.trim() && norm(next) !== norm(cur);
          return <tr key={k} className={changes ? 'bg-accent/15' : ''}><td className="px-3 py-1.5 font-semibold">{label}</td><td className="px-3 py-1.5">{cur || '—'}</td><td className="px-3 py-1.5">{next.trim() ? next : <span className="text-muted-foreground">хоосон · өөрчлөхгүй</span>}{changes && <span className="ml-1 font-bold text-primary">шинэ</span>}</td></tr>;
        })}<tr><td className="px-3 py-1.5 font-semibold">Утас</td><td className="px-3 py-1.5">{target.phone || '—'}</td><td className="px-3 py-1.5">{row.phone || <span className="text-muted-foreground">хоосон · өөрчлөхгүй</span>}</td></tr></tbody></table>
      {reviewWarn && <p className="border-t border-border bg-orange-50 px-3 py-2 text-[11px] font-semibold text-orange-800">Одоогийн эцэг/эхийн нэр эсвэл регистр Excel-ээс зөрж байна. Зөв хүн мөн эсэхийг шалгана уу.</p>}
    </div>}
  </article></fieldset>;
}

export function EmployeeInsuranceImport({ roster, onClose, onApplied }: { roster: Employee[]; onClose: () => void; onApplied: (r: EmployeeInsuranceImportResult) => void }) {
  const preview = usePreviewEmployeeInsuranceImport();
  const apply = useApplyEmployeeInsuranceImport();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState('');
  const [data, setData] = useState<EmployeeInsuranceImportPreview | null>(null);
  const [choices, setChoices] = useState<Record<number, Choice>>({});
  const [error, setError] = useState('');
  const [result, setResult] = useState<EmployeeInsuranceImportResult | null>(null);
  const byId = useMemo(() => new Map(roster.map((e) => [e.id, e])), [roster]);

  const pick = (f: File | null) => {
    setFileError(''); setError('');
    if (f && !f.name.toLowerCase().endsWith('.xlsx')) { setFile(null); setFileError('Зөвхөн .xlsx файл сонгоно уу.'); return; }
    if (f && f.size > MAX_BYTES) { setFile(null); setFileError('Файлын хэмжээ 1 МБ-аас хэтэрсэн байна.'); return; }
    setFile(f);
  };
  const runPreview = async () => {
    if (!file) return;
    setError(''); setResult(null);
    try {
      const contentBase64 = toBase64(await file.arrayBuffer());
      const res = await preview.mutateAsync({ data: { fileName: file.name, contentBase64 } });
      const init: Record<number, Choice> = {};
      for (const row of res.rows) {
        if (row.status === 'matched' && row.suggestedEmployeeId != null && !identityConflict(row, byId.get(row.suggestedEmployeeId))) init[row.rowNumber] = row.suggestedEmployeeId;
      }
      setChoices(init); setData(res);
    } catch (e) { setError(errText(e, 'Файлыг уншиж чадсангүй.')); }
  };
  const reset = () => { setData(null); setChoices({}); setFile(null); setError(''); if (fileRef.current) fileRef.current.value = ''; };

  const counts = useMemo(() => {
    const m = new Map<number, number>();
    Object.values(choices).forEach((c) => { if (typeof c === 'number') m.set(c, (m.get(c) ?? 0) + 1); });
    return m;
  }, [choices]);
  const rows = data?.rows ?? [];
  const unresolved = rows.filter((r) => choices[r.rowNumber] === undefined).length;
  const dupRows = rows.filter((r) => { const c = choices[r.rowNumber]; return typeof c === 'number' && (counts.get(c) ?? 0) > 1; }).length;
  const canApply = !!data && unresolved === 0 && dupRows === 0 && !apply.isPending;

  const runApply = async () => {
    if (!data || !canApply) return;
    setError('');
    try {
      const res = await apply.mutateAsync({ data: { previewToken: data.previewToken, selections: rows.map((r) => ({ rowNumber: r.rowNumber, employeeId: choices[r.rowNumber] ?? null })) } });
      await qc.invalidateQueries({ queryKey: getListEmployeesQueryKey() });
      setResult(res); onApplied(res); reset();
    } catch (e) {
      const msg = errText(e, 'Хадгалж чадсангүй.');
      setError(`${msg} Урьдчилсан харагдац хуучирсан эсвэл ажилтны мэдээлэл өөрчлөгдсөн бол файлаа дахин уншуулж шалгана уу.`);
    }
  };

  return <Modal wide title="НДШ Excel уншуулах" detail="Ажилтны НДШ тайлангийн мэдээллийг .xlsx файлаас шинэчилнэ. Шинэ ажилтан үүсгэхгүй, цалин/орлогын баганыг үл тооно, хоосон нүд хадгалсан мэдээллийг арилгахгүй." onClose={onClose}>
    <div className="space-y-4">
      {result && <div role="status" className="flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm" data-testid="status-employee-insurance-result"><CheckCircle2 className="mt-0.5 size-4 text-primary" /><p>Хадгаллаа: <b data-testid="value-import-updated">{result.updated}</b> шинэчилсэн, <b data-testid="value-import-skipped">{result.skipped}</b> алгассан, <b data-testid="value-import-unchanged">{result.unchanged}</b> өөрчлөлтгүй.</p></div>}
      {!data && <div className="rounded-xl border border-dashed border-border bg-secondary/25 p-5">
        <label className="block text-xs font-semibold" htmlFor="employee-insurance-file">Excel файл (.xlsx, 1 МБ хүртэл)</label>
        <input disabled={preview.isPending} id="employee-insurance-file" ref={fileRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => pick(e.target.files?.[0] ?? null)} className="mt-2 block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-primary file:px-3 file:py-2 file:text-xs file:font-semibold file:text-primary-foreground" data-testid="input-employee-insurance-file" />
        {fileError && <p role="alert" className="mt-2 text-xs text-destructive" data-testid="error-employee-insurance-file">{fileError}</p>}
        <Button type="button" className="mt-4" disabled={!file || preview.isPending} onClick={() => void runPreview()} data-testid="button-preview-employee-insurance"><FileSpreadsheet className="size-4" />{preview.isPending ? 'Уншиж байна…' : 'Урьдчилан харах'}</Button>
        {preview.isPending && <div className="mt-4 space-y-2" aria-busy="true"><LoadingBlock className="h-14" /><LoadingBlock className="h-14" /></div>}
      </div>}
      {error && <p role="alert" className="rounded-xl border border-destructive/25 bg-destructive/5 p-3 text-xs font-semibold text-destructive" data-testid="error-employee-insurance-import">{error}</p>}
      {data && <>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <p data-testid="text-employee-insurance-summary">Нийт <b>{data.totalRows}</b> мөр · шийдээгүй <b className={unresolved ? 'text-destructive' : ''}>{unresolved}</b>{dupRows > 0 && <> · давхар сонголт <b className="text-destructive">{dupRows}</b></>}</p>
          <Button disabled={apply.isPending} type="button" size="sm" variant="outline" onClick={reset} data-testid="button-reupload-employee-insurance"><RotateCcw className="size-3.5" />Өөр файл</Button>
        </div>
        {rows.length === 0 ? <p className="rounded-xl border border-border p-6 text-center text-sm text-muted-foreground">Файлаас ажилтны мөр олдсонгүй.</p> :
          <div className="space-y-3">{rows.map((r) => { const c = choices[r.rowNumber]; return <RowCard key={r.rowNumber} row={r} roster={roster} choice={c} disabled={apply.isPending} duplicate={typeof c === 'number' && (counts.get(c) ?? 0) > 1} onChoose={(v) => setChoices((p) => ({ ...p, [r.rowNumber]: v }))} />; })}</div>}
        <div className="sticky bottom-0 -mx-2 flex flex-wrap items-center justify-end gap-2 border-t border-border bg-card px-2 pt-4">
          {!canApply && !apply.isPending && <span className="text-[11px] text-muted-foreground">Мөр бүрт ажилтан сонгох эсвэл алгасна уу.</span>}
          <Button type="button" variant="outline" onClick={onClose}>Болих</Button>
          <Button type="button" disabled={!canApply} onClick={() => void runApply()} data-testid="button-apply-employee-insurance"><Upload className="size-4" />{apply.isPending ? 'Хадгалж байна…' : 'Хадгалах'}</Button>
        </div>
      </>}
    </div>
  </Modal>;
}
