import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronRight, ShieldCheck, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { EmptyState, ErrorBlock, LoadingBlock } from '@/components/ui-primitives';
import {
  getListDeletionRequestsQueryKey,
  useApproveDeletionRequest,
  useCancelDeletionRequest,
  useListDeletionRequests,
  getListMealsQueryKey,
} from '@workspace/api-client-react';
import { dateLabel } from '@/lib/app-shared';

type MealEditRequest = {
  id: number;
  mealId: number;
  previousName: string;
  previousCategory: string;
  proposedName: string;
  proposedCategory: string;
  status: string;
  requestedAt: string;
  decidedAt?: string | null;
};

const mealEditRequestsKey = ['meal-edit-requests'];
async function mealEditFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${url}`, { ...init, credentials: 'include', headers: { 'Content-Type': 'application/json', ...init?.headers } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body?.error === 'string' ? body.error : 'Хүсэлтийг боловсруулах боломжгүй байна.');
  return body as T;
}

export function DeletionRequests() {
  const list = useListDeletionRequests();
  const mealEdits = useQuery({
    queryKey: mealEditRequestsKey,
    queryFn: () => mealEditFetch<MealEditRequest[]>('/meal-edit-requests'),
  });
  const approve = useApproveDeletionRequest();
  const cancel = useCancelDeletionRequest();
  const qc = useQueryClient();
  const resolveMealEdit = useMutation({
    mutationFn: ({ id, action }: { id: number; action: 'approve' | 'reject' }) =>
      mealEditFetch<MealEditRequest>(`/meal-edit-requests/${id}/${action}`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: mealEditRequestsKey });
      qc.invalidateQueries({ queryKey: getListMealsQueryKey() });
    },
  });
  const approveRequest = (id: number, label: string) => {
    if (!window.confirm(`"${label}" устгах хүсэлтийг баталж, одоо устгах уу?`)) return;
    approve.mutate({ id }, {
      onSuccess: () => {
        qc.invalidateQueries();
        window.alert('Устгах үйлдэл амжилттай хийгдлээ.');
      },
      onError: () => {
        qc.invalidateQueries({ queryKey: getListDeletionRequestsQueryKey() });
        window.alert('Устгах боломжгүй байна. Тухайн бүртгэлийн нөхцөлийг шалгана уу.');
      },
    });
  };
  const cancelRequest = (id: number, label: string) => {
    if (!window.confirm(`"${label}" устгах хүсэлтийг цуцлах уу?`)) return;
    cancel.mutate({ id }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListDeletionRequestsQueryKey() });
        window.alert('Устгах хүсэлтийг цуцаллаа.');
      },
    });
  };
  const statusMeta: Record<string, { label: string; className: string }> = {
    pending: { label: 'Хүлээгдэж байна', className: 'border-amber-200 bg-amber-50 text-amber-800' },
    executing: { label: 'Гүйцэтгэж байна', className: 'border-sky-200 bg-sky-50 text-sky-800' },
    completed: { label: 'Устгасан', className: 'border-emerald-200 bg-emerald-50 text-emerald-800' },
    failed: { label: 'Амжилтгүй', className: 'border-red-200 bg-red-50 text-red-800' },
    cancelled: { label: 'Цуцалсан', className: 'border-slate-200 bg-slate-100 text-slate-700' },
  };
  const mealEditStatus: Record<string, { label: string; className: string }> = {
    pending: { label: 'Хүлээгдэж байна', className: 'border-amber-200 bg-amber-50 text-amber-800' },
    approved: { label: 'Зөвшөөрсөн', className: 'border-emerald-200 bg-emerald-50 text-emerald-800' },
    rejected: { label: 'Татгалзсан', className: 'border-slate-200 bg-slate-100 text-slate-700' },
  };
  const resolveMealEditRequest = (request: MealEditRequest, action: 'approve' | 'reject') => {
    const verb = action === 'approve' ? 'зөвшөөрөх' : 'татгалзах';
    if (!window.confirm(`"${request.proposedName}" нэрийн өөрчлөлтийг ${verb} үү?`)) return;
    resolveMealEdit.mutate({ id: request.id, action });
  };
  return <div className="page-enter space-y-5">
    <section className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <div><h2 className="text-base font-bold">Хоолны өөрчлөлтийн хүсэлтүүд</h2><p className="mt-1 text-xs text-muted-foreground">Технологичийн нэр, ангиллын өөрчлөлтийг хянаж батална.</p></div>
        <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-900">{mealEdits.data?.filter((item) => item.status === 'pending').length ?? 0} хүлээгдэж байна</span>
      </div>
      {mealEdits.isLoading ? <div className="space-y-3 p-5"><LoadingBlock className="h-24" /><LoadingBlock className="h-24" /></div>
        : mealEdits.isError ? <ErrorBlock onRetry={() => mealEdits.refetch()} />
        : !mealEdits.data?.length ? <EmptyState title="Хоолны өөрчлөлтийн хүсэлт алга" detail="Технологич хүсэлт илгээхэд энд харагдана." icon={ShieldCheck} />
        : <div className="divide-y divide-border">{mealEdits.data.map((request) => {
          const meta = mealEditStatus[request.status] ?? mealEditStatus.pending;
          return <div key={request.id} className="flex flex-col gap-3 px-5 py-4" data-testid={`row-meal-edit-request-${request.id}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold">Хоол #{request.mealId}</p>
              <span className={cn('rounded-full border px-2.5 py-1 text-[10px] font-bold', meta.className)} data-testid={`status-meal-edit-request-${request.id}`}>{meta.label}</span>
            </div>
            <div className="grid gap-2 text-xs sm:grid-cols-[1fr_auto_1fr] sm:items-center">
              <div className="rounded-lg border border-border bg-secondary/40 p-3"><p className="mb-1 font-semibold text-muted-foreground">Одоогийн утга</p><p className="font-semibold">{request.previousName}</p><p className="text-muted-foreground">{request.previousCategory}</p></div>
              <ChevronRight className="hidden size-4 text-muted-foreground sm:block" />
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-3"><p className="mb-1 font-semibold text-primary">Санал болгосон</p><p className="font-semibold">{request.proposedName}</p><p className="text-muted-foreground">{request.proposedCategory}</p></div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted-foreground">Илгээсэн: {dateLabel(request.requestedAt)}{request.decidedAt ? ` · Шийдвэрлэсэн: ${dateLabel(request.decidedAt)}` : ''}</p>
              {request.status === 'pending' && <div className="flex gap-2"><Button variant="outline" onClick={() => resolveMealEditRequest(request, 'reject')} disabled={resolveMealEdit.isPending} data-testid={`button-reject-meal-edit-${request.id}`}><X className="size-4" />Татгалзах</Button><Button onClick={() => resolveMealEditRequest(request, 'approve')} disabled={resolveMealEdit.isPending} data-testid={`button-approve-meal-edit-${request.id}`}><Check className="size-4" />Зөвшөөрөх</Button></div>}
            </div>
            {resolveMealEdit.isError && resolveMealEdit.variables?.id === request.id && <p className="text-xs text-destructive" data-testid={`error-meal-edit-${request.id}`}>{resolveMealEdit.error instanceof Error ? resolveMealEdit.error.message : 'Хүсэлтийг боловсруулах боломжгүй байна.'}</p>}
          </div>;
        })}</div>}
    </section>
    <section className="overflow-hidden rounded-2xl border border-border bg-card">
    <div className="flex items-center justify-between border-b border-border px-5 py-4"><div><h2 className="text-base font-bold">Устгах хүсэлтүүд</h2><p className="mt-1 text-xs text-muted-foreground">Баталсны дараа л тухайн бүртгэл бодитоор устна.</p></div><span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-900">{list.data?.filter((item) => item.status === 'pending').length ?? 0} хүлээгдэж байна</span></div>
    {list.isLoading ? <div className="space-y-3 p-5"><LoadingBlock className="h-16" /><LoadingBlock className="h-16" /></div> : list.isError ? <ErrorBlock onRetry={() => list.refetch()} /> : !list.data?.length ? <EmptyState title="Устгах хүсэлт алга" detail="Устгах үйлдэл хийсэн үед хүсэлт энд харагдана." icon={ShieldCheck} /> : <div className="divide-y divide-border">{list.data.map((request) => { const meta = statusMeta[request.status] ?? statusMeta.pending; return <div key={request.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center" data-testid={`row-deletion-request-${request.id}`}><div className="min-w-0 flex-1"><p className="text-sm font-semibold">{request.label}</p><p className="mt-1 text-xs text-muted-foreground">{request.requesterRole} эрхээс · {dateLabel(request.requestedAt)}</p>{request.error && <p className="mt-1 text-xs text-destructive">Устгах нөхцөл хангагдсангүй.</p>}</div><span className={cn('w-fit rounded-full border px-2.5 py-1 text-[10px] font-bold', meta.className)}>{meta.label}</span>{request.status === 'pending' && <div className="flex gap-2"><Button variant="outline" onClick={() => cancelRequest(request.id, request.label)} disabled={cancel.isPending || approve.isPending} data-testid={`button-cancel-deletion-${request.id}`}><X className="size-4" />Цуцлах</Button><Button onClick={() => approveRequest(request.id, request.label)} disabled={approve.isPending || cancel.isPending} data-testid={`button-approve-deletion-${request.id}`}><Check className="size-4" />Баталж устгах</Button></div>}</div>; })}</div>}
  </section></div>;
}