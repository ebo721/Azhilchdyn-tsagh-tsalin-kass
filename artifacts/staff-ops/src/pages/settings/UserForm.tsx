import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LoadingBlock, Modal } from '@/components/ui-primitives';
import {
  getGetAuthSessionQueryKey,
  getListInventoryCustodiansQueryKey,
  getListUsersQueryKey,
  useCreateUser,
  useListEmployees,
  useUpdateUser,
  type User,
} from '@workspace/api-client-react';
import { STAFF_MENUS, ROLE_MENU_PATHS, defaultMenuPaths, visibleMenuPaths, validMenuSelection, type MenuStaffRole } from '@workspace/api-zod/staff-menu-policy';

export const userRoleLabels: Record<string, string> = {
  admin: 'Админ',
  hr: 'Хүний нөөц (HR)',
  accountant: 'Нягтлан',
  warehouse: 'Нярав (агуулах)',
  viewer: 'Харах эрхтэй',
  technologist: 'Хоолны технологич',
};

function errorMessage(error: unknown, creating: boolean): string {
  const e = error as { status?: number; data?: { error?: string } | null; message?: string } | null;
  if (e?.status === 409) return 'Энэ нэвтрэх нэр аль хэдийн бүртгэлтэй байна. Өөр нэр сонгоно уу.';
  const detail = typeof e?.data?.error === 'string' ? e.data.error : '';
  const base = creating ? 'Хэрэглэгч үүсгэх боломжгүй байна.' : 'Хадгалах боломжгүй байна.';
  return detail ? `${base} ${detail}` : `${base} Нэр, нууц үг болон эрхийн нөхцөлийг шалгана уу.`;
}

