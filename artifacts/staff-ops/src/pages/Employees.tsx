import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Form } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { EmptyState, ErrorBlock, LoadingBlock, Modal, StatusPill } from '@/components/ui-primitives';
import { Pencil, Plus, Search, Trash2, UsersRound } from 'lucide-react';
import {
  EmployeeEmployeeType,
  getGetDashboardQueryKey,
  getGetPayrollAdvanceQueryKey,
  getGetPayrollQueryKey,
  getListEmployeesQueryKey,
  getListEmployeeSalaryHistoryQueryKey,
  useCreateEmployee,
  useGetAuthSession,
  useListEmployeeSalaryHistory,
  useListEmployees,
  useListShiftPlans,
  useListShifts,
  useUpdateEmployee,
  useUpdateEmployeeSalaryHistory,
  type Employee,
  type EmployeeSalaryHistory,
} from '@workspace/api-client-react';
import { currentMonth, money, today, useQueueDeletion } from '@/App';
type EmployeeForm = { name: string; role: string; phone: string; employeeType: 'shift' | 'office'; salaryType: 'daily' | 'monthly'; payFrequency: 'once' | 'twice'; baseSalary: string; socialInsuranceSalary: string; payrollTaxExempt: boolean; fullSalaryRegardlessAttendance: boolean; monthlyExpectedWorkDays: string; joinedAt: string; status?: 'active' | 'inactive'; inactiveAt: string; salaryEffectiveDate: string };

