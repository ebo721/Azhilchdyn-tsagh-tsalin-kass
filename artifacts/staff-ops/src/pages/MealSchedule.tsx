import { useState, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { format, startOfWeek, addDays, addWeeks, subWeeks } from 'date-fns';
import { PageHeading, LoadingBlock, ErrorBlock, Modal } from '@/components/ui-primitives';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useQueueDeletion } from '@/hooks/useQueueDeletion';
import { ChevronLeft, ChevronRight, Plus, Trash2, Utensils, Flame, Coffee } from 'lucide-react';
import {
  useListMealScheduleSlots,
  useListMealSchedule,
  useCreateMealScheduleEntry,
  useUpdateMealScheduleEntry,
  useMoveMealScheduleEntry,
  useListMeals,
  getListMealScheduleQueryKey,
  type MealScheduleEntry,
  type MealScheduleEntryInput,
  type MealScheduleSlot
} from '@workspace/api-client-react';

const MONGOLIAN_DAYS = ['Даваа', 'Мягмар', 'Лхагва', 'Пүрэв', 'Баасан', 'Бямба', 'Ням'];

export function MealSchedule() {
  const qc = useQueryClient();
  const [currentDate, setCurrentDate] = useState(() => {
    const today = new Date();
    // Use noon to avoid timezone boundary issues
    const noon = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12, 0, 0);
    return startOfWeek(noon, { weekStartsOn: 1 });
  });

  const weekStart = format(currentDate, 'yyyy-MM-dd');
  
  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }).map((_, i) => {
      const date = addDays(currentDate, i);
      return {
        dateStr: format(date, 'yyyy-MM-dd'),
        label: MONGOLIAN_DAYS[i],
        dayOfMonth: format(date, 'dd'),
        isToday: format(date, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd')
      };
    });
  }, [currentDate]);

  const slotsQuery = useListMealScheduleSlots();
  const scheduleQuery = useListMealSchedule({ weekStart }, { query: { queryKey: getListMealScheduleQueryKey({ weekStart }) } });
  const moveEntry = useMoveMealScheduleEntry();

  const slots = slotsQuery.data || [];
  const entries = scheduleQuery.data || [];

  const prevWeek = () => setCurrentDate(subWeeks(currentDate, 1));
  const nextWeek = () => setCurrentDate(addWeeks(currentDate, 1));
  const currentWeek = () => {
    const today = new Date();
    setCurrentDate(startOfWeek(new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12, 0, 0), { weekStartsOn: 1 }));
  };

  const [modalCell, setModalCell] = useState<{ date: string; slot: MealScheduleSlot; entry?: MealScheduleEntry } | null>(null);

  // Drag state
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [dragOverCell, setDragOverCell] = useState<{ date: string; slotId: number } | null>(null);

  const onDragStart = (e: React.DragEvent, id: number) => {
    if (moveEntry.isPending) {
      e.preventDefault();
      return;
    }
    setDraggingId(id);
    e.dataTransfer.setData('text/plain', id.toString());
    e.dataTransfer.effectAllowed = 'move';
  };

  const onDragEnd = () => {
    setDraggingId(null);
    setDragOverCell(null);
  };

  const onDragOver = (e: React.DragEvent, date: string, slotId: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const onDragEnter = (e: React.DragEvent, date: string, slotId: number) => {
    e.preventDefault();
    setDragOverCell({ date, slotId });
  };

  const onDragLeave = (e: React.DragEvent) => {
    // Basic drag leave
  };

  const onDrop = (e: React.DragEvent, targetDate: string, targetSlotId: number) => {
    e.preventDefault();
    if (moveEntry.isPending) return;
    setDragOverCell(null);
    setDraggingId(null);
    const idStr = e.dataTransfer.getData('text/plain');
    if (!idStr) return;
    const id = parseInt(idStr, 10);
    if (isNaN(id)) return;

    const entry = entries.find(x => x.id === id);
    if (!entry) return;
    if (entry.date === targetDate && entry.slotId === targetSlotId) return;

    moveEntry.mutate({ id, data: { date: targetDate, slotId: targetSlotId } }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListMealScheduleQueryKey({ weekStart }) });
      }
    });
  };

  const isLoading = slotsQuery.isLoading || scheduleQuery.isLoading;

  return (
    <div className="page-enter">
      <PageHeading
        eyebrow="Хоолны хуваарь"
        title="Долоо хоногийн төлөвлөгөө"
        detail="Хоолны цаг болон цэсийг өдрөөр төлөвлөх"
        action={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={currentWeek} data-testid="button-current-week">Өнөөдөр</Button>
            <div className="flex items-center rounded-md border border-input bg-card">
              <Button variant="ghost" size="icon" className="h-9 w-9 rounded-none border-r border-border hover:bg-secondary" onClick={prevWeek} data-testid="button-prev-week"><ChevronLeft className="size-4" /></Button>
              <div className="relative flex items-center justify-center w-36" data-testid="text-current-week-range">
                <Input
                  type="date"
                  className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                  value={format(currentDate, 'yyyy-MM-dd')}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                    if (e.target.value) {
                      const d = new Date(e.target.value + 'T12:00:00');
                      setCurrentDate(startOfWeek(d, { weekStartsOn: 1 }));
                    }
                  }}
                  data-testid="input-week-picker"
                />
                <span className="text-sm font-medium">
                  {format(new Date(weekDays[0].dateStr), 'MM.dd')} - {format(new Date(weekDays[6].dateStr), 'MM.dd')}
                </span>
              </div>
              <Button variant="ghost" size="icon" className="h-9 w-9 rounded-none border-l border-border hover:bg-secondary" onClick={nextWeek} data-testid="button-next-week"><ChevronRight className="size-4" /></Button>
            </div>
          </div>
        }
      />

      {isLoading ? (
        <div className="p-5 space-y-3 bg-card border border-border rounded-2xl"><LoadingBlock className="h-12" /><LoadingBlock className="h-32" /></div>
      ) : slotsQuery.isError || scheduleQuery.isError ? (
        <ErrorBlock onRetry={() => { slotsQuery.refetch(); scheduleQuery.refetch(); }} />
      ) : (
        <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left min-w-[900px] border-collapse">
              <thead>
                <tr>
                  <th className="w-24 border-b border-r border-border bg-secondary/30 px-3 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider sticky left-0 z-10">Цаг</th>
                  {weekDays.map(day => (
                    <th key={day.dateStr} className={cn("border-b border-border bg-secondary/30 px-3 py-3 text-center", day.isToday && "bg-orange-50/50 dark:bg-orange-900/10")}>
                      <div className={cn("text-xs font-bold uppercase tracking-wider", day.isToday ? "text-orange-600 dark:text-orange-400" : "text-muted-foreground")}>{day.label}</div>
                      <div className={cn("mt-1 text-lg font-bold", day.isToday ? "text-orange-600 dark:text-orange-400" : "text-foreground")}>{day.dayOfMonth}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {slots.map(slot => (
                  <tr key={slot.id} className="group/row">
                    <td className="border-b border-r border-border bg-card px-2 py-3 text-center sticky left-0 z-10 shadow-[1px_0_0_0_hsl(var(--border))]">
                      <div className="text-xs font-bold text-foreground">{slot.name}</div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">{slot.startTime}-{slot.endTime}</div>
                    </td>
                    {weekDays.map(day => {
                      const entry = entries.find(e => e.date === day.dateStr && e.slotId === slot.id);
                      const isDragOver = dragOverCell?.date === day.dateStr && dragOverCell?.slotId === slot.id;
                      
                      return (
                        <td 
                          key={`${day.dateStr}-${slot.id}`} 
                          className={cn(
                            "schedule-cell border-b border-border border-l relative p-1.5 align-top transition-colors h-24 w-[12.5%]",
                            isDragOver ? "bg-orange-50 dark:bg-orange-900/20" : day.isToday ? "bg-orange-50/20 dark:bg-orange-900/5" : "hover:bg-secondary/20"
                          )}
                          onDragOver={(e) => onDragOver(e, day.dateStr, slot.id)}
                          onDragEnter={(e) => onDragEnter(e, day.dateStr, slot.id)}
                          onDragLeave={onDragLeave}
                          onDrop={(e) => onDrop(e, day.dateStr, slot.id)}
                          onClick={() => setModalCell({ date: day.dateStr, slot, entry })}
                          data-testid={`cell-${day.dateStr}-${slot.id}`}
                        >
                          {entry ? (
                            <div 
                              draggable={!moveEntry.isPending}
                              onDragStart={(e) => onDragStart(e, entry.id)}
                              onDragEnd={onDragEnd}
                              onDragOver={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                e.dataTransfer.dropEffect = 'move';
                              }}
                              onDragEnter={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setDragOverCell({ date: day.dateStr, slotId: slot.id });
                              }}
                              onDrop={(e) => {
                                e.stopPropagation();
                                onDrop(e, day.dateStr, slot.id);
                              }}
                              className={cn(
                                "flex flex-col h-full rounded-lg border p-2 cursor-grab active:cursor-grabbing hover-elevate transition-all",
                                draggingId === entry.id ? "opacity-50 border-dashed" : "border-border shadow-sm",
                                entry.kind === 'break' ? "bg-secondary text-secondary-foreground" : "bg-card text-card-foreground border-orange-200 dark:border-orange-900",
                                moveEntry.isPending && moveEntry.variables?.id === entry.id && "animate-pulse"
                              )}
                              data-testid={`entry-${entry.id}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setModalCell({ date: day.dateStr, slot, entry });
                              }}
                            >
                              {entry.kind === 'break' ? (
                                <div className="flex items-center justify-center h-full flex-col gap-1 text-muted-foreground">
                                  <Coffee className="size-4" />
                                  <span className="text-xs font-semibold">Завсарлага</span>
                                </div>
                              ) : (
                                <>
                                  <div className="flex items-start justify-between gap-1 mb-auto">
                                    <span className="text-xs font-bold leading-tight line-clamp-2" title={entry.mealName || ''}>{entry.mealName}</span>
                                  </div>
                                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/50">
                                    {entry.mealType === 'set' ? (
                                      <span className="rounded bg-purple-100 dark:bg-purple-900/30 px-1 py-0.5 text-[9px] font-bold uppercase text-purple-700 dark:text-purple-300">Сет</span>
                                    ) : (
                                      <span className="rounded bg-blue-100 dark:bg-blue-900/30 px-1 py-0.5 text-[9px] font-bold uppercase text-blue-700 dark:text-blue-300">Дан</span>
                                    )}
                                    <div className="flex items-center gap-0.5 text-[10px] text-orange-600 dark:text-orange-400 font-mono font-bold">
                                      <Flame className="size-3" />
                                      {entry.totalCalories || 0}
                                    </div>
                                  </div>
                                </>
                              )}
                            </div>
                          ) : (
                            <div className="h-full w-full rounded-lg border border-dashed border-transparent hover:border-border flex items-center justify-center opacity-0 group-hover/row:opacity-100 transition-opacity cursor-pointer text-muted-foreground">
                              <Plus className="size-4" />
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {modalCell && (
        <EntryModal 
          cell={modalCell} 
          weekStart={weekStart}
          onClose={() => setModalCell(null)} 
        />
      )}
    </div>
  );
}

function EntryModal({ cell, weekStart, onClose }: { cell: { date: string; slot: MealScheduleSlot; entry?: MealScheduleEntry }; weekStart: string; onClose: () => void }) {
  const qc = useQueryClient();
  const mealsQuery = useListMeals();
  const create = useCreateMealScheduleEntry();
  const update = useUpdateMealScheduleEntry();
  const deletion = useQueueDeletion();

  const isEdit = !!cell.entry;
  const [kind, setKind] = useState<'meal' | 'break'>(cell.entry?.kind || 'meal');
  const [mealId, setMealId] = useState<number | ''>(cell.entry?.mealId || '');

  const meals = (mealsQuery.data || []).filter(m => m.isActive);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (kind === 'meal' && !mealId) return;

    const data: MealScheduleEntryInput = {
      date: cell.date,
      slotId: cell.slot.id,
      kind,
      mealId: kind === 'meal' ? Number(mealId) : null
    };

    if (isEdit) {
      update.mutate({ id: cell.entry!.id, data }, {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListMealScheduleQueryKey({ weekStart }) });
          onClose();
        }
      });
    } else {
      create.mutate({ data }, {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListMealScheduleQueryKey({ weekStart }) });
          onClose();
        }
      });
    }
  };

  const handleDelete = () => {
    if (!cell.entry) return;
    if (window.confirm('Энэ хуваарийг устгах уу?')) {
      void deletion.request(`/meal-schedule/${cell.entry.id}`, `${cell.date} ${cell.slot.name}-ийн хоолны хуваарь`);
      onClose();
    }
  };

  return (
    <Modal
      title={isEdit ? 'Хуваарь засах' : 'Хуваарь нэмэх'}
      detail={`${format(new Date(cell.date), 'yyyy.MM.dd')} өдрийн ${cell.slot.name} (${cell.slot.startTime}-${cell.slot.endTime})`}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-4">
          <div>
            <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-muted-foreground">Төрөл</label>
            <div className="flex gap-3">
              <button
                type="button"
                className={cn(
                  "flex-1 flex flex-col items-center justify-center gap-2 p-3 rounded-xl border-2 transition-all",
                  kind === 'meal' ? "border-orange-500 bg-orange-50 dark:bg-orange-950/30 text-orange-700 dark:text-orange-300" : "border-border bg-card hover:bg-secondary text-muted-foreground"
                )}
                onClick={() => setKind('meal')}
                data-testid="button-kind-meal"
              >
                <Utensils className="size-5" />
                <span className="text-sm font-semibold">Хоол</span>
              </button>
              <button
                type="button"
                className={cn(
                  "flex-1 flex flex-col items-center justify-center gap-2 p-3 rounded-xl border-2 transition-all",
                  kind === 'break' ? "border-blue-500 bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300" : "border-border bg-card hover:bg-secondary text-muted-foreground"
                )}
                onClick={() => { setKind('break'); setMealId(''); }}
                data-testid="button-kind-break"
              >
                <Coffee className="size-5" />
                <span className="text-sm font-semibold">Завсарлага</span>
              </button>
            </div>
          </div>

          {kind === 'meal' && (
            <div className="animate-in fade-in slide-in-from-top-2">
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-muted-foreground">Хоол сонгох</label>
              {mealsQuery.isLoading ? (
                <div className="h-10 rounded-md border border-input bg-secondary/50 animate-pulse" />
              ) : meals.length === 0 ? (
                <div className="text-sm text-destructive bg-destructive/10 p-2 rounded-md">Идэвхтэй хоол олдсонгүй. Хоолны цэс рүү орж хоол нэмнэ үү.</div>
              ) : (
                <select
                  value={mealId}
                  onChange={(e) => setMealId(e.target.value ? Number(e.target.value) : '')}
                  className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  required
                  data-testid="select-meal"
                >
                  <option value="" disabled>-- Сонгох --</option>
                  {meals.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.category})
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between pt-4 border-t border-border">
          {isEdit ? (
            <Button type="button" variant="ghost" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={handleDelete} disabled={deletion.isPending} data-testid="button-delete-entry">
              <Trash2 className="size-4 mr-2" /> Устгах
            </Button>
          ) : <div></div>}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose} data-testid="button-cancel-entry">Болих</Button>
            <Button type="submit" disabled={create.isPending || update.isPending} className="bg-orange-600 hover:bg-orange-700 text-white" data-testid="button-save-entry">
              {isEdit ? 'Хадгалах' : 'Нэмэх'}
            </Button>
          </div>
        </div>
        {(create.isError || update.isError) && <p className="text-sm text-destructive text-right mt-2">Хадгалахад алдаа гарлаа.</p>}
      </form>
    </Modal>
  );
}
