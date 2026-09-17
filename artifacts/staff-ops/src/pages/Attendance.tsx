import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Form } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { CalendarDays, ChevronRight, Clock3, Copy, Pencil, Trash2, UsersRound } from 'lucide-react';
import {
  EmployeeEmployeeType,
  EmployeeStatus,
  getGetDashboardQueryKey,
  getGetHourBalanceQueryKey,
  getGetPayrollQueryKey,
  getListAttendanceQueryKey,
  getListShiftPlansQueryKey,
  getListShiftsQueryKey,
  useCopyPreviousShiftPlans,
  useCreateShift,
  useDeleteShift,
  useListAttendance,
  useListEmployees,
  useListShiftPlans,
  useListShifts,
  useUpdateShift,
  useUpsertAttendance,
  useUpsertShiftPlan,
  type Shift,
} from '@workspace/api-client-react';
import { EmptyState, ErrorBlock, LoadingBlock, Modal } from '@/components/ui-primitives';
import { currentMonth, dateLabel, shiftMonth, today } from '@/lib/app-shared';
import { useQueueDeletion } from '@/hooks/useQueueDeletion';

const mongolianMonthLabel = (value: string) => {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value);
  return match ? `${match[1]} он ${Number(match[2])} сар` : value;
};
const calendarDays = (month: string) => {
  const [year, monthNumber] = month.split('-').map(Number);
  const dayCount = new Date(year, monthNumber, 0).getDate();
  return Array.from({ length: dayCount }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`);
};
const mongolianWeekdayLabel = (value: string) => {
  const [year, month, day] = value.split('-').map(Number);
  return ['Ням', 'Да', 'Мя', 'Лха', 'Пү', 'Ба', 'Бя'][new Date(year, month - 1, day).getDay()];
};
type ShiftForm = { name: string; startTime: string; endTime: string };

export function ShiftSettingsModal({ onClose }: { onClose: () => void }) {
  const shifts = useListShifts();
  const create = useCreateShift();
  const update = useUpdateShift();
  const deletion = useQueueDeletion();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Shift | null>(null);
  const form = useForm<ShiftForm>({ defaultValues: { name: '', startTime: '09:00', endTime: '18:00' } });
  const reset = () => { setEditing(null); form.reset({ name: '', startTime: '09:00', endTime: '18:00' }); };
  const submit = (data: ShiftForm) => {
    const done = () => { qc.invalidateQueries({ queryKey: getListShiftsQueryKey() }); reset(); };
    if (editing) update.mutate({ id: editing.id, data }, { onSuccess: done });
    else create.mutate({ data }, { onSuccess: done });
  };
  const edit = (shift: Shift) => {
    setEditing(shift);
    form.reset({ name: shift.name, startTime: shift.startTime, endTime: shift.endTime });
  };
  const del = (shift: Shift) => {
    if (!window.confirm(`${shift.name} ээлжийг устгах уу?`)) return;
    deletion.request(`/attendance/shifts/${shift.id}`, `${shift.name} ээлж`);
  };
  return <Modal title="Ээлжийн тохиргоо" detail="Ээлжийн нэр болон өдөр бүрийн эхлэх, тарах цагийг удирдана." onClose={onClose}>
    <Form {...form}><form onSubmit={form.handleSubmit(submit)} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_120px_120px]">
        <label className="space-y-1.5 text-xs font-semibold">Ээлжийн нэр<Input {...form.register('name', { required: true })} placeholder="Өдрийн ээлж" data-testid="input-shift-name" /></label>
        <label className="space-y-1.5 text-xs font-semibold">Эхлэх цаг<Input type="time" {...form.register('startTime', { required: true })} data-testid="input-shift-start" /></label>
        <label className="space-y-1.5 text-xs font-semibold">Тарах цаг<Input type="time" {...form.register('endTime', { required: true })} data-testid="input-shift-end" /></label>
      </div>
      <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={editing ? reset : onClose}>{editing ? 'Болих' : 'Хаах'}</Button><Button type="submit" disabled={create.isPending || update.isPending}>{editing ? 'Өөрчлөх' : 'Ээлж нэмэх'}</Button></div>
    </form></Form>
    <div className="mt-6 border-t border-border pt-5">
      <p className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">Бүртгэлтэй ээлжүүд</p>
      {shifts.isLoading ? <LoadingBlock className="h-20" /> : !shifts.data?.length ? <div className="rounded-xl bg-secondary/50 p-4 text-center text-xs text-muted-foreground">Ээлж бүртгээгүй байна.</div> : <div className="space-y-2">{shifts.data.map((shift) => <div key={shift.id} className="flex items-center gap-3 rounded-xl border border-border p-3"><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{shift.name}</p><p className="font-mono text-xs text-muted-foreground">{shift.startTime} — {shift.endTime}</p></div><button type="button" onClick={() => edit(shift)} className="grid size-8 place-items-center rounded-lg hover:bg-secondary" aria-label={`${shift.name} засах`}><Pencil className="size-4" /></button><button type="button" onClick={() => del(shift)} className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive" aria-label={`${shift.name} устгах`}><Trash2 className="size-4" /></button></div>)}</div>}
      {deletion.isError && <p className="mt-2 text-xs text-destructive">Устгах хүсэлт үүсгэхэд алдаа гарлаа.</p>}
    </div>
  </Modal>;
}

export function AttendancePage() {
  const [month, setMonth] = useState(currentMonth());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const days = useMemo(() => calendarDays(month), [month]);
  const query = useListAttendance({ month });
  const employees = useListEmployees();
  const shifts = useListShifts();
  const plans = useListShiftPlans({ month });
  const upsert = useUpsertAttendance();
  const deletion = useQueueDeletion();
  const clearAttendance = deletion;
  const upsertPlan = useUpsertShiftPlan();
  const copyPreviousPlans = useCopyPreviousShiftPlans();
  const qc = useQueryClient();
  const attendanceMap = useMemo(() => new Map((query.data ?? []).map((row) => [`${row.employeeId}-${row.date}`, row])), [query.data]);
  const planMap = useMemo(() => new Map((plans.data ?? []).map((row) => [`${row.employeeId}-${row.date}`, row])), [plans.data]);
  const officeEmployees = (employees.data ?? []).filter((employee) => employee.status === EmployeeStatus.active && employee.employeeType === EmployeeEmployeeType.office);
  const shiftEmployees = (employees.data ?? []).filter((employee) => employee.status === EmployeeStatus.active && employee.employeeType === EmployeeEmployeeType.shift);
  const activeEmployees = [...officeEmployees, ...shiftEmployees];
  const setAttendance = (employeeId: number, date: string, value: string) => {
    const refreshAttendance = () => {
      qc.invalidateQueries({ queryKey: getListAttendanceQueryKey() });
      qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
      qc.invalidateQueries({ queryKey: getGetPayrollQueryKey() });
      qc.invalidateQueries({ queryKey: getGetHourBalanceQueryKey({ month: date.slice(0, 7) }) });
    };
    if (!value) {
      const employeeName = activeEmployees.find((employee) => employee.id === employeeId)?.name ?? `#${employeeId}`;
      if (window.confirm(`${employeeName} ажилтны ${dateLabel(date)}-ны ирцийг устгах уу?`)) {
        deletion.request(`/attendance?employeeId=${employeeId}&date=${date}`, `${employeeName} · ${dateLabel(date)}-ны ирц`);
      }
      return;
    }
    const isLeave = value === 'leave';
    const hours = isLeave ? 0 : 8;
    upsert.mutate({ data: { employeeId, date, status: isLeave ? 'leave' : 'present', hours } }, { onSuccess: refreshAttendance });
  };
  const setPlan = (employeeId: number, date: string, value: string) => {
    upsertPlan.mutate({ data: { employeeId, date, shiftId: value ? Number(value) : null } }, {
      onSuccess: () => qc.invalidateQueries({ queryKey: getListShiftPlansQueryKey({ month }) }),
    });
  };
  const copyPreviousMonth = () => {
    const sourceMonth = window.prompt('Аль сараас ээлжийн төлөвлөгөө хуулах вэ? (Жишээ: 2026-08)', shiftMonth(month, -1));
    if (!sourceMonth) return;
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(sourceMonth)) { window.alert('Сарыг YYYY-MM хэлбэрээр зөв оруулна уу.'); return; }
    if (sourceMonth === month) { window.alert('Эх сар болон зорилтот сар ижил байж болохгүй.'); return; }
    if (!window.confirm(`${sourceMonth} сарын ээлжийн төлөвлөгөөг ${month} сар руу хуулах уу?`)) return;
    const hasExistingPlans = Boolean(plans.data?.length);
    const overwrite = hasExistingPlans ? window.confirm(`${month} сард аль хэдийн төлөвлөсөн ээлж байна. Давхардсан өдрүүдийг дарж бичих үү?\n\n“Цуцлах” сонговол одоо байгаа ээлжүүдийг хэвээр үлдээн, зөвхөн хоосон өдрүүдийг хуулна.`) : false;
    copyPreviousPlans.mutate({ data: { sourceMonth, month, overwrite } }, {
      onSuccess: (result) => {
        qc.invalidateQueries({ queryKey: getListShiftPlansQueryKey({ month }) });
        window.alert(`${result.sourceMonth} сараас ${result.copied} ээлж хууллаа.${result.overwritten ? ` ${result.overwritten} ээлжийг дарж бичлээ.` : ''}${result.skipped ? ` ${result.skipped} давхардлыг алгаслаа.` : ''}${result.unavailableDates ? ` Шинэ сард байхгүй ${result.unavailableDates} өдрийг алгаслаа.` : ''}`);
      },
    });
  };
  return <div className="page-enter">
    <div className="flex flex-wrap items-center justify-end gap-2"><Button variant="outline" onClick={copyPreviousMonth} disabled={copyPreviousPlans.isPending || plans.isLoading} data-testid="button-copy-previous-shift-plans"><Copy className="size-4" />{copyPreviousPlans.isPending ? 'Хуулж байна...' : 'Ээлж хуулах'}</Button><Button variant="outline" onClick={() => setSettingsOpen(true)} data-testid="button-shift-settings"><Clock3 className="size-4" />Ээлжийн тохиргоо</Button><div className="flex items-center overflow-hidden rounded-xl border border-border bg-card"><button type="button" onClick={() => setMonth((value) => shiftMonth(value, -1))} className="grid size-10 place-items-center border-r border-border text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground" aria-label="Өмнөх сар" data-testid="button-attendance-previous-month"><ChevronRight className="size-4 rotate-180" /></button><div className="flex items-center gap-2 px-3"><CalendarDays className="size-4 text-primary" /><label className="relative flex h-10 min-w-28 cursor-pointer items-center text-sm font-medium"><span>{mongolianMonthLabel(month)}</span><input type="month" value={month} onChange={(event) => setMonth(event.target.value)} className="absolute inset-0 cursor-pointer opacity-0" aria-label="Ирцийн сар сонгох" data-testid="input-attendance-month" /></label></div><button type="button" onClick={() => setMonth((value) => shiftMonth(value, 1))} className="grid size-10 place-items-center border-l border-border text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground" aria-label="Дараагийн сар" data-testid="button-attendance-next-month"><ChevronRight className="size-4" /></button></div></div>
    <section className="overflow-hidden rounded-2xl border border-border bg-card" data-testid="attendance-calendar">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4"><h2 className="text-base font-bold">{month.replace('-', ' оны ')} сарын ирц</h2><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-secondary px-3 py-1 text-[10px] font-bold">Оффис {officeEmployees.length}</span><span className="rounded-full bg-primary/10 px-3 py-1 text-[10px] font-bold text-primary">Ээлжийн {shiftEmployees.length}</span><span className="rounded-full bg-secondary px-3 py-1 font-mono text-[10px] font-bold">{days.length} хоног</span></div></div>
      {query.isLoading || employees.isLoading || shifts.isLoading || plans.isLoading ? <div className="space-y-3 p-5"><LoadingBlock className="h-12" /><LoadingBlock className="h-12" /><LoadingBlock className="h-12" /></div> : query.isError || employees.isError || shifts.isError || plans.isError ? <ErrorBlock onRetry={() => { query.refetch(); employees.refetch(); shifts.refetch(); plans.refetch(); }} /> : !activeEmployees.length ? <EmptyState title="Идэвхтэй ажилтан алга" detail="Эхлээд ажилтны бүртгэлээс ажилтан нэмнэ үү." icon={UsersRound} /> : <div className="overflow-x-auto"><table className="w-full table-fixed text-left" style={{ minWidth: `${208 + days.length * 84}px` }}><thead className="bg-secondary/50 text-[10px] uppercase tracking-wider text-muted-foreground"><tr><th className="sticky left-0 z-10 w-52 border-r border-border bg-secondary/95 px-5 py-3">Ажилтан</th>{days.map((day) => <th className={cn('w-[84px] px-1 py-3 text-center', day === today() && 'bg-accent/35 text-foreground')} key={day}><div className="font-mono text-[11px]">{day.slice(8)}</div><div className="mt-1 text-[9px] uppercase">{mongolianWeekdayLabel(day)}</div></th>)}</tr></thead><tbody className="divide-y divide-border">{activeEmployees.map((employee) => <tr key={employee.id} data-testid={`row-attendance-calendar-${employee.id}`}><td className="sticky left-0 z-10 border-r border-border bg-card px-5 py-3"><p className="truncate text-sm font-semibold">{employee.name}</p><p className="truncate text-[11px] text-muted-foreground">{employee.role}</p><p className="mt-1 text-[10px] font-medium text-primary">{employee.employeeType === EmployeeEmployeeType.shift ? 'Ээлжийн' : 'Оффис'}</p></td>{days.map((day) => { const row = attendanceMap.get(`${employee.id}-${day}`); const plan = planMap.get(`${employee.id}-${day}`); const value = row?.status === 'leave' ? 'leave' : row ? 'worked' : ''; const isShiftEmployee = employee.employeeType === EmployeeEmployeeType.shift; return <td className={cn('border-l border-border/60 p-1 text-center', day === today() && 'bg-accent/10')} key={day}>{isShiftEmployee && <select value={plan?.shiftId ?? ''} disabled={upsertPlan.isPending} onChange={(event) => setPlan(employee.id, day, event.target.value)} className="h-8 w-full rounded-md border border-border bg-background px-1 text-[10px] font-semibold outline-none focus:ring-2 focus:ring-primary/30" aria-label={`${employee.name} ${day} ээлж`} data-testid={`select-shift-plan-${employee.id}-${day}`}><option value="">Ээлжгүй</option>{shifts.data?.map((shift) => <option value={shift.id} key={shift.id}>{shift.name}</option>)}</select>}<select value={value} disabled={upsert.isPending || clearAttendance.isPending} onChange={(event) => setAttendance(employee.id, day, event.target.value)} className={cn(isShiftEmployee && 'mt-1', 'h-7 w-full rounded-md border-0 text-center font-mono text-[10px] font-bold outline-none transition-colors focus:ring-2 focus:ring-primary/30', value === 'worked' ? 'bg-primary text-primary-foreground' : value === 'leave' ? 'bg-sky-100 text-sky-800' : 'bg-secondary/60 text-muted-foreground/60')} aria-label={`${employee.name} ${day} ирц`} data-testid={`select-attendance-${employee.id}-${day}`}><option value="">Ирц</option><option value="worked">Ажилласан</option><option value="leave">Чөлөө</option></select></td>; })}</tr>)}</tbody></table></div>}
    </section>
    {settingsOpen && <ShiftSettingsModal onClose={() => setSettingsOpen(false)} />}
  </div>;
}