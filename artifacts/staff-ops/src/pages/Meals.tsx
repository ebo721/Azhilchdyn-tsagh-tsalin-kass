import { useState, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { PageHeading, LoadingBlock, ErrorBlock, EmptyState, Modal, StatusPill } from '@/components/ui-primitives';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useQueueDeletion } from '@/hooks/useQueueDeletion';
import {
  Search,
  Plus,
  Utensils,
  Pencil,
  Trash2,
  X,
  Flame,
  ToggleRight
} from 'lucide-react';
import {
  useListMeals,
  useCreateMeal,
  useUpdateMeal,
  useDeleteMeal,
  useCreateMealIngredient,
  useUpdateMealIngredient,
  useDeleteMealIngredient,
  useListInventoryItems,
  useGetAuthSession,
  getListMealsQueryKey,
  getListInventoryItemsQueryKey,
  type Meal,
  type MealIngredient,
  type MealInput,
  type MealIngredientInput,
  type InventoryItem
} from '@workspace/api-client-react';

export function Meals() {
  const qc = useQueryClient();
  const session = useGetAuthSession();
  const readOnly = session.data?.role === 'technologist';
  const mealsQuery = useListMeals();
  const catalogQuery = useListInventoryItems({
    query: { queryKey: getListInventoryItemsQueryKey(), enabled: !readOnly },
  });
  const deleteMeal = useDeleteMeal();
  const deletion = useQueueDeletion();

  const [search, setSearch] = useState('');
  const [selectedMeal, setSelectedMeal] = useState<Meal | null>(null);
  const [isMealFormOpen, setIsMealFormOpen] = useState(false);
  const [editingMealInfo, setEditingMealInfo] = useState<Meal | null>(null);

  const meals = mealsQuery.data || [];
  const catalog = catalogQuery.data || [];

  const filteredMeals = useMemo(() => {
    return meals.filter((m) =>
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.category.toLowerCase().includes(search.toLowerCase())
    );
  }, [meals, search]);

  const categories = useMemo(() => {
    return Array.from(new Set(meals.map((m) => m.category))).filter(Boolean);
  }, [meals]);

  const openCreateMeal = () => {
    setEditingMealInfo(null);
    setIsMealFormOpen(true);
  };

  const openEditMealInfo = (meal: Meal) => {
    setEditingMealInfo(meal);
    setIsMealFormOpen(true);
  };

  const handleDeleteMeal = (meal: Meal) => {
    if (window.confirm(`"${meal.name}" хоолыг устгах уу?`)) {
      if (readOnly) {
        void deletion.request(`/meals/${meal.id}`, meal.name);
      } else {
        deleteMeal.mutate({ id: meal.id }, {
          onSuccess: () => {
            qc.invalidateQueries({ queryKey: getListMealsQueryKey() });
            if (selectedMeal?.id === meal.id) setSelectedMeal(null);
          }
        });
      }
    }
  };

  return (
    <div className="page-enter">
      <PageHeading
        eyebrow="Хоолны цэс"
        title="Хоолны орц, илчлэг"
        detail="Хоолны орцын норм хэмжээг тохируулах болон илчлэг тооцоолох хэсэг"
        action={(
          <Button onClick={openCreateMeal} data-testid="button-add-meal" className="bg-orange-600 hover:bg-orange-700 text-white border-transparent">
            <Plus className="size-4 mr-2" /> Хоол нэмэх
          </Button>
        )}
      />

      <div className="grid lg:grid-cols-[1fr_400px] xl:grid-cols-[1fr_500px] items-start gap-6">
        <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full sm:w-80">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
                placeholder="Хоолны нэр, ангиллаар хайх"
                data-testid="input-search-meals"
              />
            </div>
            <div className="text-sm text-muted-foreground font-medium">
              Нийт {filteredMeals.length} хоол
            </div>
          </div>

          {mealsQuery.isLoading ? (
            <div className="p-5 space-y-3"><LoadingBlock className="h-12" /><LoadingBlock className="h-12" /></div>
          ) : mealsQuery.isError ? (
            <ErrorBlock onRetry={() => mealsQuery.refetch()} />
          ) : !filteredMeals.length ? (
            <EmptyState title="Хоол олдсонгүй" detail={search ? "Хайлтын үгээ өөрчилж үзнэ үү." : "Хоолны цэс хоосон байна."} icon={Utensils} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left min-w-[600px]">
                <thead className="bg-secondary/50 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-5 py-3">Хоолны нэр</th>
                    <th className="px-5 py-3">Ангилал</th>
                    <th className="px-5 py-3">Төрөл</th>
                    <th className="px-5 py-3 text-right">Илчлэг</th>
                    <th className="px-5 py-3 text-center">Төлөв</th>
                    <th className="px-5 py-3 text-right">Үйлдэл</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredMeals.map((meal) => (
                    <tr
                      key={meal.id}
                      className={cn(
                        "cursor-pointer transition-colors hover:bg-secondary/40",
                        selectedMeal?.id === meal.id && "bg-orange-50/50 dark:bg-orange-950/20"
                      )}
                      onClick={() => setSelectedMeal(meal)}
                      data-testid={`row-meal-${meal.id}`}
                    >
                      <td className="px-5 py-3 font-semibold text-sm">
                        {meal.name}
                        <div className="text-[11px] text-muted-foreground font-normal mt-0.5">{meal.ingredients?.length || 0} орцтой</div>
                      </td>
                      <td className="px-5 py-3 text-sm text-muted-foreground">{meal.category}</td>
                      <td className="px-5 py-3 text-sm">
                        {meal.type === 'set' ? (
                          <span className="inline-flex items-center gap-1.5 rounded-md bg-purple-100 dark:bg-purple-900/30 px-2 py-0.5 text-xs font-semibold text-purple-700 dark:text-purple-300"><Utensils className="size-3" /> Сет</span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 rounded-md bg-blue-100 dark:bg-blue-900/30 px-2 py-0.5 text-xs font-semibold text-blue-700 dark:text-blue-300">Дан хоол</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right font-mono font-bold text-orange-600 dark:text-orange-400">
                        {meal.totalCalories} <span className="text-[10px] text-muted-foreground font-normal uppercase">ккал</span>
                      </td>
                      <td className="px-5 py-3 text-center">
                        <StatusPill value={meal.isActive ? 'active' : 'inactive'} />
                      </td>
                      <td className="px-5 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={(e) => { e.stopPropagation(); openEditMealInfo(meal); }} data-testid={`button-edit-meal-${meal.id}`}>
                            <Pencil className="size-4" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={(e) => { e.stopPropagation(); handleDeleteMeal(meal); }} data-testid={`button-delete-meal-${meal.id}`}>
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {selectedMeal ? (
          <MealDetailsPanel
            meal={meals.find(m => m.id === selectedMeal.id) || selectedMeal}
            catalog={catalog}
            onClose={() => setSelectedMeal(null)}
            onUpdate={() => {
              qc.invalidateQueries({ queryKey: getListMealsQueryKey() });
              qc.invalidateQueries({ queryKey: getListInventoryItemsQueryKey() });
            }}
          />
        ) : (
          <div className="hidden lg:flex flex-col items-center justify-center min-h-[400px] rounded-2xl border border-dashed border-border bg-card/50 text-center p-8">
            <div className="grid size-16 place-items-center rounded-2xl bg-orange-100 dark:bg-orange-950/50 text-orange-600 dark:text-orange-400 mb-4">
              <Utensils className="size-8" />
            </div>
            <h3 className="font-bold text-lg mb-1">Хоолны орц</h3>
            <p className="text-sm text-muted-foreground max-w-[250px]">Жагсаалтаас хоол сонгон дарж орцын мэдээллийг харах болон засах боломжтой.</p>
          </div>
        )}
      </div>

      {isMealFormOpen && (
        <MealFormModal
          meal={editingMealInfo}
          categories={categories}
          requestOnly={readOnly}
          onClose={() => setIsMealFormOpen(false)}
          onSuccess={(savedMeal) => {
            qc.invalidateQueries({ queryKey: getListMealsQueryKey() });
            setIsMealFormOpen(false);
            if (!editingMealInfo) setSelectedMeal(savedMeal);
          }}
        />
      )}
    </div>
  );
}

function MealFormModal({
  meal,
  categories,
  requestOnly,
  onClose,
  onSuccess
}: {
  meal: Meal | null;
  categories: string[];
  requestOnly: boolean;
  onClose: () => void;
  onSuccess: (meal: Meal) => void;
}) {
  const create = useCreateMeal();
  const update = useUpdateMeal();
  const [name, setName] = useState(meal?.name || '');
  const [category, setCategory] = useState(meal?.category || '');
  const [type, setType] = useState<'single' | 'set'>(meal?.type || 'single');
  const [isActive, setIsActive] = useState(meal ? meal.isActive : true);
  const [requestPending, setRequestPending] = useState(false);
  const [requestStatus, setRequestStatus] = useState<'success' | 'error' | null>(null);
  const [requestError, setRequestError] = useState('');
  const [requestSubmitted, setRequestSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !category) return;
    const data: MealInput = { name, category, type, isActive };
    if (meal && requestOnly) {
      setRequestPending(true);
      setRequestStatus(null);
      setRequestError('');
      fetch(`/api/meals/${meal.id}/edit-request`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, category }),
      })
        .then(async (response) => {
          if (!response.ok) {
            const body = await response.json().catch(() => null) as { error?: string } | null;
            throw new Error(body?.error || 'Засварын хүсэлт илгээхэд алдаа гарлаа.');
          }
          setRequestStatus('success');
          setRequestSubmitted(true);
        })
        .catch((error: unknown) => {
          setRequestStatus('error');
          setRequestError(error instanceof Error ? error.message : 'Засварын хүсэлт илгээхэд алдаа гарлаа.');
        })
        .finally(() => setRequestPending(false));
    } else if (meal) {
      update.mutate({ id: meal.id, data }, { onSuccess });
    } else {
      create.mutate({ data }, { onSuccess });
    }
  };

  return (
    <Modal
      title={meal ? (requestOnly ? 'Хоолны мэдээлэл өөрчлөх хүсэлт' : 'Хоолны мэдээлэл засах') : 'Шинэ хоол бүртгэх'}
      detail={meal ? (requestOnly ? 'Өөрчлөлтийг админы зөвшөөрөлд илгээнэ' : 'Хоолны үндсэн мэдээллийг өөрчлөх') : 'Цэсэнд шинэ хоол нэмэх'}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-muted-foreground">Хоолны нэр</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={requestSubmitted}
              placeholder="Жишээ: Үхрийн махтай хуурга"
              data-testid="input-meal-name"
              required
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-muted-foreground">Ангилал</label>
            <Input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              disabled={requestSubmitted}
              list="meal-categories"
              placeholder="Жишээ: Үндсэн хоол"
              data-testid="input-meal-category"
              required
            />
            <datalist id="meal-categories">
              {categories.map((c) => <option key={c} value={c} />)}
            </datalist>
          </div>
          {(!requestOnly || !meal) && <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-muted-foreground">Төрөл</label>
              <select
                value={type}
                 onChange={(e) => setType(e.target.value as 'single' | 'set')}
                 disabled={requestSubmitted}
                className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                data-testid="select-meal-type"
              >
                <option value="single">Дан хоол</option>
                <option value="set">Сет хоол</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-muted-foreground">Төлөв</label>
              <button
                type="button"
                 onClick={() => setIsActive(!isActive)}
                 disabled={requestSubmitted}
                className={cn(
                  "flex h-10 w-full items-center justify-between rounded-md border px-3 py-2 text-sm font-medium transition-colors",
                  isActive ? "border-primary bg-primary/5 text-primary" : "border-input text-muted-foreground hover:bg-secondary"
                )}
                data-testid="button-meal-active-toggle"
              >
                {isActive ? 'Идэвхтэй' : 'Идэвхгүй'}
                <ToggleRight className={cn("size-5", isActive ? "text-primary" : "text-muted-foreground rotate-180")} />
              </button>
            </div>
          </div>}
        </div>
        <div className="flex justify-end gap-3 pt-4 border-t border-border">
          <Button type="button" variant="outline" onClick={onClose} data-testid="button-cancel-meal">Болих</Button>
          <Button type="submit" disabled={create.isPending || update.isPending || requestPending || requestSubmitted} data-testid="button-save-meal" className="bg-orange-600 hover:bg-orange-700 text-white">{meal ? (requestOnly ? (requestSubmitted ? 'Хүсэлт илгээгдсэн' : 'Хүсэлт илгээх') : 'Хадгалах') : 'Үүсгэх'}</Button>
        </div>
        {(create.isError || update.isError) && <p className="text-sm text-destructive" data-testid="status-meal-save-error">Хоол хадгалахад алдаа гарлаа. Нэр давхардсан эсэхийг шалгана уу.</p>}
        {requestStatus === 'success' && <p className="text-sm text-green-600" data-testid="status-meal-edit-request-success">Өөрчлөлтийн хүсэлт админд илгээгдлээ.</p>}
        {requestStatus === 'error' && <p className="text-sm text-destructive" data-testid="status-meal-edit-request-error">{requestError || 'Өөрчлөлтийн хүсэлт илгээхэд алдаа гарлаа. Дахин оролдоно уу.'}</p>}
      </form>
    </Modal>
  );
}

function MealDetailsPanel({
  meal,
  catalog,
  onClose,
  onUpdate
}: {
  meal: Meal;
  catalog: InventoryItem[];
  onClose: () => void;
  onUpdate: () => void;
}) {
  const createIngredient = useCreateMealIngredient();
  const updateIngredient = useUpdateMealIngredient();
  const deleteIngredient = useDeleteMealIngredient();

  const [editingIngredient, setEditingIngredient] = useState<MealIngredient | null>(null);
  const [isAddMode, setIsAddMode] = useState(false);

  const [formInvName, setFormInvName] = useState('');
  const [formInvCategory, setFormInvCategory] = useState('');
  const [formQty, setFormQty] = useState('');
  const [formUnit, setFormUnit] = useState('грамм');
  const [formCal, setFormCal] = useState('');

  // Live calorie calculation
  const liveCal = (Number(formQty) || 0) * (Number(formCal) || 0);

  const resetForm = () => {
    setEditingIngredient(null);
    setIsAddMode(false);
    setFormInvName('');
    setFormInvCategory('');
    setFormQty('');
    setFormUnit('грамм');
    setFormCal('');
  };

  const openEdit = (ing: MealIngredient) => {
    setEditingIngredient(ing);
    setIsAddMode(true);
    setFormInvName(ing.inventoryItemName);
    // Find category from catalog if possible
    const catalogItem = catalog.find(i => i.id === ing.inventoryItemId);
    setFormInvCategory(catalogItem?.category || '');
    setFormQty(String(ing.quantity));
    setFormUnit(ing.unit);
    setFormCal(String(ing.caloriesPerUnit));
  };

  const handleInvNameChange = (val: string) => {
    setFormInvName(val);
    const found = catalog.find(i => i.name.toLowerCase() === val.toLowerCase());
    if (found) {
      setFormInvCategory(found.category);
      setFormUnit(found.unit);
    }
  };

  const saveIngredient = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formInvName || !formQty || !formCal) return;

    let invId = null;
    const found = catalog.find(i => i.name.toLowerCase() === formInvName.toLowerCase());
    if (found) invId = found.id;

    const payload: MealIngredientInput = {
      inventoryItemId: invId,
      inventoryItemName: formInvName,
      inventoryItemCategory: formInvCategory || 'Бусад',
      quantity: Number(formQty),
      unit: formUnit,
      caloriesPerUnit: Number(formCal)
    };

    if (editingIngredient) {
      updateIngredient.mutate({ mealId: meal.id, ingredientId: editingIngredient.id, data: payload }, {
        onSuccess: () => {
          onUpdate();
          resetForm();
        }
      });
    } else {
      createIngredient.mutate({ mealId: meal.id, data: payload }, {
        onSuccess: () => {
          onUpdate();
          resetForm();
        }
      });
    }
  };

  const removeIngredient = (ing: MealIngredient) => {
    if (window.confirm(`"${ing.inventoryItemName}" орцыг устгах уу?`)) {
      deleteIngredient.mutate({ mealId: meal.id, ingredientId: ing.id }, {
        onSuccess: () => onUpdate()
      });
    }
  };

  return (
    <section className="flex flex-col h-[calc(100dvh-10rem)] rounded-2xl border border-border bg-card shadow-lg sticky top-28">
      <div className="flex items-start justify-between border-b border-border bg-orange-50/30 dark:bg-orange-950/10 p-5 rounded-t-2xl">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-bold uppercase tracking-wider text-orange-600 dark:text-orange-400">{meal.category}</span>
            {meal.type === 'set' && (
              <span className="rounded bg-purple-100 dark:bg-purple-900/50 px-1.5 py-0.5 text-[10px] font-bold uppercase text-purple-700 dark:text-purple-300">Сет</span>
            )}
          </div>
          <h2 className="text-xl font-bold tracking-tight text-foreground">{meal.name}</h2>
          <div className="flex items-center gap-4 mt-3">
            <div className="flex items-center gap-1.5 text-sm">
              <Flame className="size-4 text-orange-500" />
              <span className="font-mono font-bold">{meal.totalCalories} <span className="text-muted-foreground font-normal text-xs uppercase">ккал</span></span>
            </div>
            <StatusPill value={meal.isActive ? 'active' : 'inactive'} />
          </div>
        </div>
        <Button size="icon" variant="ghost" onClick={onClose} className="h-8 w-8 text-muted-foreground hover:bg-secondary">
          <X className="size-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Орцын жагсаалт</h3>
           {!isAddMode && (
            <Button size="sm" variant="outline" onClick={() => setIsAddMode(true)} data-testid="button-add-ingredient">
              <Plus className="size-3.5 mr-1" /> Орц нэмэх
            </Button>
          )}
        </div>

        {meal.ingredients?.length > 0 ? (
          <div className="rounded-xl border border-border overflow-hidden mb-6">
            <table className="w-full text-left">
              <thead className="bg-secondary/50 text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2.5">Орц</th>
                  <th className="px-3 py-2.5 text-right">Хэмжээ</th>
                  <th className="px-3 py-2.5 text-right">Илчлэг/Нэгж</th>
                  <th className="px-3 py-2.5 text-right">Нийт ккал</th>
                   <th className="px-3 py-2.5 w-16"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {meal.ingredients.map((ing) => (
                  <tr key={ing.id} className={cn("hover:bg-secondary/30", editingIngredient?.id === ing.id && "bg-orange-50/50 dark:bg-orange-900/20")}>
                    <td className="px-3 py-2.5 text-sm font-medium">{ing.inventoryItemName}</td>
                    <td className="px-3 py-2.5 text-sm text-right font-mono">{ing.quantity} <span className="text-muted-foreground text-xs font-sans">{ing.unit}</span></td>
                    <td className="px-3 py-2.5 text-sm text-right font-mono text-muted-foreground">{ing.caloriesPerUnit}</td>
                    <td className="px-3 py-2.5 text-sm text-right font-mono font-bold text-orange-600 dark:text-orange-400">{ing.totalCalories}</td>
                     <td className="px-3 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-0.5">
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(ing)} data-testid={`button-edit-ing-${ing.id}`}>
                          <Pencil className="size-3" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:bg-destructive/10" onClick={() => removeIngredient(ing)} data-testid={`button-delete-ing-${ing.id}`}>
                          <Trash2 className="size-3" />
                        </Button>
                      </div>
                     </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          !isAddMode && (
            <div className="py-8 text-center rounded-xl border border-dashed border-border bg-card/30 mb-6">
              <p className="text-sm text-muted-foreground">Энэ хоолонд орц бүртгээгүй байна.</p>
            </div>
          )
        )}

         {isAddMode && (
          <div className="rounded-xl border border-orange-200 dark:border-orange-900 bg-orange-50/50 dark:bg-orange-950/20 p-4 animate-in fade-in slide-in-from-top-2">
            <h4 className="text-sm font-bold mb-3">{editingIngredient ? 'Орц засах' : 'Шинэ орц нэмэх'}</h4>
            <form onSubmit={saveIngredient} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-muted-foreground">Материал</label>
                <Input
                  value={formInvName}
                  onChange={(e) => handleInvNameChange(e.target.value)}
                  list="inventory-catalog"
                  placeholder="Барааны нэр эсвэл шинээр бичих"
                  required
                  autoFocus
                  data-testid="input-ing-name"
                />
                <datalist id="inventory-catalog">
                  {catalog.map(c => <option key={c.id} value={c.name} />)}
                </datalist>
              </div>

              {!catalog.find(c => c.name.toLowerCase() === formInvName.toLowerCase()) && formInvName && (
                <div className="animate-in fade-in">
                  <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-muted-foreground">Шинэ материалын ангилал</label>
                  <Input
                    value={formInvCategory}
                    onChange={(e) => setFormInvCategory(e.target.value)}
                    placeholder="Жишээ: Хүнсний ногоо"
                    required
                    data-testid="input-ing-category"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">Орц шинээр нэмэхэд автоматаар бараа материал үүснэ.</p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-muted-foreground">Хэмжээ</label>
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      step="0.01"
                      min="0.01"
                      value={formQty}
                      onChange={(e) => setFormQty(e.target.value)}
                      placeholder="0.0"
                      required
                      className="font-mono text-right"
                      data-testid="input-ing-qty"
                    />
                    <select
                      value={formUnit}
                      onChange={(e) => setFormUnit(e.target.value)}
                      className="w-20 rounded-md border border-input bg-transparent px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      data-testid="select-ing-unit"
                    >
                      <option value="грамм">грамм</option>
                      <option value="кг">кг</option>
                      <option value="литр">литр</option>
                      <option value="мл">мл</option>
                      <option value="ширхэг">ширхэг</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-muted-foreground">Илчлэг (1 нэгжид)</label>
                  <div className="relative">
                    <Input
                      type="number"
                      step="0.1"
                      min="0"
                      value={formCal}
                      onChange={(e) => setFormCal(e.target.value)}
                      placeholder="0.0"
                      required
                      className="font-mono pr-12 text-right"
                      data-testid="input-ing-cal"
                    />
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">ккал</div>
                  </div>
                </div>
              </div>

              <div className="bg-background rounded-lg border border-border px-3 py-2 flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Нийт илчлэг:</span>
                <span className="font-mono font-bold text-orange-600 dark:text-orange-400">{liveCal.toFixed(1)} ккал</span>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="ghost" onClick={resetForm} data-testid="button-cancel-ing">Болих</Button>
                <Button type="submit" className="bg-orange-600 hover:bg-orange-700 text-white" disabled={createIngredient.isPending || updateIngredient.isPending} data-testid="button-save-ing">
                  {editingIngredient ? 'Хадгалах' : 'Нэмэх'}
                </Button>
              </div>
              {(createIngredient.isError || updateIngredient.isError) && <p className="text-sm text-destructive" data-testid="status-ingredient-save-error">Орц хадгалахад алдаа гарлаа. Мэдээллээ шалгаад дахин оролдоно уу.</p>}
            </form>
          </div>
        )}
      </div>
    </section>
  );
}