/** One form for both creating and editing accounts. */
export function UserFormModal({ user, onClose, onSaved }: { user?: User; onClose: () => void; onSaved?: (message: string) => void }) {
  const creating = !user;
  const create = useCreateUser();
  const update = useUpdateUser();
  const qc = useQueryClient();
  const employees = useListEmployees();
  const [username, setUsername] = useState(user?.username ?? '');
  const [fullName, setFullName] = useState(user?.fullName ?? '');
  const [role, setRole] = useState<User['role']>(user?.role ?? 'viewer');
  const [password, setPassword] = useState('');
  const [ids, setIds] = useState<number[]>(user?.custodianEmployeeIds ?? []);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>(() => user ? visibleMenuPaths(user.role as MenuStaffRole, user.menuPaths) : defaultMenuPaths('viewer'));
  const [usingDefaults, setUsingDefaults] = useState(user?.menuPaths == null);
  const [localError, setLocalError] = useState('');

  const q = search.trim().toLocaleLowerCase('mn-MN');
  const results = useMemo(() => (employees.data ?? []).filter((e) => !q || e.name.toLocaleLowerCase('mn-MN').includes(q)), [employees.data, q]);
  const nameOf = (id: number) => employees.data?.find((e) => e.id === id)?.name ?? `Ажилтан #${id}`;
  const toggleId = (id: number) => setIds((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);

  const menuRole = role as MenuStaffRole;
  const eligible = useMemo(() => STAFF_MENUS.filter((m) => (ROLE_MENU_PATHS[menuRole] as readonly string[]).includes(m.path)), [menuRole]);
  const effective = role === 'admin' && !selected.includes('/users') ? [...selected, '/users'] : selected;
  const toggleMenu = (path: string) => {
    setUsingDefaults(false);
    setSelected((cur) => cur.includes(path) ? cur.filter((x) => x !== path) : [...cur, path]);
  };
  const changeRole = (next: User['role']) => { setRole(next); setSelected(defaultMenuPaths(next as MenuStaffRole)); setUsingDefaults(true); setLocalError(''); };

  const pending = create.isPending || update.isPending;
  const serverError = creating ? create.error : update.error;
  const failed = creating ? create.isError : update.isError;
  const passwordTooShort = creating && (password.length < 8 || password.length > 128);
  const canSave = !!username.trim() && !passwordTooShort && !pending;

  const done = (saved: User, message: string) => {
    // Make immediate reopening use the saved selection, not the pre-refetch row.
    qc.setQueryData<User[]>(getListUsersQueryKey(), current => current
      ? current.some(item => item.id === saved.id)
        ? current.map(item => item.id === saved.id ? saved : item)
        : [...current, saved]
      : current);
    qc.invalidateQueries({ queryKey: getListUsersQueryKey() });
    qc.invalidateQueries({ queryKey: getListInventoryCustodiansQueryKey() });
    qc.invalidateQueries({ queryKey: getGetAuthSessionQueryKey() });
    onSaved?.(message);
    onClose();
  };

  const save = () => {
    const menuPaths = usingDefaults ? null : eligible.map((m) => m.path as string).filter((p) => effective.includes(p));
    if (!validMenuSelection(menuRole, menuPaths)) { setLocalError('Цэсийн сонголт буруу байна.'); return; }
    setLocalError('');
    const common = {
      username: username.trim(),
      role,
      fullName: fullName.trim() || null,
      menuPaths,
      ...(role === 'warehouse' ? { custodianEmployeeIds: ids } : {}),
    };
    if (creating) {
      create.mutate({ data: { ...common, password } }, { onSuccess: (u) => done(u, `${u.username} хэрэглэгч амжилттай үүслээ.`) });
    } else {
      update.mutate({ id: user.id, data: { ...common, ...(password ? { newPassword: password } : {}) } }, {
        onSuccess: (u) => done(u, `${common.username} хэрэглэгчийн мэдээлэл хадгалагдлаа. Тухайн хэрэглэгч дахин нэвтрэх шаардлагатай.`),
      });
    }
  };

  const labelCls = 'block space-y-1.5 text-xs font-semibold';
  return <Modal title={creating ? 'Хэрэглэгч нэмэх' : 'Хэрэглэгч засах'} detail={creating ? 'Нэвтрэх нэр, эрх, нууц үг болон харагдах цэсийг тохируулна.' : 'Шинэ нууц үгийг хоосон орхивол өөрчлөгдөхгүй.'} onClose={onClose}>
    <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); if (canSave) save(); }}>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={labelCls}>Нэвтрэх нэр<Input value={username} maxLength={80} onChange={(event) => setUsername(event.target.value)} autoComplete="off" data-testid="input-user-username" /></label>
        <label className={labelCls}>Бүтэн нэр<Input value={fullName} maxLength={120} onChange={(event) => setFullName(event.target.value)} placeholder="Заавал биш" data-testid="input-user-full-name" /></label>
      </div>
      <label className={labelCls}>Эрх<select value={role} onChange={(event) => changeRole(event.target.value as User['role'])} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary" data-testid="select-user-role">{Object.entries(userRoleLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>

      {role === 'warehouse' && <div className="space-y-2 text-xs font-semibold">
        <p>Хариуцагч ажилчид</p>
        <div className="flex flex-wrap gap-1.5">{ids.length ? ids.map((id) => <span key={id} className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1">{nameOf(id)}<button type="button" onClick={() => toggleId(id)} aria-label="Хасах" data-testid={`button-remove-custodian-${id}`}>×</button></span>) : <span className="font-normal text-muted-foreground">Сонгоогүй</span>}</div>
        <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Ажилтны нэрээр хайх" data-testid="input-custodian-employee-search" />
        {employees.isLoading ? <LoadingBlock className="h-16" /> : employees.isError ? <div className="flex items-center justify-between rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive"><span>Ажилчдыг ачаалж чадсангүй.</span><button type="button" className="font-bold underline" onClick={() => employees.refetch()} data-testid="button-retry-custodian-employees">Дахин оролдох</button></div>
        : !results.length ? <p className="font-normal text-muted-foreground" data-testid="text-custodian-empty">Ажилтан олдсонгүй.</p>
        : <div className="max-h-44 divide-y divide-border overflow-y-auto rounded-lg border border-border" data-testid="list-custodian-employee-results">{results.map((e) => <label key={e.id} className="flex cursor-pointer items-center gap-2 px-3 py-2 font-normal hover:bg-secondary/40"><input type="checkbox" checked={ids.includes(e.id)} onChange={() => toggleId(e.id)} data-testid={`checkbox-custodian-employee-${e.id}`} />{e.name}<span className="ml-auto text-muted-foreground">{e.role}</span></label>)}</div>}
        <span className="block font-normal text-muted-foreground">Худалдан авалт, зарлагын Хариуцагч жагсаалтад харагдана. Сонголт хайлтаар алдагдахгүй.</span>
      </div>}

      <fieldset className="space-y-2 rounded-xl border border-border p-3 text-xs" data-testid="group-user-menus">
        <legend className="px-1 font-semibold">Харагдах цэс ({effective.length}/{eligible.length})</legend>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-muted-foreground">Зөвхөн сонгосон эрхийн хүрээн дэх цэсийг сонгох боломжтой.</span>
          <Button type="button" variant="outline" size="sm" onClick={() => { setSelected(defaultMenuPaths(menuRole)); setUsingDefaults(true); }} data-testid="button-reset-user-menus">Үндсэн цэс рүү буцаах</Button>
        </div>
        <div className="grid gap-x-3 sm:grid-cols-2">{eligible.map((m) => {
          const locked = role === 'admin' && m.path === '/users';
          return <label key={m.path} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 font-normal hover:bg-secondary/40">
            <input type="checkbox" checked={locked || effective.includes(m.path)} disabled={locked} onChange={() => toggleMenu(m.path)} data-testid={`checkbox-user-menu-${m.path === '/' ? 'home' : m.path.slice(1).replace(/\//g, '-')}`} />
            <span>{m.label}</span>{locked && <span className="ml-auto text-[10px] text-muted-foreground">Заавал</span>}
          </label>;
        })}</div>
        {effective.length === 0 && <p className="rounded-lg bg-accent/25 px-3 py-2 font-semibold" data-testid="text-user-menus-empty">Цэс сонгоогүй тул энэ хэрэглэгчид нээгдэх цэс байхгүй.</p>}
      </fieldset>

      <label className={labelCls}>{creating ? 'Нууц үг' : 'Шинэ нууц үг'}<Input type="password" value={password} maxLength={128} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" placeholder={creating ? '8-128 тэмдэгт' : 'Хоосон бол өөрчлөхгүй'} data-testid="input-user-new-password" /><span className="block font-normal text-muted-foreground">{creating ? 'Дор хаяж 8 тэмдэгт. Хадгалсан нууц үг хэзээ ч харагдахгүй.' : 'Хоосон орхивол нууц үг хэвээр үлдэнэ.'}</span></label>
      {!creating && <p className="rounded-lg bg-secondary px-3 py-2 text-xs text-muted-foreground" data-testid="text-user-relogin-note">Хадгалсны дараа тухайн хэрэглэгчийн нэвтрэлт хүчингүй болно. Тэд дахин нэвтрэх шаардлагатай.</p>}
      {(failed || localError) && <p className="text-xs font-semibold text-destructive" role="alert" data-testid="text-user-form-error">{localError || errorMessage(serverError, creating)}</p>}
      <div className="flex justify-end gap-2 border-t border-border pt-5"><Button type="button" variant="outline" onClick={onClose}>Болих</Button><Button type="submit" disabled={!canSave} data-testid="button-save-user">{pending ? 'Хадгалж байна...' : creating ? 'Үүсгэх' : 'Хадгалах'}</Button></div>
    </form>
  </Modal>;
}
