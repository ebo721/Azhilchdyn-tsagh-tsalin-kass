import { type ComponentType, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BookOpen, Pencil, Plus, Receipt, Trash2, UsersRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorBlock, LoadingBlock, PageHeading } from '@/components/ui-primitives';
import {
  getListInventoryCustodiansQueryKey,
  getListUsersQueryKey,
  useDeleteUser,
  useListUsers,
  useListEmployees,
  type User,
} from '@workspace/api-client-react';
import { STAFF_MENUS, visibleMenuPaths, type MenuStaffRole } from '@workspace/api-zod';
import { UserFormModal, userRoleLabels } from './UserForm';

export function UserEditModal({ user, onClose }: { user: User; onClose: () => void }) {
  return <UserFormModal user={user} onClose={onClose} />;
}

export function UserSettings({ UnclearTransactionsSettings, ChartOfAccountsSettings }: {
  UnclearTransactionsSettings: ComponentType;
  ChartOfAccountsSettings: ComponentType;
}) {
  const users = useListUsers();
  const empList = useListEmployees();
  const employeeNames = useMemo(() => new Map((empList.data ?? []).map((e) => [e.id, e.name])), [empList.data]);
  const deletion = useDeleteUser();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<User | null>(null);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState('');
  const [section, setSection] = useState<'users' | 'transactions' | 'chart-of-accounts'>('users');
  const remove = (user: User) => {
    if (!window.confirm(`${user.username} хэрэглэгчийг устгах уу?`)) return;
    deletion.mutate({ id: user.id }, {
      onSuccess: () => { qc.invalidateQueries({ queryKey: getListUsersQueryKey() }); qc.invalidateQueries({ queryKey: getListInventoryCustodiansQueryKey() }); },
      onError: () => window.alert('Устгах боломжгүй байна. Өөрийн болон сүүлийн админы бүртгэлийг устгахгүй.'),
    });
  };
  return <div className="page-enter"><PageHeading eyebrow="Admin" title="Хэрэглэгчийн тохиргоо" detail="Хэрэглэгч, тусгай гүйлгээ болон дансны төлөвлөгөөг удирдана." action={section === 'users' ? <Button onClick={() => setCreating(true)} data-testid="button-create-user"><Plus className="size-4" />Хэрэглэгч нэмэх</Button> : undefined} />
    {notice && section === 'users' && <div className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 text-xs font-semibold text-primary" role="status" data-testid="status-user-saved"><span>{notice}</span><button type="button" className="underline" onClick={() => setNotice('')}>Хаах</button></div>}
    <div className="mb-5 flex w-fit flex-wrap gap-1 rounded-xl border border-border bg-card p-1"><Button variant={section === 'users' ? 'default' : 'ghost'} onClick={() => setSection('users')} data-testid="button-settings-users"><UsersRound className="size-4" />Хэрэглэгч</Button><Button variant={section === 'transactions' ? 'default' : 'ghost'} onClick={() => setSection('transactions')} data-testid="button-settings-transactions"><Receipt className="size-4" />Гүйлгээ</Button><Button variant={section === 'chart-of-accounts' ? 'default' : 'ghost'} onClick={() => setSection('chart-of-accounts')} data-testid="button-settings-chart-of-accounts"><BookOpen className="size-4" />Дансны төлөвлөгөө</Button></div>
    {section === 'transactions' ? <UnclearTransactionsSettings /> : section === 'chart-of-accounts' ? <ChartOfAccountsSettings /> : <section className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="border-b border-border px-5 py-4"><h2 className="text-base font-bold">Бүх хэрэглэгч</h2><p className="mt-1 text-xs text-muted-foreground">Нууц үг хэзээ ч харагдахгүй.</p></div>
      {users.isLoading ? <div className="space-y-3 p-5"><LoadingBlock className="h-16" /><LoadingBlock className="h-16" /></div> : users.isError ? <ErrorBlock onRetry={() => users.refetch()} /> : <div className="divide-y divide-border">{!users.data?.length ? <EmptyState title="Хэрэглэгч алга" detail="Хэрэглэгч нэмэх товчоор эхний бүртгэлийг үүсгэнэ үү." icon={UsersRound} /> : users.data.map((user) => <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center" key={user.id} data-testid={`row-user-${user.id}`}><div className="min-w-0 flex-1"><p className="text-sm font-semibold" data-testid={`text-user-name-${user.id}`}>{user.username}</p>{user.role === 'warehouse' && <p className="mt-0.5 text-[11px] text-muted-foreground" data-testid={`text-user-custodians-${user.id}`}>Хариуцагч: {user.custodianEmployeeIds?.length ? user.custodianEmployeeIds.map((id) => employeeNames.get(id) ?? `#${id}`).join(', ') : 'сонгоогүй'}</p>}<p className="mt-1 text-xs text-muted-foreground">{userRoleLabels[user.role] ?? user.role}{user.fullName ? ` · ${user.fullName}` : ''}</p><p className="mt-0.5 text-[11px] text-muted-foreground" data-testid={`text-user-menus-${user.id}`}>{user.menuPaths == null ? 'Цэс: үндсэн' : 'Цэс: '}{(() => { const n = visibleMenuPaths(user.role as MenuStaffRole, user.menuPaths).length; return n ? `${n}/${STAFF_MENUS.length}` : 'сонгоогүй'; })()}</p></div><div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => setEditing(user)} data-testid={`button-edit-user-${user.id}`}><Pencil className="size-4" />Засах</Button><Button variant="outline" size="sm" onClick={() => remove(user)} disabled={deletion.isPending} className="text-destructive hover:text-destructive"><Trash2 className="size-4" />Устгах</Button></div></div>)}</div>}
    </section>}
    {editing && <UserFormModal user={editing} onClose={() => setEditing(null)} onSaved={setNotice} />}
    {creating && <UserFormModal onClose={() => setCreating(false)} onSaved={setNotice} />}
  </div>;
}