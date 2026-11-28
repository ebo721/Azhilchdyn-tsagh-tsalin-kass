import './_group.css';
import { AppShell } from './_OriginalShell';
import { Payroll } from './_OriginalPayroll';

export default function Current() {
  return <AppShell role="admin" onLogout={() => {}}>
    <p className="mb-5 rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
      Одоогийн дэлгэц · Урьдчилгаа хэсгийг нээсэн төлөв · Жишээ өгөгдөл
    </p>
    <Payroll />
  </AppShell>;
}
