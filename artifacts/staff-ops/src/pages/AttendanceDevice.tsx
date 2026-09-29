import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { ArrowDownRight, ArrowUpRight, Clock3, LockKeyhole, MonitorSmartphone, RefreshCw, ShieldCheck, WifiOff } from 'lucide-react';
import type { AttendanceDeviceRegistration, AttendanceDeviceStatus } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Form } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { LoadingBlock } from '@/components/ui-primitives';
import { clearDevice, directApiAvailable, enrollDevice, getDeviceStatus, getRegisteredDevice, punchDevice } from '@/lib/attendance-device-client';

type DeviceForm = { name: string };
const formatTime = (value: string | null) => value ? new Intl.DateTimeFormat('mn-MN', { timeZone: 'Asia/Ulaanbaatar', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : '—';
const explain = (error: unknown) => error instanceof Error ? error.message : 'Хүсэлт амжилтгүй боллоо. Дахин оролдоно уу.';

export function AttendanceDevice() {
  const [token, setToken] = useState<string | null>(null);
  const [registered, setRegistered] = useState(false);
  const [registration, setRegistration] = useState<AttendanceDeviceRegistration | null>(null);
  const [status, setStatus] = useState<AttendanceDeviceStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const available = directApiAvailable();
  const form = useForm<DeviceForm>({ defaultValues: { name: '' } });

  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const received = fragment.get('token');
    if (received) setToken(received);
    if (window.location.hash) window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
    let alive = true;
    if (!available) { setLoading(false); return () => { alive = false; }; }
    getRegisteredDevice().then(async (device) => {
      if (!alive) return;
      setRegistered(Boolean(device));
      if (device) {
        try {
          const current = await getDeviceStatus();
          if (alive) setStatus(current);
        } catch (cause) {
          if (alive) setError(explain(cause));
        }
      }
    }).catch((cause) => { if (alive) setError(explain(cause)); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [available]);

  const refresh = async () => {
    setWorking(true); setError('');
    try { setStatus(await getDeviceStatus()); }
    catch (cause) { setError(explain(cause)); }
    finally { setWorking(false); }
  };
  const enroll = async (values: DeviceForm) => {
    if (!token || !available) return;
    setWorking(true); setError(''); setNotice('');
    try {
      const result = await enrollDevice(token, values.name.trim());
      setRegistration(result); setRegistered(true); setToken(null);
      setNotice('Утас амжилттай бүртгэгдлээ.');
      try { setStatus(await getDeviceStatus()); } catch (cause) { setError(explain(cause)); }
    } catch (cause) { setError(explain(cause)); }
    finally { setWorking(false); }
  };
  const punch = async (action: 'check-in' | 'check-out') => {
    setWorking(true); setError(''); setNotice('');
    try {
      const updated = await punchDevice(action);
      setStatus(updated);
      setNotice(action === 'check-in' ? 'Ирсэн цаг бүртгэгдлээ.' : 'Тарсан цаг бүртгэгдлээ.');
    } catch (cause) { setError(explain(cause)); }
    finally { setWorking(false); }
  };
  const forget = async () => {
    if (!window.confirm('Энэ браузер дахь түлхүүрийг арилгах уу? Сервер дэх төхөөрөмжийн эрхийг хүний нөөц тусад нь цуцлах ёстой. Дахин ашиглахын тулд шинэ холбоос авна.')) return;
    setWorking(true); setError('');
    try { await clearDevice(); setRegistered(false); setStatus(null); setRegistration(null); setNotice('Энэ утасны бүртгэлийг арилгалаа.'); }
    catch (cause) { setError(explain(cause)); }
    finally { setWorking(false); }
  };

  return <div className="min-h-[100dvh] bg-background px-4 pb-[calc(env(safe-area-inset-bottom)+2rem)] pt-[calc(env(safe-area-inset-top)+1.5rem)] text-foreground sm:px-6">
    <div className="mx-auto max-w-md">
      <header className="flex items-center justify-between border-b border-border pb-5"><div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground"><Clock3 className="size-5" /></span><div><p className="text-sm font-bold tracking-tight">САМАСАА</p><p className="text-[11px] text-muted-foreground">Ажилтны ирц</p></div></div><span className="rounded-full bg-primary/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[.12em] text-primary">ОФФИС</span></header>
      <main className="pt-10">
        <p className="font-mono text-[10px] font-bold uppercase tracking-[.2em] text-primary">АЖЛЫН ӨДӨР / ИРЦ</p>
        <h1 className="mt-3 text-[clamp(2.25rem,9vw,3.5rem)] font-bold leading-[1.05] tracking-[-.055em]">Өнөөдрийн<br />бүртгэл</h1>
        <p className="mt-4 max-w-sm text-sm leading-relaxed text-muted-foreground">Өөрийн бүртгэлтэй утсаар оффисын сүлжээнд холбогдож, ирсэн болон тарсан цагаа тусад нь тэмдэглэнэ.</p>

        {!available ? <section className="mt-9 rounded-2xl border border-border bg-card p-6" role="status" data-testid="status-device-unavailable"><span className="grid size-11 place-items-center rounded-xl bg-secondary text-muted-foreground"><WifiOff className="size-5" /></span><h2 className="mt-5 text-lg font-bold">Энэ орчинд ашиглах боломжгүй</h2><p className="mt-2 text-sm leading-relaxed text-muted-foreground">Replit болон хөгжүүлэлтийн preview орчинд сервер оффисын нийтийн IP хаягийг найдвартай баталгаажуулах боломжгүй тул ирц бүртгэл хаалттай. Байгууллагын бодит хаягаар оффисын Wi-Fi сүлжээнээс нэвтэрнэ үү.</p></section> :
          loading ? <div className="mt-9 space-y-3" data-testid="loading-device"><LoadingBlock className="h-40" /><LoadingBlock className="h-14" /></div> : <>
            {token && <section className="mt-9 rounded-2xl border border-primary/20 bg-card p-6 shadow-sm" data-testid="section-device-enrollment"><span className="grid size-11 place-items-center rounded-xl bg-primary/10 text-primary"><MonitorSmartphone className="size-5" /></span><h2 className="mt-5 text-xl font-bold tracking-tight">Энэ утсыг бүртгэх</h2><p className="mt-2 text-sm leading-relaxed text-muted-foreground">Холбоос нэг удаа ашиглагдана. Утсаа таних нэр өгөөд үргэлжлүүлнэ үү.</p>{registered && <p className="mt-3 rounded-lg bg-accent/30 p-3 text-xs">Энэ браузер бүртгэлтэй байна. Шинэ холбоос ашиглахын өмнө хүний нөөцөөр хуучин төхөөрөмжийн эрхийг цуцлуулж, доорх товчоор браузер дахь түлхүүрийг арилгана уу.</p>}<Form {...form}><form onSubmit={form.handleSubmit(enroll)} className="mt-5 space-y-3"><label htmlFor="phone-name" className="text-xs font-semibold">Утасны нэр</label><Input id="phone-name" placeholder="Жишээ: Миний утас" autoComplete="off" maxLength={80} data-testid="input-device-name" {...form.register('name', { required: 'Утасны нэр оруулна уу.', validate: (value) => Boolean(value.trim()) || 'Утасны нэр оруулна уу.' })} />{form.formState.errors.name && <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>}<Button className="h-12 w-full" type="submit" disabled={working || registered} data-testid="button-enroll-device">{working ? 'Бүртгэж байна...' : 'Утсаа бүртгэх'}</Button></form></Form></section>}
            {registered && <section className="mt-5 overflow-hidden rounded-2xl border border-border bg-card shadow-sm" data-testid="section-device-status"><div className="border-b border-border px-6 py-5"><div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2 text-xs font-semibold text-primary"><ShieldCheck className="size-4" />Бүртгэлтэй төхөөрөмж</div><button type="button" onClick={refresh} disabled={working} className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-secondary" aria-label="Төлөв шинэчлэх" data-testid="button-refresh-device-status"><RefreshCw className="size-4" /></button></div>{registration && <p className="mt-2 text-xs text-muted-foreground" data-testid="text-device-name">{registration.name}</p>}</div><div className="px-6 py-7"><p className="font-mono text-[10px] font-bold uppercase tracking-[.15em] text-muted-foreground">ӨНӨӨДРИЙН ТӨЛӨВ</p><p className="mt-2 text-2xl font-bold tracking-tight" data-testid="status-attendance-device">{status?.state === 'checked-in' ? 'Ажил дээр байна' : status?.state === 'checked-out' ? 'Өдрөө дуусгасан' : status?.state === 'not-checked-in' ? 'Ирц эхлээгүй' : 'Төлөвийг шалгах шаардлагатай'}</p><p className="mt-1 font-mono text-xs text-muted-foreground" data-testid="text-office-date">{status?.officeDate ?? '—'}</p><div className="mt-6 grid grid-cols-2 gap-3"><div className="rounded-xl bg-secondary/60 p-4"><ArrowDownRight className="size-4 text-primary" /><p className="mt-3 text-[11px] text-muted-foreground">Ирсэн</p><p className="mt-1 font-mono text-lg font-bold" data-testid="time-checked-in">{formatTime(status?.checkedInAt ?? null)}</p></div><div className="rounded-xl bg-secondary/60 p-4"><ArrowUpRight className="size-4 text-primary" /><p className="mt-3 text-[11px] text-muted-foreground">Тарсан</p><p className="mt-1 font-mono text-lg font-bold" data-testid="time-checked-out">{formatTime(status?.checkedOutAt ?? null)}</p></div></div><div className="mt-6 grid gap-3"><Button className="h-12 w-full" disabled={working || !status || status.state !== 'not-checked-in'} onClick={() => punch('check-in')} data-testid="button-device-check-in"><ArrowDownRight className="size-4" />Ирсэн цаг бүртгэх</Button><Button variant="outline" className="h-12 w-full" disabled={working || !status || status.state !== 'checked-in'} onClick={() => punch('check-out')} data-testid="button-device-check-out"><ArrowUpRight className="size-4" />Тарсан цаг бүртгэх</Button></div></div></section>}
            {!registered && !token && <section className="mt-9 rounded-2xl border border-border bg-card p-6" data-testid="status-device-not-registered"><LockKeyhole className="size-6 text-primary" /><h2 className="mt-5 text-xl font-bold">Утас бүртгэгдээгүй</h2><p className="mt-2 text-sm leading-relaxed text-muted-foreground">Хүний нөөцөөс өөрт тань зориулсан 10 минутын холбоос аваад энэ утаснаасаа нээнэ үү.</p></section>}
            {registered && <button type="button" onClick={forget} disabled={working} className="mt-6 w-full py-3 text-xs font-semibold text-muted-foreground underline underline-offset-4 hover:text-destructive" data-testid="button-forget-device">Энэ браузер дахь түлхүүрийг арилгах</button>}
          </>}
        {error && <div className="mt-5 rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive" role="alert" data-testid="error-device">{error}</div>}
        {notice && <div className="mt-5 rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm font-medium text-primary" role="status" data-testid="notice-device">{notice}</div>}
      </main>
      <footer className="mt-14 flex items-start gap-2 border-t border-border pt-5 text-xs leading-relaxed text-muted-foreground"><ShieldCheck className="mt-0.5 size-4 shrink-0" />Ирц бүртгэл зөвхөн баталгаажсан утас болон оффисын нийтийн сүлжээнд ажиллана.</footer>
    </div>
  </div>;
}