function SalaryHistoryRowEditor({ employee, row, isBaseline, isCurrent, canChange, deletionPending, onDelete, onSaved }: { employee: Employee; row: EmployeeSalaryHistory; isBaseline: boolean; isCurrent: boolean; canChange: boolean; deletionPending: boolean; onDelete: () => void; onSaved: (row: EmployeeSalaryHistory, isCurrent: boolean) => void }) {
  const update = useUpdateEmployeeSalaryHistory();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [effectiveFrom, setEffectiveFrom] = useState(row.effectiveFrom);
  const [baseSalary, setBaseSalary] = useState(String(row.baseSalary));
  const [socialInsuranceSalary, setSocialInsuranceSalary] = useState(String(row.socialInsuranceSalary));
  const [salaryType, setSalaryType] = useState(row.salaryType);
  const [payFrequency, setPayFrequency] = useState(row.payFrequency);
  const [monthlyExpectedWorkDays, setMonthlyExpectedWorkDays] = useState(String(row.monthlyExpectedWorkDays));
  const save = () => {
    const base = Number(baseSalary);
    const social = Number(socialInsuranceSalary);
    const monthlyExpected = Number(monthlyExpectedWorkDays);
    if (!effectiveFrom || !Number.isFinite(base) || base < 0 || !Number.isFinite(social) || social < 0 || !Number.isFinite(monthlyExpected) || monthlyExpected < 0) {
      window.alert('Огноо болон цалингийн дүнг зөв оруулна уу.');
      return;
    }
    update.mutate({ id: employee.id, historyId: row.id, data: { effectiveFrom, baseSalary: base, socialInsuranceSalary: social, salaryType, payFrequency, monthlyExpectedWorkDays: monthlyExpected } }, {
      onSuccess: (saved) => {
        qc.invalidateQueries({ queryKey: getListEmployeeSalaryHistoryQueryKey(employee.id) });
        qc.invalidateQueries({ queryKey: getListEmployeesQueryKey() });
        qc.invalidateQueries({ queryKey: getGetPayrollQueryKey() });
        qc.invalidateQueries({ queryKey: getGetPayrollAdvanceQueryKey() });
        onSaved(saved, isCurrent);
        setEditing(false);
      },
      onError: (error) => window.alert(error instanceof Error ? error.message : 'Цалингийн түүхийг засаж чадсангүй.'),
    });
  };
  if (editing) {
    return <tr data-testid={`row-salary-history-${row.id}`}><td className="px-2 py-2"><input type="date" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} className="h-8 rounded-lg border border-input bg-background px-2 font-mono text-xs" data-testid={`input-salary-history-date-${row.id}`} /></td><td className="px-2 py-2"><div className="flex flex-col gap-1">{row.employeeType === 'office' ? <span className="px-2 text-xs">Оффис</span> : <><select value={salaryType} onChange={(e) => setSalaryType(e.target.value as 'daily' | 'monthly')} className="h-8 rounded-lg border border-input bg-background px-2 text-xs" data-testid={`select-salary-history-type-${row.id}`}><option value="daily">Өдрийн</option><option value="monthly">Сарын</option></select>{salaryType === 'monthly' && <input type="number" min="1" max="31" value={monthlyExpectedWorkDays} onChange={(e) => setMonthlyExpectedWorkDays(e.target.value)} className="h-8 w-24 rounded-lg border border-input bg-background px-2 text-xs" placeholder="Өдөр" data-testid={`input-salary-history-expected-days-${row.id}`} />}</>}<select value={payFrequency} onChange={(event) => setPayFrequency(event.target.value as 'once' | 'twice')} className="h-8 rounded-lg border border-input bg-background px-2 text-xs" data-testid={`select-salary-history-pay-frequency-${row.id}`}><option value="once">Сард 1 удаа</option><option value="twice">Сард 2 удаа</option></select></div></td><td className="px-2 py-2 text-right"><input type="number" min="0" value={baseSalary} onChange={(event) => setBaseSalary(event.target.value)} className="h-8 w-28 rounded-lg border border-input bg-background px-2 text-right font-mono text-xs" data-testid={`input-salary-history-base-${row.id}`} /></td><td className="px-2 py-2 text-right"><input type="number" min="0" value={socialInsuranceSalary} onChange={(event) => setSocialInsuranceSalary(event.target.value)} className="h-8 w-28 rounded-lg border border-input bg-background px-2 text-right font-mono text-xs" data-testid={`input-salary-history-social-${row.id}`} /></td><td className="px-4 py-3 text-center text-xs">{row.payrollTaxExempt ? 'Чөлөөлсөн' : 'Тооцно'}</td><td className="px-2 py-2"><div className="flex justify-end gap-1"><Button type="button" size="sm" onClick={save} disabled={update.isPending} data-testid={`button-save-salary-history-${row.id}`}>{update.isPending ? 'Хадгалж байна...' : 'Хадгалах'}</Button><Button type="button" size="sm" variant="outline" onClick={() => setEditing(false)}>Болих</Button></div></td></tr>;
  }
  return <tr data-testid={`row-salary-history-${row.id}`}><td className="px-4 py-3 font-mono text-xs">{row.effectiveFrom}</td><td className="px-4 py-3 text-xs">{row.employeeType === 'office' ? 'Оффис' : row.salaryType === 'monthly' ? `Ээлж (сарын, ${row.monthlyExpectedWorkDays} өдөр)` : 'Ээлж (өдрийн)'}<span className="mt-1 block text-[10px] text-muted-foreground">{row.payFrequency === 'once' ? 'Сард 1 удаа' : 'Сард 2 удаа'}</span></td><td className="px-4 py-3 text-right font-mono text-xs">{money(row.baseSalary)}</td><td className="px-4 py-3 text-right font-mono text-xs">{money(row.socialInsuranceSalary)}</td><td className="px-4 py-3 text-center text-xs">{row.payrollTaxExempt ? 'Чөлөөлсөн' : 'Тооцно'}</td><td className="px-4 py-3"><div className="flex justify-end gap-1">{canChange && <><Button type="button" size="icon" variant="outline" onClick={() => setEditing(true)} aria-label="Цалингийн түүх засах" data-testid={`button-edit-salary-history-${row.id}`}><Pencil className="size-3.5" /></Button><Button type="button" size="icon" variant="outline" disabled={isBaseline || deletionPending} title={isBaseline ? 'Анхны цалингийн мөрийг устгах боломжгүй' : 'Буруу цалингийн мөр устгах'} onClick={onDelete} data-testid={`button-delete-salary-history-${row.id}`}><Trash2 className="size-3.5" /></Button></>}</div></td></tr>;
}

