import { type ComponentType, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BookOpen, Pencil, Receipt, Trash2, UsersRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState, ErrorBlock, LoadingBlock, Modal, PageHeading } from '@/components/ui-primitives';
import {
  getGetAuthSessionQueryKey,
  getListInventoryCustodiansQueryKey,
  getListUsersQueryKey,
  useDeleteUser,
  useGetAuthSession,
  useUpdateUser,
  useListUsers,
  useListEmployees,
  type User,
} from '@workspace/api-client-react';

const userRoleLabels: Record<string, string> = {
  admin: 'Админ',
  hr: 'Хүний нөөц (HR)',
  accountant: 'Нягтлан',
  warehouse: 'Нярав (агуулах)',
  viewer: 'Харах эрхтэй',
  technologist: 'Хоолны технологич',
};

export function UserEditModal({ user, onClose }: { user: User; onClose: () => void }) {
  const update = useUpdateUser();
  const qc = useQueryClient();
  const [username, setUsername] = useState(user.username);
  const employees = useListEmployees();
  const [ids, setIds] = useState<number[]>(user.custodianEmployeeIds ?? []);
  const [search, setSearch] = useState('');
  const q = search.trim().toLocaleLowerCase('mn-MN');
  const results = useMemo(() => (employees.data ?? []).filter((e) => !q || e.name.toLocaleLowerCase('mn-MN').includes(q)), [employees.data, q]);
  const nameOf = (id: number) => employees.data?.find((e) => e.id === id)?.name ?? `Ажилтан #${id}`;
  const toggle = (id: number) => setIds((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  const [role, setRole] = useState(user.role);
  const [newPassword, setNewPassword] = useState('');
  const save = () => update.mutate({ id: user.id, data: { username, role, ...(role === 'warehouse' ? { custodianEmployeeIds: ids } : {}), ...(newPassword ? { newPassword } : {}) } }, {
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: getListUsersQueryKey() });
      qc.invalidateQueries({ queryKey: getListInventoryCustodiansQueryKey() });
      qc.invalidateQueries({ queryKey: getGetAuthSessionQueryKey() });
      onClose();
    },
  });
  return <Modal title="Хэрэглэгч засах" detail="Шинэ нууц үгийг хоосон орхивол өөрчлөгдөхгүй." onClose={onClose}>
    <div className="space-y-4">
      <label className="block space-y-1.5 text-xs font-semibold">Нэвтрэх нэр<Input value={username} onChange={(event) => setUsername(event.target.value)} data-testid="input-user-username" /></label>
      <label className="block space-y-1.5 text-xs font-semibold">Эрх<select value={role} onChange={(event) => setRole(event.target.value as User['role'])} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" data-testid="select-user-role">{Object.entries(userRoleLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
      {role === 'warehouse' && <div className="space-y-2 text-xs font-semibold">
        <p>Хариуцагч ажилчид</p>
        <div className="flex flex-wrap gap-1.5">{ids.length ? ids.map((id) => <span key={id} className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1">{nameOf(id)}<button type="button" onClick={() => toggle(id)} aria-label="Хасах" data-testid={`button-remove-custodian-${id}`}>×</button></span>) : <span className="font-normal text-muted-foreground">Сонгоогүй</span>}</div>
        <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Ажилтны нэрээр хайх" data-testid="input-custodian-employee-search" />
        {employees.isLoading ? <LoadingBlock className="h-16" /> : employees.isError ? <div className="flex items-center justify-between rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive"><span>Ажилчдыг ачаалж чадсангүй.</span><button type="button" className="font-bold underline" onClick={() => employees.refetch()} data-testid="button-retry-custodian-employees">Дахин оролдох</button></div>
        : !results.length ? <p className="font-normal text-muted-foreground" data-testid="text-custodian-empty">Ажилтан олдсонгүй.</p>
        : <div className="max-h-44 divide-y divide-border overflow-y-auto rounded-lg border border-border" data-testid="list-custodian-employee-results">{results.map((e) => <label key={e.id} className="flex cursor-pointer items-center gap-2 px-3 py-2 font-normal hover:bg-secondary/40"><input type="checkbox" checked={ids.includes(e.id)} onChange={() => toggle(e.id)} data-testid={`checkbox-custodian-employee-${e.id}`} />{e.name}<span className="ml-auto text-muted-foreground">{e.role}</span></label>)}</div>}
        <span className="block font-normal text-muted-foreground">Худалдан авалт, зарлагын Хариуцагч жагсаалтад харагдана. Сонголт хайлтаар алдагдахгүй.</span>
      </div>}
      <label className="block space-y-1.5 text-xs font-semibold">Шинэ нууц үг<Input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" placeholder="Хоосон бол өөрчлөхгүй" data-testid="input-user-new-password" /><span className="block font-normal text-muted-foreground">Хоосон орхивол нууц үг хэвээр үлдэнэ.</span></label>
      {update.isError && <p className="text-xs font-semibold text-destructive">Хадгалах боломжгүй байна. Нэр болон эрхийн нөхцөлийг шалгана уу.</p>}
      <div className="flex justify-end gap-2 border-t border-border pt-5"><Button type="button" variant="outline" onClick={onClose}>Болих</Button><Button onClick={save} disabled={!username.trim() || update.isPending} data-testid="button-save-user">{update.isPending ? 'Хадгалж байна...' : 'Хадгалах'}</Button></div>
    </div>
  </Modal>;
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
  const [section, setSection] = useState<'users' | 'transactions' | 'chart-of-accounts'>('users');
  const remove = (user: User) => {
    if (!window.confirm(`${user.username} хэрэглэгчийг устгах уу?`)) return;
    deletion.mutate({ id: user.id }, {
      onSuccess: () => { qc.invalidateQueries({ queryKey: getListUsersQueryKey() }); qc.invalidateQueries({ queryKey: getListInventoryCustodiansQueryKey() }); },
      onError: () => window.alert('Устгах боломжгүй байна. Өөрийн болон сүүлийн админы бүртгэлийг устгахгүй.'),
    });
  };
  return <div className="page-enter"><PageHeading eyebrow="Admin" title="Хэрэглэгчийн тохиргоо" detail="Хэрэглэгч, тусгай гүйлгээ болон дансны төлөвлөгөөг удирдана." />
    <div className="mb-5 flex w-fit flex-wrap gap-1 rounded-xl border border-border bg-card p-1"><Button variant={section === 'users' ? 'default' : 'ghost'} onClick={() => setSection('users')} data-testid="button-settings-users"><UsersRound className="size-4" />Хэрэглэгч</Button><Button variant={section === 'transactions' ? 'default' : 'ghost'} onClick={() => setSection('transactions')} data-testid="button-settings-transactions"><Receipt className="size-4" />Гүйлгээ</Button><Button variant={section === 'chart-of-accounts' ? 'default' : 'ghost'} onClick={() => setSection('chart-of-accounts')} data-testid="button-settings-chart-of-accounts"><BookOpen className="size-4" />Дансны төлөвлөгөө</Button></div>
    {section === 'transactions' ? <UnclearTransactionsSettings /> : section === 'chart-of-accounts' ? <ChartOfAccountsSettings /> : <section className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="border-b border-border px-5 py-4"><h2 className="text-base font-bold">Бүх хэрэглэгч</h2><p className="mt-1 text-xs text-muted-foreground">Нууц үг хэзээ ч харагдахгүй.</p></div>
      {users.isLoading ? <div className="space-y-3 p-5"><LoadingBlock className="h-16" /><LoadingBlock className="h-16" /></div> : users.isError ? <ErrorBlock onRetry={() => users.refetch()} /> : <div className="divide-y divide-border">{users.data?.map((user) => <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center" key={user.id} data-testid={`row-user-${user.id}`}><div className="min-w-0 flex-1"><p className="text-sm font-semibold" data-testid={`text-user-name-${user.id}`}>{user.username}</p>{user.role === 'warehouse' && <p className="mt-0.5 text-[11px] text-muted-foreground" data-testid={`text-user-custodians-${user.id}`}>Хариуцагч: {user.custodianEmployeeIds?.length ? user.custodianEmployeeIds.map((id) => employeeNames.get(id) ?? `#${id}`).join(', ') : 'сонгоогүй'}</p>}<p className="mt-1 text-xs text-muted-foreground">{userRoleLabels[user.role] ?? user.role}</p></div><div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => setEditing(user)} data-testid={`button-edit-user-${user.id}`}><Pencil className="size-4" />Засах</Button><Button variant="outline" size="sm" onClick={() => remove(user)} disabled={deletion.isPending} className="text-destructive hover:text-destructive"><Trash2 className="size-4" />Устгах</Button></div></div>)}</div>}
    </section>}
    {editing && <UserEditModal user={editing} onClose={() => setEditing(null)} />}
  </div>;
}