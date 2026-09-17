import { type ComponentType, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BookOpen, Pencil, Receipt, Trash2, UsersRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState, ErrorBlock, LoadingBlock, Modal, PageHeading } from '@/components/ui-primitives';
import {
  getGetAuthSessionQueryKey,
  getListUsersQueryKey,
  useDeleteUser,
  useGetAuthSession,
  useUpdateUser,
  useListUsers,
  type User,
} from '@workspace/api-client-react';

const userRoleLabels: Record<string, string> = {
  admin: 'Админ',
  hr: 'Хүний нөөц (HR)',
  accountant: 'Нягтлан',
  warehouse: 'Агуулах',
  viewer: 'Харах эрхтэй',
};

export function UserEditModal({ user, onClose }: { user: User; onClose: () => void }) {
  const update = useUpdateUser();
  const qc = useQueryClient();
  const [username, setUsername] = useState(user.username);
  const [role, setRole] = useState(user.role);
  const [newPassword, setNewPassword] = useState('');
  const save = () => update.mutate({ id: user.id, data: { username, role, ...(newPassword ? { newPassword } : {}) } }, {
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: getListUsersQueryKey() });
      qc.invalidateQueries({ queryKey: getGetAuthSessionQueryKey() });
      onClose();
    },
  });
  return <Modal title="Хэрэглэгч засах" detail="Шинэ нууц үгийг хоосон орхивол өөрчлөгдөхгүй." onClose={onClose}>
    <div className="space-y-4">
      <label className="block space-y-1.5 text-xs font-semibold">Нэвтрэх нэр<Input value={username} onChange={(event) => setUsername(event.target.value)} data-testid="input-user-username" /></label>
      <label className="block space-y-1.5 text-xs font-semibold">Эрх<select value={role} onChange={(event) => setRole(event.target.value as User['role'])} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" data-testid="select-user-role">{Object.entries(userRoleLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
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
  const deletion = useDeleteUser();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<User | null>(null);
  const [section, setSection] = useState<'users' | 'transactions' | 'chart-of-accounts'>('users');
  const remove = (user: User) => {
    if (!window.confirm(`${user.username} хэрэглэгчийг устгах уу?`)) return;
    deletion.mutate({ id: user.id }, {
      onSuccess: () => qc.invalidateQueries({ queryKey: getListUsersQueryKey() }),
      onError: () => window.alert('Устгах боломжгүй байна. Өөрийн болон сүүлийн админы бүртгэлийг устгахгүй.'),
    });
  };
  return <div className="page-enter"><PageHeading eyebrow="Admin" title="Хэрэглэгчийн тохиргоо" detail="Хэрэглэгч, тусгай гүйлгээ болон дансны төлөвлөгөөг удирдана." />
    <div className="mb-5 flex w-fit flex-wrap gap-1 rounded-xl border border-border bg-card p-1"><Button variant={section === 'users' ? 'default' : 'ghost'} onClick={() => setSection('users')} data-testid="button-settings-users"><UsersRound className="size-4" />Хэрэглэгч</Button><Button variant={section === 'transactions' ? 'default' : 'ghost'} onClick={() => setSection('transactions')} data-testid="button-settings-transactions"><Receipt className="size-4" />Гүйлгээ</Button><Button variant={section === 'chart-of-accounts' ? 'default' : 'ghost'} onClick={() => setSection('chart-of-accounts')} data-testid="button-settings-chart-of-accounts"><BookOpen className="size-4" />Дансны төлөвлөгөө</Button></div>
    {section === 'transactions' ? <UnclearTransactionsSettings /> : section === 'chart-of-accounts' ? <ChartOfAccountsSettings /> : <section className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="border-b border-border px-5 py-4"><h2 className="text-base font-bold">Бүх хэрэглэгч</h2><p className="mt-1 text-xs text-muted-foreground">Нууц үг хэзээ ч харагдахгүй.</p></div>
      {users.isLoading ? <div className="space-y-3 p-5"><LoadingBlock className="h-16" /><LoadingBlock className="h-16" /></div> : users.isError ? <ErrorBlock onRetry={() => users.refetch()} /> : <div className="divide-y divide-border">{users.data?.map((user) => <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center" key={user.id} data-testid={`row-user-${user.id}`}><div className="min-w-0 flex-1"><p className="text-sm font-semibold">{user.username}</p><p className="mt-1 text-xs text-muted-foreground">{userRoleLabels[user.role] ?? user.role}</p></div><div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => setEditing(user)} data-testid={`button-edit-user-${user.id}`}><Pencil className="size-4" />Засах</Button><Button variant="outline" size="sm" onClick={() => remove(user)} disabled={deletion.isPending} className="text-destructive hover:text-destructive"><Trash2 className="size-4" />Устгах</Button></div></div>)}</div>}
    </section>}
    {editing && <UserEditModal user={editing} onClose={() => setEditing(null)} />}
  </div>;
}