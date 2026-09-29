import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Check, ClipboardCopy, Clock3, Link2, MonitorSmartphone, ShieldCheck, ShieldX, Wifi } from 'lucide-react';
import {
  EmployeeStatus,
  getGetDashboardQueryKey,
  getGetOfficeAttendanceNetworkQueryKey,
  getListAttendanceQueryKey,
  getListAttendanceDeviceEnrollmentsQueryKey,
  getListAttendanceDevicesQueryKey,
  getListOfficeAttendancePendingPunchesQueryKey,
  useCancelOfficeAttendancePendingPunch,
  useCreateAttendanceDeviceEnrollment,
  useGetOfficeAttendanceNetwork,
  useListAttendanceDeviceEnrollments,
  useListAttendanceDevices,
  useListEmployees,
  useListOfficeAttendancePendingPunches,
  useRevokeAttendanceDevice,
  useSetOfficeAttendanceNetwork,
  type AttendanceDeviceEnrollmentIssued,
  type OfficeAttendancePendingPunch,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Form } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { EmptyState, ErrorBlock, LoadingBlock, Modal, PageHeading } from '@/components/ui-primitives';
import { directApiAvailable } from '@/lib/attendance-device-client';

type NetworkForm = { officeIp: string };
type EnrollmentForm = { employeeId: string };
type CancellationForm = { reason: string };
const when = (date: string | null) => date ? new Intl.DateTimeFormat('mn-MN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(date)) : '—';
const officeTime = (date: string) => new Intl.DateTimeFormat('mn-MN', { timeZone: 'Asia/Ulaanbaatar', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(date));
const message = (error: unknown) => error instanceof Error ? error.message : 'Үйлдэл амжилтгүй боллоо. Дахин оролдоно уу.';

export function AttendanceDevices() {
  const qc = useQueryClient();
  const available = directApiAvailable();
  const network = useGetOfficeAttendanceNetwork();
  const enrollments = useListAttendanceDeviceEnrollments();
  const devices = useListAttendanceDevices();
  const pending = useListOfficeAttendancePendingPunches();
  const employees = useListEmployees();
  const setNetwork = useSetOfficeAttendanceNetwork();
  const issue = useCreateAttendanceDeviceEnrollment();
  const revoke = useRevokeAttendanceDevice();
  const cancelPending = useCancelOfficeAttendancePendingPunch();
  const [issued, setIssued] = useState<AttendanceDeviceEnrollmentIssued | null>(null);
  const [copied, setCopied] = useState(false);
  const [selectedPending, setSelectedPending] = useState<OfficeAttendancePendingPunch | null>(null);
  const networkForm = useForm<NetworkForm>({ defaultValues: { officeIp: '' } });
  const enrollmentForm = useForm<EnrollmentForm>({ defaultValues: { employeeId: '' } });
  const cancellationForm = useForm<CancellationForm>({ defaultValues: { reason: '' } });
  useEffect(() => {
    if (network.data) networkForm.reset({ officeIp: network.data.officeIp ?? '' });
  }, [network.data, networkForm.reset]);

  const activeEmployees = (employees.data ?? []).filter((employee) => employee.status === EmployeeStatus.active);
  const names = new Map((employees.data ?? []).map((employee) => [employee.id, employee.name]));
  const link = issued ? new URL(`${import.meta.env.BASE_URL.replace(/\/?$/, '/')}attendance/device#token=${encodeURIComponent(issued.token)}`, window.location.origin).href : '';
  const saveNetwork = (values: NetworkForm) => {
    setNetwork.mutate({ data: { officeIp: values.officeIp.trim() } }, {
      onSuccess: () => qc.invalidateQueries({ queryKey: getGetOfficeAttendanceNetworkQueryKey() }),
    });
  };
  const createLink = (values: EnrollmentForm) => {
    if (!available) return;
    const employeeId = Number(values.employeeId);
    if (!activeEmployees.some((employee) => employee.id === employeeId)) return;
    setIssued(null);
    setCopied(false);
    issue.mutate({ data: { employeeId } }, {
      onSuccess: (result) => {
        setIssued(result);
        qc.invalidateQueries({ queryKey: getListAttendanceDeviceEnrollmentsQueryKey() });
      },
    });
  };
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
      document.getElementById('issued-device-link')?.focus();
      (document.getElementById('issued-device-link') as HTMLInputElement | null)?.select();
    }
  };
  const revokeDevice = (id: number, name: string) => {
    if (!window.confirm(`“${name}” төхөөрөмжийн бүртгэлийг цуцлах уу? Энэ утаснаас дахин ирц бүртгэх боломжгүй болно.`)) return;
    revoke.mutate({ id }, { onSuccess: () => qc.invalidateQueries({ queryKey: getListAttendanceDevicesQueryKey() }) });
  };
  const closeCancellation = () => {
    if (cancelPending.isPending) return;
    setSelectedPending(null);
    cancellationForm.reset({ reason: '' });
    cancelPending.reset();
  };
  const submitCancellation = (values: CancellationForm) => {
    if (!selectedPending) return;
    const reason = values.reason.trim();
    if (reason.length < 5) {
      cancellationForm.setError('reason', { message: 'Шалтгаан хамгийн багадаа 5 тэмдэгттэй байна.' });
      return;
    }
    if (!window.confirm(`${selectedPending.employeeName} ажилтны ${selectedPending.officeDate}-ны ирсэн цагийн бүртгэлийг цуцлах уу? Энэ үйлдлийг буцаах боломжгүй.`)) return;
    cancelPending.mutate({ id: selectedPending.id, data: { reason } }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListOfficeAttendancePendingPunchesQueryKey() });
        qc.invalidateQueries({ queryKey: getListAttendanceQueryKey() });
        qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
        setSelectedPending(null);
        cancellationForm.reset({ reason: '' });
        cancelPending.reset();
      },
    });
  };

  return <div className="page-enter space-y-7">
    <PageHeading eyebrow="ИРЦ / ТӨХӨӨРӨМЖ" title="Оффисын ирцийн төхөөрөмж" detail="Оффисын сүлжээ болон ажилтны утасны эрхийг эндээс удирдана. Бүртгэлийн холбоос нэг удаа, 10 минут хүчинтэй." />
    {!available && <p role="status" className="rounded-xl border border-border bg-secondary/60 px-4 py-3 text-sm text-muted-foreground">Хөгжүүлэлтийн preview-д утасны ирц ажиллахгүй. Бүртгэлийн холбоосыг зөвхөн production сайтаас үүсгэнэ үү.</p>}
    <section className="overflow-hidden rounded-2xl border border-border bg-card" data-testid="section-office-pending-punches">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-5 sm:px-7">
        <div><h2 className="text-lg font-bold tracking-tight">Тараагүй ирц</h2><p className="mt-1 text-xs text-muted-foreground">Ирсэн цагаа бүртгэсэн, хараахан тараагүй ажилтнууд. Алдаатай бүртгэлийг шалтгаантайгаар цуцална.</p></div>
        <span className="flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1.5 text-xs font-bold text-primary"><CalendarClock className="size-4" /><span data-testid="count-office-pending-punches">{pending.data?.length ?? 0}</span> хүлээгдэж байна</span>
      </div>
      {pending.isLoading ? <div className="space-y-3 p-5 sm:p-7"><LoadingBlock className="h-16" /><LoadingBlock className="h-16" /></div>
        : pending.isError ? <div className="p-5 sm:p-7"><ErrorBlock onRetry={() => pending.refetch()} /></div>
        : !pending.data?.length ? <EmptyState title="Тараагүй ирц алга" detail="Ирсэн цагаа бүртгэсэн ажилтнууд энд харагдана." icon={Clock3} />
          : <div className="divide-y divide-border">{pending.data.map((punch) => <div key={punch.id} className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:px-7" data-testid={`row-office-pending-${punch.id}`}>
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-secondary text-primary"><Clock3 className="size-4" /></span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold" data-testid={`text-office-pending-employee-${punch.id}`}>{punch.employeeName}</p>
              <p className="mt-1 text-xs text-muted-foreground" data-testid={`text-office-pending-device-${punch.id}`}>Төхөөрөмж: {punch.deviceName}</p>
            </div>
            <div className="sm:text-right">
              <p className="font-mono text-xs font-bold" data-testid={`text-office-pending-date-${punch.id}`}>{punch.officeDate}</p>
              <p className="mt-1 text-xs text-muted-foreground" data-testid={`text-office-pending-check-in-${punch.id}`}>Ирсэн: {officeTime(punch.checkedInAt)} (Улаанбаатар)</p>
            </div>
            <Button type="button" variant="outline" size="sm" className="w-full shrink-0 sm:ml-3 sm:w-auto" onClick={() => { cancellationForm.reset({ reason: '' }); cancelPending.reset(); setSelectedPending(punch); }} data-testid={`button-cancel-office-pending-${punch.id}`}>Ирцийг цуцлах</Button>
          </div>)}</div>}
    </section>
    <div className="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <section className="rounded-2xl border border-border bg-card p-5 sm:p-7" data-testid="section-office-network">
        <div className="mb-6 flex items-start gap-4"><span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Wifi className="size-5" /></span><div><h2 className="text-lg font-bold tracking-tight">Оффисын сүлжээ</h2><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Ирц зөвхөн энэ нийтийн IP хаягаар холбогдсон үед бүртгэгдэнэ.</p></div></div>
        {network.isLoading ? <LoadingBlock className="h-28" /> : network.isError ? <ErrorBlock onRetry={() => network.refetch()} /> : <>
          <div className="mb-5 rounded-xl bg-secondary/60 p-4"><p className="text-[10px] font-bold uppercase tracking-[.16em] text-muted-foreground">БҮРТГЭЛТЭЙ IP</p><p className="mt-2 font-mono text-xl font-bold" data-testid="value-office-ip">{network.data?.officeIp ?? 'Тохируулаагүй'}</p></div>
          <Form {...networkForm}><form onSubmit={networkForm.handleSubmit(saveNetwork)} className="space-y-3">
            <label htmlFor="office-ip" className="text-xs font-semibold">Нийтийн статик IP хаяг</label>
            <div className="flex flex-col gap-2 sm:flex-row"><Input id="office-ip" className="font-mono" placeholder="Оффисын бодит нийтийн IP" autoComplete="off" data-testid="input-office-ip" {...networkForm.register('officeIp', { required: 'IP хаяг оруулна уу.' })} /><Button type="submit" disabled={setNetwork.isPending} data-testid="button-save-office-ip">{setNetwork.isPending ? 'Хадгалж байна...' : 'Хадгалах'}</Button></div>
            {networkForm.formState.errors.officeIp && <p className="text-xs text-destructive">{networkForm.formState.errors.officeIp.message}</p>}
          </form></Form>
          {setNetwork.isError && <p className="mt-3 text-xs text-destructive" role="alert" data-testid="error-save-office-ip">{message(setNetwork.error)}</p>}
          {setNetwork.isSuccess && !setNetwork.isPending && <p className="mt-3 text-xs font-semibold text-primary" role="status">IP хаяг хадгалагдлаа.</p>}
        </>}
      </section>
      <section className="rounded-2xl border border-border bg-card p-5 sm:p-7" data-testid="section-issue-device-link">
        <div className="mb-6 flex items-start gap-4"><span className="grid size-11 shrink-0 place-items-center rounded-xl bg-accent/50 text-foreground"><Link2 className="size-5" /></span><div><h2 className="text-lg font-bold tracking-tight">Утас бүртгэх холбоос</h2><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Идэвхтэй ажилтныг сонгож, холбоосыг зөвхөн тухайн ажилтанд дамжуулна уу.</p></div></div>
        {employees.isLoading ? <LoadingBlock className="h-20" /> : employees.isError ? <ErrorBlock onRetry={() => employees.refetch()} /> : !activeEmployees.length ? <EmptyState title="Идэвхтэй ажилтан алга" detail="Холбоос үүсгэхийн өмнө ажилтныг идэвхжүүлнэ үү." icon={MonitorSmartphone} /> : <Form {...enrollmentForm}><form onSubmit={enrollmentForm.handleSubmit(createLink)} className="space-y-3">
          <label htmlFor="device-employee" className="text-xs font-semibold">Ажилтан</label>
          <select id="device-employee" className="flex h-10 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring" data-testid="select-device-employee" {...enrollmentForm.register('employeeId', { required: true })}><option value="">Ажилтан сонгох</option>{activeEmployees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name} · {employee.role}</option>)}</select>
          {enrollmentForm.formState.errors.employeeId && <p className="text-xs text-destructive">Ажилтан сонгоно уу.</p>}
          <Button type="submit" disabled={issue.isPending || !available} data-testid="button-issue-device-link">{issue.isPending ? 'Үүсгэж байна...' : '10 минутын холбоос үүсгэх'}</Button>
        </form></Form>}
        {issue.isError && <p className="mt-3 text-xs text-destructive" role="alert" data-testid="error-issue-device-link">{message(issue.error)}</p>}
        {issued && <div className="mt-6 rounded-xl border border-primary/20 bg-primary/5 p-4" data-testid="panel-issued-device-link">
          <div className="flex items-center justify-between gap-3"><p className="text-sm font-bold">Холбоос бэлэн</p><button type="button" onClick={() => setIssued(null)} className="text-xs font-semibold text-muted-foreground underline underline-offset-2" data-testid="button-dismiss-device-link">Нуух</button></div>
          <p className="mt-1 text-xs text-muted-foreground">Дуусах хугацаа: <span data-testid="value-link-expires">{when(issued.expiresAt)}</span>. Нэг удаа хэрэглэсний дараа дахин ашиглах боломжгүй.</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row"><Input id="issued-device-link" readOnly value={link} onFocus={(event) => event.target.select()} className="min-w-0 font-mono text-xs" aria-label="Бүртгэлийн холбоос" data-testid="input-issued-device-link" /><Button type="button" variant="outline" onClick={copyLink} data-testid="button-copy-device-link">{copied ? <Check className="size-4" /> : <ClipboardCopy className="size-4" />}{copied ? 'Хуулсан' : 'Хуулах'}</Button></div>
        </div>}
      </section>
    </div>
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
      <section className="overflow-hidden rounded-2xl border border-border bg-card" data-testid="section-registered-devices">
        <div className="flex items-center justify-between border-b border-border px-5 py-5 sm:px-7"><div><h2 className="font-bold">Бүртгэлтэй утаснууд</h2><p className="mt-1 text-xs text-muted-foreground">Эрхийг цуцалбал тухайн төхөөрөмжөөр ирц бүртгэх боломжгүй.</p></div><MonitorSmartphone className="size-5 text-primary" /></div>
        {devices.isLoading ? <div className="space-y-3 p-5"><LoadingBlock className="h-16" /><LoadingBlock className="h-16" /></div> : devices.isError ? <ErrorBlock onRetry={() => devices.refetch()} /> : !devices.data?.length ? <EmptyState title="Одоогоор төхөөрөмж алга" detail="Ажилтанд бүртгэлийн холбоос илгээж эхэлнэ үү." icon={MonitorSmartphone} /> : <div className="divide-y divide-border">{devices.data.map((device) => <div key={device.id} className="flex flex-wrap items-center gap-3 px-5 py-4 sm:px-7" data-testid={`row-device-${device.id}`}><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-secondary text-primary"><MonitorSmartphone className="size-4" /></span><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{device.employeeName} <span className="font-normal text-muted-foreground">· {device.name}</span></p><p className="mt-1 text-[11px] text-muted-foreground">Бүртгэсэн: {when(device.createdAt)} · Сүүлд ашигласан: {when(device.lastUsedAt)}</p></div>{device.revokedAt ? <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-bold text-muted-foreground" data-testid={`status-device-${device.id}`}>Цуцалсан</span> : <><span className="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-bold text-primary" data-testid={`status-device-${device.id}`}>Идэвхтэй</span><Button variant="outline" size="sm" disabled={revoke.isPending} onClick={() => revokeDevice(device.id, device.name)} data-testid={`button-revoke-device-${device.id}`}><ShieldX className="size-3.5" />Цуцлах</Button></>}</div>)}</div>}
        {revoke.isError && <p className="px-5 py-3 text-xs text-destructive" role="alert" data-testid="error-revoke-device">{message(revoke.error)}</p>}
      </section>
      <section className="overflow-hidden rounded-2xl border border-border bg-card" data-testid="section-enrollment-history">
        <div className="flex items-center justify-between border-b border-border px-5 py-5 sm:px-7"><div><h2 className="font-bold">Холбоосын түүх</h2><p className="mt-1 text-xs text-muted-foreground">Нууц холбоос түүхэнд харагдахгүй.</p></div><Clock3 className="size-5 text-primary" /></div>
        {enrollments.isLoading ? <div className="space-y-3 p-5"><LoadingBlock className="h-14" /><LoadingBlock className="h-14" /></div> : enrollments.isError ? <ErrorBlock onRetry={() => enrollments.refetch()} /> : !enrollments.data?.length ? <EmptyState title="Холбоосын түүх хоосон" detail="Шинэ холбоос үүсгэхэд энд бүртгэгдэнэ." icon={Link2} /> : <div className="divide-y divide-border">{enrollments.data.map((item) => { const state = item.revokedAt ? 'Цуцалсан' : item.usedAt ? 'Ашигласан' : new Date(item.expiresAt).getTime() < Date.now() ? 'Хугацаа дууссан' : 'Хүлээгдэж байна'; return <div key={item.id} className="flex items-center gap-3 px-5 py-4 sm:px-7" data-testid={`row-enrollment-${item.id}`}><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-secondary text-primary">{item.usedAt ? <ShieldCheck className="size-4" /> : <Link2 className="size-4" />}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{names.get(item.employeeId) ?? `Ажилтан #${item.employeeId}`}</p><p className="mt-1 text-[11px] text-muted-foreground">Үүсгэсэн: {when(item.createdAt)} · Дуусах: {when(item.expiresAt)}</p></div><span className="shrink-0 text-[11px] font-semibold text-muted-foreground" data-testid={`status-enrollment-${item.id}`}>{state}</span></div>; })}</div>}
      </section>
    </div>
    <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />Ирц бүртгэх үед төхөөрөмж болон оффисын IP хаягийг сервер шалгана. Хөгжүүлэлтийн орчинд IP баталгаажуулалт хаалттай байж болно.</p>
    {selectedPending && <Modal title="Ирсэн цагийг цуцлах" detail="Энэ үйлдэл бүртгэлийн түүхэнд шалтгааны хамт хадгалагдана." onClose={closeCancellation}>
      <div className="mb-5 rounded-xl bg-secondary/60 p-4 text-sm">
        <p className="font-bold" data-testid="text-cancellation-employee">{selectedPending.employeeName}</p>
        <p className="mt-1 text-xs text-muted-foreground">{selectedPending.officeDate} · {selectedPending.deviceName}</p>
        <p className="mt-1 text-xs text-muted-foreground">Ирсэн: {officeTime(selectedPending.checkedInAt)} (Улаанбаатар)</p>
      </div>
      <Form {...cancellationForm}><form onSubmit={cancellationForm.handleSubmit(submitCancellation)} className="space-y-4">
        <div className="space-y-2"><label htmlFor="pending-cancellation-reason" className="text-xs font-semibold">Цуцлах шалтгаан <span className="text-destructive">*</span></label>
          <textarea id="pending-cancellation-reason" rows={3} maxLength={250} placeholder="Жишээ: Ажилтан буруу өдөр ирц бүртгэсэн" className="w-full resize-y rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" data-testid="input-pending-cancellation-reason" {...cancellationForm.register('reason', { required: 'Цуцлах шалтгаан оруулна уу.', validate: (value) => value.trim().length >= 5 || 'Шалтгаан хамгийн багадаа 5 тэмдэгттэй байна.' })} />
          {cancellationForm.formState.errors.reason && <p className="text-xs text-destructive" role="alert">{cancellationForm.formState.errors.reason.message}</p>}
        </div>
        {cancelPending.isError && <p className="text-xs text-destructive" role="alert" data-testid="error-cancel-office-pending">{message(cancelPending.error)}</p>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button type="button" variant="outline" onClick={closeCancellation} disabled={cancelPending.isPending} data-testid="button-close-pending-cancellation">Болих</Button><Button type="submit" variant="destructive" disabled={cancelPending.isPending} data-testid="button-confirm-pending-cancellation">{cancelPending.isPending ? 'Цуцалж байна...' : 'Шалтгаантайгаар цуцлах'}</Button></div>
      </form></Form>
    </Modal>}
  </div>;
}