function EmployeeModal({ employee, onClose }: { employee?: Employee; onClose: () => void }) {
  const isEdit = !!employee;
  const create = useCreateEmployee();
  const update = useUpdateEmployee();
  const qc = useQueryClient();
  const session = useGetAuthSession();
  const isAdmin = session.data?.authenticated === true && session.data.role === 'admin';
  const salaryHistoryEmployeeId = employee?.id ?? 0;
  const salaryHistory = useListEmployeeSalaryHistory(salaryHistoryEmployeeId, {
    query: { enabled: isEdit, queryKey: getListEmployeeSalaryHistoryQueryKey(salaryHistoryEmployeeId) },
  });
  const salaryHistoryDeletion = useQueueDeletion();
  const form = useForm<EmployeeForm>({ defaultValues: { name: employee?.name ?? '', role: employee?.role ?? '', phone: employee?.phone ?? '', employeeType: employee?.employeeType ?? 'office', salaryType: employee?.salaryType ?? 'monthly', payFrequency: employee?.payFrequency ?? 'twice', baseSalary: String(employee?.baseSalary ?? ''), socialInsuranceSalary: String(employee?.socialInsuranceSalary ?? ''), payrollTaxExempt: employee?.payrollTaxExempt ?? false, fullSalaryRegardlessAttendance: employee?.fullSalaryRegardlessAttendance ?? false, monthlyExpectedWorkDays: String(employee?.monthlyExpectedWorkDays ?? 0), joinedAt: employee?.joinedAt ?? today(), status: employee?.status ?? 'active', inactiveAt: employee?.inactiveAt ?? '', salaryEffectiveDate: '' } });
  const [salaryBaseline, setSalaryBaseline] = useState({
    baseSalary: Number(employee?.baseSalary ?? 0),
    socialInsuranceSalary: employee?.payrollTaxExempt ? 0 : Number(employee?.socialInsuranceSalary ?? 0),
    payrollTaxExempt: employee?.payrollTaxExempt ?? false,
    fullSalaryRegardlessAttendance: employee?.fullSalaryRegardlessAttendance ?? false,
    employeeType: employee?.employeeType ?? 'office',
    salaryType: employee?.salaryType ?? 'monthly',
    payFrequency: employee?.payFrequency ?? 'twice',
    monthlyExpectedWorkDays: Number(employee?.monthlyExpectedWorkDays ?? 0),
  });
  const submit = (values: EmployeeForm) => {
    const data = { name: values.name, role: values.role, phone: values.phone, employeeType: values.employeeType, salaryType: values.employeeType === 'shift' ? values.salaryType : 'monthly', payFrequency: values.payFrequency, baseSalary: Number(values.baseSalary), socialInsuranceSalary: values.payrollTaxExempt ? 0 : Number(values.socialInsuranceSalary), payrollTaxExempt: values.payrollTaxExempt, ...(isAdmin ? { fullSalaryRegardlessAttendance: values.fullSalaryRegardlessAttendance } : {}), monthlyExpectedWorkDays: (values.employeeType === 'shift' && values.salaryType === 'monthly') ? Number(values.monthlyExpectedWorkDays) : 0, joinedAt: values.joinedAt, ...(isEdit ? { status: values.status, inactiveAt: values.status === 'inactive' ? values.inactiveAt : null, ...(values.salaryEffectiveDate ? { salaryEffectiveDate: values.salaryEffectiveDate } : {}) } : {}) };
    const done = () => { qc.invalidateQueries({ queryKey: getListEmployeesQueryKey() }); if (employee) qc.invalidateQueries({ queryKey: getListEmployeeSalaryHistoryQueryKey(employee.id) }); qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() }); qc.invalidateQueries({ queryKey: getGetPayrollQueryKey() }); qc.invalidateQueries({ queryKey: getGetPayrollAdvanceQueryKey() }); onClose(); };
    if (isEdit && employee) update.mutate({ id: employee.id, data }, { onSuccess: done }); else create.mutate({ data }, { onSuccess: done });
  };
  const pending = create.isPending || update.isPending;
  const deleteSalaryHistory = (historyId: number, effectiveFrom: string) => {
    if (!employee || !window.confirm(`${effectiveFrom}-с хүчинтэй цалингийн мөрийг устгах уу?`)) return;
    void salaryHistoryDeletion.request(
      `/employees/${employee.id}/salary-history/${historyId}`,
      `${employee.name} ажилтны ${effectiveFrom}-с хүчинтэй цалингийн түүх`,
    ).then(() => {
      qc.invalidateQueries({ queryKey: getListEmployeeSalaryHistoryQueryKey(employee.id) });
      qc.invalidateQueries({ queryKey: getListEmployeesQueryKey() });
      qc.invalidateQueries({ queryKey: getGetPayrollQueryKey() });
      qc.invalidateQueries({ queryKey: getGetPayrollAdvanceQueryKey() });
    });
  };
  const employeeType = form.watch('employeeType');
  const salaryType = form.watch('salaryType');
  const payFrequency = form.watch('payFrequency');
  const baseSalary = form.watch('baseSalary');
  const socialInsuranceSalary = form.watch('socialInsuranceSalary');
  const payrollTaxExempt = form.watch('payrollTaxExempt');
  const fullSalaryRegardlessAttendance = form.watch('fullSalaryRegardlessAttendance');
  const monthlyExpectedWorkDays = form.watch('monthlyExpectedWorkDays');
  const status = form.watch('status');
  const joinedAt = form.watch('joinedAt');
  const joinedAtChanged = isEdit && !!employee && joinedAt !== employee.joinedAt;
  const salaryChanged = isEdit && !!employee && (
    Number(baseSalary) !== salaryBaseline.baseSalary
    || Number(payrollTaxExempt ? 0 : socialInsuranceSalary) !== salaryBaseline.socialInsuranceSalary
    || payrollTaxExempt !== salaryBaseline.payrollTaxExempt
    || fullSalaryRegardlessAttendance !== salaryBaseline.fullSalaryRegardlessAttendance
    || employeeType !== salaryBaseline.employeeType
    || salaryType !== salaryBaseline.salaryType
    || payFrequency !== salaryBaseline.payFrequency
    || (employeeType === 'shift' && salaryType === 'monthly' && Number(monthlyExpectedWorkDays) !== salaryBaseline.monthlyExpectedWorkDays)
  );
  const syncSavedSalary = (saved: EmployeeSalaryHistory, isCurrent: boolean) => {
    if (!isCurrent) return;
    form.setValue('baseSalary', String(saved.baseSalary));
    form.setValue('socialInsuranceSalary', String(saved.socialInsuranceSalary));
    form.setValue('employeeType', saved.employeeType);
    form.setValue('salaryType', saved.salaryType);
    form.setValue('payFrequency', saved.payFrequency);
    form.setValue('monthlyExpectedWorkDays', String(saved.monthlyExpectedWorkDays));
    setSalaryBaseline({
      baseSalary: Number(saved.baseSalary),
      socialInsuranceSalary: Number(saved.socialInsuranceSalary),
      payrollTaxExempt: saved.payrollTaxExempt,
      fullSalaryRegardlessAttendance: saved.fullSalaryRegardlessAttendance,
      employeeType: saved.employeeType,
      salaryType: saved.salaryType,
      payFrequency: saved.payFrequency,
      monthlyExpectedWorkDays: Number(saved.monthlyExpectedWorkDays),
    });
  };
  return <Modal title={isEdit ? 'Ажилтны мэдээлэл засах' : 'Шинэ ажилтан бүртгэх'} detail="Ажилтны төрлөөс хамаарч өдрийн эсвэл сарын цалинг оруулна." onClose={onClose}>
    <Form {...form}><form onSubmit={form.handleSubmit(submit)} className="space-y-5" data-testid="form-employee">
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="space-y-2 text-xs font-semibold">Нэр<input className="mt-1 flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15" {...form.register('name', { required: 'Нэр оруулна уу' })} data-testid="input-employee-name" />{form.formState.errors.name && <span className="text-[11px] text-destructive">{form.formState.errors.name.message}</span>}</label>
        <label className="space-y-2 text-xs font-semibold">Албан тушаал<input className="mt-1 flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...form.register('role', { required: 'Албан тушаал оруулна уу' })} data-testid="input-employee-role" /></label>
        <label className="space-y-2 text-xs font-semibold">Утас<input className="mt-1 flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...form.register('phone')} data-testid="input-employee-phone" /></label>
        <label className="space-y-2 text-xs font-semibold">Ажилд орсон огноо<input type="date" className="mt-1 flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...form.register('joinedAt', { required: true })} data-testid="input-employee-joined-at" /></label>
        <label className="space-y-2 text-xs font-semibold">Ажилтны төрөл<select className="mt-1 flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...form.register('employeeType')} data-testid="select-employee-type"><option value="office">Оффис ажилтан</option><option value="shift">Ээлжийн ажилтан</option></select></label>
        <label className="space-y-2 text-xs font-semibold">Цалин авах давтамж<select className="mt-1 flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...form.register('payFrequency')} data-testid="select-employee-pay-frequency"><option value="once">Сард 1 удаа · зөвхөн сүүл цалин</option><option value="twice">Сард 2 удаа · урьдчилгаа, сүүл цалин</option></select></label>
        {employeeType === 'shift' && <label className="space-y-2 text-xs font-semibold">Цалингийн төрөл<select className="mt-1 flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...form.register('salaryType')} data-testid="select-employee-salary-type"><option value="daily">Өдрийн цалин</option><option value="monthly">Сарын цалин</option></select></label>}
        <label className="space-y-2 text-xs font-semibold">{isEdit ? 'Шинэ цалин' : (employeeType === 'office' || salaryType === 'monthly') ? 'Сарын цалингийн хэмжээ' : 'Өдрийн цалингийн хэмжээ'}<input type="number" min="0" className="mt-1 flex h-10 w-full rounded-lg border border-input bg-background px-3 font-mono text-sm outline-none focus:border-primary" {...form.register('baseSalary', { required: true, min: 0 })} data-testid="input-employee-salary" />{isEdit && <span className="text-[11px] font-normal text-muted-foreground">Одоогийн цалин: {money(employee?.baseSalary)}</span>}</label>
        <label className="space-y-2 text-xs font-semibold">НДШ тооцох цалин<input type="number" min="0" disabled={payrollTaxExempt} className="mt-1 flex h-10 w-full rounded-lg border border-input bg-background px-3 font-mono text-sm outline-none disabled:cursor-not-allowed disabled:opacity-50 focus:border-primary" {...form.register('socialInsuranceSalary', { required: !payrollTaxExempt, min: 0 })} data-testid="input-employee-social-insurance-salary" /></label>
        <label className="flex items-center gap-3 rounded-xl border border-border bg-secondary/35 px-4 py-3 text-sm font-semibold sm:col-span-2"><input type="checkbox" className="size-4 accent-primary" {...form.register('payrollTaxExempt')} data-testid="checkbox-employee-payroll-tax-exempt" /><span><span className="block">НДШ, ХХОАТ төлөхгүй</span><span className="mt-0.5 block text-[11px] font-normal text-muted-foreground">Цалин бодоход НДШ, ХХОАТ болон татварын хөнгөлөлт 0 байна.</span></span></label>
        {isAdmin && <label className="flex items-center gap-3 rounded-xl border border-primary/25 bg-primary/5 px-4 py-3 text-sm font-semibold sm:col-span-2"><input type="checkbox" className="size-4 accent-primary" {...form.register('fullSalaryRegardlessAttendance')} data-testid="checkbox-employee-full-salary" /><span><span className="block">Ирцээс үл хамааран цалинг бүтэн бодох</span><span className="mt-0.5 block text-[11px] font-normal text-muted-foreground">Ажилласан хугацаанд ирц, таслалт, чөлөөнөөс үл хамааран сарын үндсэн цалинг бүтнээр тооцно. Зөвхөн админ өөрчилнө.</span></span></label>}
        {(employeeType === 'shift' && salaryType === 'monthly') ? <label className="space-y-2 text-xs font-semibold">Сард ажиллах ёстой өдөр<input type="number" min="1" max="31" className="mt-1 flex h-10 w-full rounded-lg border border-input bg-background px-3 font-mono text-sm outline-none focus:border-primary" {...form.register('monthlyExpectedWorkDays', { required: true, min: 1, max: 31 })} data-testid="input-employee-expected-work-days" /><span className="text-[11px] font-normal text-muted-foreground">Ээлжийн ажилтны өдрийн цалинг сарын цалин хуваах нь ажиллах ёстой өдөр гэж бодно.</span></label> : (employeeType === 'office' ? <div className="rounded-xl border border-border bg-secondary/35 p-3 text-xs text-muted-foreground sm:col-span-2">Ажиллах ёстой өдрийг тухайн сарын Даваа–Баасан гарагаар автоматаар тооцно.</div> : null)}
        {isEdit && <label className="space-y-2 text-xs font-semibold">Төлөв<select className="mt-1 flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...form.register('status')} data-testid="select-employee-status"><option value="active">Идэвхтэй</option><option value="inactive">Идэвхгүй</option></select></label>}
        {isEdit && status === 'inactive' && <label className="space-y-2 text-xs font-semibold">Идэвхгүй болсон огноо<input type="date" min={form.getValues('joinedAt')} className="mt-1 flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...form.register('inactiveAt', { required: status === 'inactive' })} data-testid="input-employee-inactive-at" /><span className="text-[11px] font-normal text-muted-foreground">Энэ өдрийг цалин бодох сүүлийн өдөрт оруулна.</span></label>}
        {salaryChanged && !joinedAtChanged && <label className="space-y-2 rounded-xl border border-primary/30 bg-primary/5 p-4 text-xs font-semibold sm:col-span-2">Цалин өөрчлөгдөж буй огноо<input type="date" min={form.getValues('joinedAt')} className="mt-1 flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" {...form.register('salaryEffectiveDate', { required: salaryChanged && !joinedAtChanged ? 'Цалин өөрчлөгдөж буй огноог сонгоно уу' : false })} data-testid="input-employee-salary-effective-date" />{form.formState.errors.salaryEffectiveDate ? <span className="text-[11px] text-destructive">{form.formState.errors.salaryEffectiveDate.message}</span> : <span className="text-[11px] font-normal text-muted-foreground">Шинэ цалинг энэ өдрөөс эхлэн тооцно. Өмнөх өдрүүд хуучин цалингаар бодогдоно.</span>}</label>}
        {salaryChanged && joinedAtChanged && <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 text-xs text-muted-foreground sm:col-span-2">Ажилд орсон огноо өөрчлөгдөж байгаа тул энэ цалинг анхны цалингийн залруулга болгон хадгална.</div>}
      </div>
      {isEdit && <section className="overflow-hidden rounded-xl border border-border">
        <div className="flex items-center justify-between border-b border-border bg-secondary/35 px-4 py-3"><div><h3 className="text-sm font-bold">Цалингийн түүх</h3><p className="text-[11px] text-muted-foreground">Шинэ огнооноос эхлэн тухайн мөрийн цалинг ашиглана.</p></div><span className="font-mono text-xs text-muted-foreground">{salaryHistory.data?.length ?? 0} мөр</span></div>
        {salaryHistory.isLoading ? <div className="p-4"><LoadingBlock className="h-20" /></div> : salaryHistory.isError ? <div className="p-4"><ErrorBlock onRetry={() => salaryHistory.refetch()} /></div> : !salaryHistory.data?.length ? <p className="p-4 text-sm text-muted-foreground">Цалингийн түүх олдсонгүй.</p> : <div className="max-h-64 overflow-auto"><table className="w-full min-w-[680px] text-left"><thead className="bg-secondary/20 text-[10px] uppercase text-muted-foreground"><tr><th className="px-4 py-2">Хүчинтэй огноо</th><th className="px-4 py-2">Төрөл</th><th className="px-4 py-2 text-right">Үндсэн цалин</th><th className="px-4 py-2 text-right">НДШ цалин</th><th className="px-4 py-2 text-center">Татвар</th><th className="px-4 py-2 text-right">Үйлдэл</th></tr></thead><tbody className="divide-y divide-border">{salaryHistory.data.map((row, index) => <SalaryHistoryRowEditor key={row.id} employee={employee!} row={row} isBaseline={index === salaryHistory.data.length - 1} isCurrent={index === 0} canChange={session.data?.role !== 'viewer'} deletionPending={salaryHistoryDeletion.isPending} onDelete={() => deleteSalaryHistory(row.id, row.effectiveFrom)} onSaved={syncSavedSalary} />)}</tbody></table></div>}
      </section>}
      {(create.isError || update.isError) && <p className="text-xs font-semibold text-destructive">Мэдээллийг хадгалж чадсангүй. Огноонууд болон цалин өөрчлөгдөх огноог шалгана уу.</p>}
      <div className="flex justify-end gap-2 border-t border-border pt-5"><Button type="button" variant="outline" onClick={onClose} data-testid="button-cancel-employee">Болих</Button><Button type="submit" disabled={pending} data-testid="button-save-employee">{pending ? 'Хадгалж байна...' : isEdit ? 'Өөрчлөлт хадгалах' : 'Ажилтан нэмэх'}</Button></div>
    </form></Form>
  </Modal>;
}

export function Employees() {
  const query = useListEmployees();
  const shifts = useListShifts();
  const [shiftMonth, setShiftMonth] = useState(currentMonth());
  const shiftPlans = useListShiftPlans({ month: shiftMonth });
  const deletion = useQueueDeletion();
  const qc = useQueryClient();
  const [modal, setModal] = useState<{ open: boolean; employee?: Employee }>({ open: false });
  const [search, setSearch] = useState('');
  const [employeeTypeFilter, setEmployeeTypeFilter] = useState<'all' | 'office' | 'shift'>('all');
  const [shiftFilter, setShiftFilter] = useState<'all' | 'unassigned' | `${number}`>('all');
  const employeeShiftIds = useMemo(() => {
    const result = new Map<number, Set<number>>();
    for (const plan of shiftPlans.data ?? []) {
      const assigned = result.get(plan.employeeId) ?? new Set<number>();
      assigned.add(plan.shiftId);
      result.set(plan.employeeId, assigned);
    }
    return result;
  }, [shiftPlans.data]);
  const employees = useMemo(() => (query.data ?? []).filter((employee) => {
    if (!`${employee.name} ${employee.role} ${employee.phone}`.toLowerCase().includes(search.toLowerCase())) return false;
    if (employeeTypeFilter !== 'all' && employee.employeeType !== employeeTypeFilter) return false;
    if (employee.employeeType === EmployeeEmployeeType.shift && shiftFilter !== 'all') {
      const assigned = employeeShiftIds.get(employee.id);
      if (shiftFilter === 'unassigned') return !assigned?.size;
      return assigned?.has(Number(shiftFilter)) ?? false;
    }
    return true;
  }), [employeeShiftIds, employeeTypeFilter, query.data, search, shiftFilter]);
  const del = (employee: Employee) => { if (window.confirm(`${employee.name}-г устгах уу?`)) deletion.request(`/employees/${employee.id}`, `${employee.name} ажилтны бүртгэл`); };
  const officeEmployees = employees.filter((employee) => employee.employeeType === EmployeeEmployeeType.office);
  const shiftEmployees = employees.filter((employee) => employee.employeeType === EmployeeEmployeeType.shift);
  const employeeTable = (rows: Employee[]) => (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[850px] text-left">
        <thead className="bg-secondary/50 text-[10px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-5 py-3 font-bold">Ажилтан</th><th className="px-5 py-3 font-bold">Утас</th><th className="px-5 py-3 font-bold">Төрөл</th><th className="px-5 py-3 font-bold">Цалин</th><th className="px-5 py-3 font-bold">НДШ-ийн цалин</th><th className="px-5 py-3 font-bold">Төлөв</th><th className="px-5 py-3 text-right font-bold">Үйлдэл</th></tr></thead>
        <tbody className="divide-y divide-border">{rows.map((employee) => <tr className="group transition-colors hover:bg-secondary/35" key={employee.id} data-testid={`row-employee-${employee.id}`}><td className="px-5 py-4"><div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-xl bg-accent/30 text-xs font-bold text-foreground">{employee.name.slice(0, 1)}</span><div><p className="text-sm font-semibold">{employee.name}</p><p className="text-xs text-muted-foreground">{employee.role}</p></div></div></td><td className="px-5 py-4 text-sm text-muted-foreground">{employee.phone || '—'}</td><td className="px-5 py-4 text-sm">{employee.employeeType === EmployeeEmployeeType.office ? 'Оффис' : employee.salaryType === 'monthly' ? 'Ээлж (сарын)' : 'Ээлж (өдрийн)'}</td><td className="px-5 py-4"><p className="font-mono text-sm">{money(employee.baseSalary)}</p><p className="text-[10px] text-muted-foreground">{employee.salaryType === 'monthly' ? 'сарын' : 'өдрийн'}</p></td><td className="px-5 py-4 font-mono text-sm">{money(employee.socialInsuranceSalary)}</td><td className="px-5 py-4"><StatusPill value={employee.status} /></td><td className="px-5 py-4"><div className="flex justify-end gap-1"><button className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground" onClick={() => setModal({ open: true, employee })} aria-label={`${employee.name} засах`} data-testid={`button-edit-employee-${employee.id}`}><Pencil className="size-4" /></button><button className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive" onClick={() => del(employee)} aria-label={`${employee.name} устгах хүсэлт`} data-testid={`button-delete-employee-${employee.id}`}><Trash2 className="size-4" /></button></div></td></tr>)}</tbody>
      </table>
    </div>
  );
  return <div className="page-enter space-y-5">
    <div className="flex justify-end"><Button onClick={() => setModal({ open: true })} data-testid="button-add-employee"><Plus className="size-4" />Ажилтан нэмэх</Button></div>
    <section className="rounded-2xl border border-border bg-card p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
        <div className="flex flex-wrap gap-2">
          {([
            ['all', `Бүгд (${query.data?.length ?? 0})`],
            ['office', `Оффис (${(query.data ?? []).filter((employee) => employee.employeeType === EmployeeEmployeeType.office).length})`],
            ['shift', `Ээлж (${(query.data ?? []).filter((employee) => employee.employeeType === EmployeeEmployeeType.shift).length})`],
          ] as const).map(([value, label]) => <Button key={value} type="button" size="sm" variant={employeeTypeFilter === value ? 'default' : 'outline'} onClick={() => setEmployeeTypeFilter(value)} data-testid={`button-employee-type-${value}`}>{label}</Button>)}
        </div>
        <div className="grid flex-1 gap-3 sm:grid-cols-[150px_minmax(180px,1fr)_minmax(180px,1fr)]">
          <label className="space-y-1 text-xs font-semibold">Ээлжийн сар<Input type="month" value={shiftMonth} onChange={(event) => setShiftMonth(event.target.value)} data-testid="input-employee-shift-month" /></label>
          <label className="space-y-1 text-xs font-semibold">Ээлжээр шүүх<select value={shiftFilter} onChange={(event) => setShiftFilter(event.target.value as typeof shiftFilter)} className="flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" data-testid="select-employee-shift-filter"><option value="all">Бүх ээлж</option>{(shifts.data ?? []).map((shift) => <option key={shift.id} value={shift.id}>{shift.name} · {shift.startTime}–{shift.endTime}</option>)}<option value="unassigned">Ээлж оноогоогүй</option></select></label>
          <label className="space-y-1 text-xs font-semibold">Хайх<div className="relative"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} className="pl-9" placeholder="Нэр, албан тушаал, утас" data-testid="input-search-employees" /></div></label>
        </div>
      </div>
    </section>
    {query.isLoading || shiftPlans.isLoading || shifts.isLoading ? <section className="space-y-3 rounded-2xl border border-border bg-card p-5"><LoadingBlock className="h-12" /><LoadingBlock className="h-12" /><LoadingBlock className="h-12" /></section> : query.isError || shiftPlans.isError || shifts.isError ? <ErrorBlock onRetry={() => { query.refetch(); shiftPlans.refetch(); shifts.refetch(); }} /> : employees.length === 0 ? <section className="rounded-2xl border border-border bg-card"><EmptyState title="Ажилтан олдсонгүй" detail="Хайлт болон шүүлтүүрээ өөрчлөөд үзнэ үү." icon={UsersRound} /></section> : <>
      {employeeTypeFilter !== 'shift' && officeEmployees.length > 0 && <section className="overflow-hidden rounded-2xl border border-border bg-card"><div className="flex items-center justify-between border-b border-border px-5 py-4"><div><h2 className="font-bold">Оффис ажилтнууд</h2><p className="text-xs text-muted-foreground">Тогтмол ажлын хуваарьтай ажилтнууд</p></div><span className="rounded-full bg-secondary px-3 py-1 font-mono text-xs font-bold">{officeEmployees.length}</span></div>{employeeTable(officeEmployees)}</section>}
      {employeeTypeFilter !== 'office' && shiftEmployees.length > 0 && <section className="overflow-hidden rounded-2xl border border-border bg-card"><div className="flex items-center justify-between border-b border-border px-5 py-4"><div><h2 className="font-bold">Ээлжийн ажилтнууд</h2><p className="text-xs text-muted-foreground">{shiftMonth} сарын ээлжийн хуваариар шүүж байна</p></div><span className="rounded-full bg-secondary px-3 py-1 font-mono text-xs font-bold">{shiftEmployees.length}</span></div>{employeeTable(shiftEmployees)}</section>}
    </>}
    {modal.open && <EmployeeModal employee={modal.employee} onClose={() => setModal({ open: false })} />}
  </div>;
  /*
  return <div className="page-enter"><div className="mb-6 flex justify-end"><Button onClick={() => setModal({ open: true })} data-testid="button-add-employee"><Plus className="size-4" />Ажилтан нэмэх</Button></div><section className="overflow-hidden rounded-2xl border border-border bg-card"><div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm font-bold">Бүх ажилтан <span className="ml-1 font-mono text-xs text-muted-foreground">{query.data?.length ?? 0}</span></p><div className="relative w-full sm:w-64"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" placeholder="Нэрээр хайх" data-testid="input-search-employees" /></div></div>{query.isLoading ? <div className="space-y-3 p-5"><LoadingBlock className="h-12" /><LoadingBlock className="h-12" /><LoadingBlock className="h-12" /></div> : query.isError ? <ErrorBlock onRetry={() => query.refetch()} /> : employees.length === 0 ? <EmptyState title="Ажилтан олдсонгүй" detail={search ? 'Хайлтын үгээ өөрчлөөд үзнэ үү.' : 'Эхний ажилтнаа бүртгэж эхлээрэй.'} icon={UsersRound} /> : <div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left"><thead className="bg-secondary/50 text-[10px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-5 py-3 font-bold">Ажилтан</th><th className="px-5 py-3 font-bold">Утас</th><th className="px-5 py-3 font-bold">Ажилтны төрөл</th><th className="px-5 py-3 font-bold">Цалин</th><th className="px-5 py-3 font-bold">НДШ-ийн цалин</th><th className="px-5 py-3 font-bold">Төлөв</th><th className="px-5 py-3 text-right font-bold">Үйлдэл</th></tr></thead><tbody className="divide-y divide-border">{employees.map((employee) => <tr className="group transition-colors hover:bg-secondary/35" key={employee.id} data-testid={`row-employee-${employee.id}`}><td className="px-5 py-4"><div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-xl bg-accent/30 text-xs font-bold text-foreground">{employee.name.slice(0, 1)}</span><div><p className="text-sm font-semibold">{employee.name}</p><p className="text-xs text-muted-foreground">{employee.role}</p></div></div></td><td className="px-5 py-4 text-sm text-muted-foreground">{employee.phone || '—'}</td><td className="px-5 py-4 text-sm">{employee.employeeType === EmployeeEmployeeType.office ? 'Оффис' : employee.salaryType === 'monthly' ? 'Ээлж (сарын)' : 'Ээлж (өдрийн)'}</td><td className="px-5 py-4"><p className="font-mono text-sm">{money(employee.baseSalary)}</p><p className="text-[10px] text-muted-foreground">{employee.salaryType === 'monthly' ? 'сарын' : 'өдрийн'}</p></td><td className="px-5 py-4 font-mono text-sm">{money(employee.socialInsuranceSalary)}</td><td className="px-5 py-4"><StatusPill value={employee.status} /></td><td className="px-5 py-4"><div className="flex justify-end gap-1"><button className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground" onClick={() => setModal({ open: true, employee })} aria-label={`${employee.name} засах`} data-testid={`button-edit-employee-${employee.id}`}><Pencil className="size-4" /></button><button className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive" onClick={() => del(employee)} aria-label={`${employee.name} устгах хүсэлт`} data-testid={`button-delete-employee-${employee.id}`}><Trash2 className="size-4" /></button></div></td></tr>)}</tbody></table></div>}</section>{modal.open && <EmployeeModal employee={modal.employee} onClose={() => setModal({ open: false })} />}</div>;
}

  */
}
