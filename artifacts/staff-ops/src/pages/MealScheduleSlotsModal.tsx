import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import {
  getListMealScheduleSlotsQueryKey,
  useCreateMealScheduleSlot,
  useUpdateMealScheduleSlot,
  type MealScheduleSlot,
  type MealScheduleSlotInput,
} from '@workspace/api-client-react';
import { useQueueDeletion } from '@/hooks/useQueueDeletion';
import { Modal } from '@/components/ui-primitives';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatMealSlotTimeRange } from './mealSlotTime';

type SlotDraft = MealScheduleSlotInput & { id?: number };

function emptyDraft(slots: MealScheduleSlot[]): SlotDraft {
  return {
    name: '',
    startTime: '08:00',
    endTime: '09:00',
    sortOrder: Math.max(0, ...slots.map((slot) => slot.sortOrder)) + 10,
  };
}

export function MealScheduleSlotsModal({
  slots,
  onClose,
}: {
  slots: MealScheduleSlot[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const create = useCreateMealScheduleSlot();
  const update = useUpdateMealScheduleSlot();
  const deletion = useQueueDeletion();
  const [draft, setDraft] = useState<SlotDraft>(() => emptyDraft(slots));
  const [showForm, setShowForm] = useState(false);

  const startCreate = () => {
    setDraft(emptyDraft(slots));
    setShowForm(true);
  };

  const startEdit = (slot: MealScheduleSlot) => {
    setDraft({ ...slot });
    setShowForm(true);
  };

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft.startTime || !draft.endTime || draft.startTime === draft.endTime) return;
    const data: MealScheduleSlotInput = {
      name: draft.name.trim(),
      startTime: draft.startTime,
      endTime: draft.endTime,
      sortOrder: Number(draft.sortOrder),
    };
    const afterSave = () => {
      void qc.invalidateQueries({ queryKey: getListMealScheduleSlotsQueryKey() });
      setShowForm(false);
      setDraft(emptyDraft(slots));
    };
    if (draft.id) {
      update.mutate({ id: draft.id, data }, { onSuccess: afterSave });
    } else {
      create.mutate({ data }, { onSuccess: afterSave });
    }
  };

  const remove = (slot: MealScheduleSlot) => {
    if (!window.confirm(`"${slot.name}" хоолны цагийг устгах уу?`)) return;
    void deletion.request(`/meal-schedule/slots/${slot.id}`, `${slot.name} хоолны цаг`);
  };

  const mutationError = create.isError || update.isError;
  const pending = create.isPending || update.isPending || deletion.isPending;

  return (
    <Modal
      title="Хоолны цаг тохируулах"
      detail="Календарийн мөрийн нэр, цаг болон харагдах дарааллыг удирдана."
      onClose={onClose}
    >
      <div className="space-y-4">
        <div className="space-y-2">
          {slots.map((slot) => (
            <div
              key={slot.id}
              className="flex items-center gap-3 rounded-xl border border-border bg-secondary/20 px-3 py-3"
              data-testid={`meal-slot-${slot.id}`}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{slot.name}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {formatMealSlotTimeRange(slot.startTime, slot.endTime)} · Дараалал {slot.sortOrder}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => startEdit(slot)}
                aria-label={`${slot.name} засах`}
                data-testid={`button-edit-meal-slot-${slot.id}`}
              >
                <Pencil className="size-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => remove(slot)}
                disabled={pending}
                aria-label={`${slot.name} устгах`}
                data-testid={`button-delete-meal-slot-${slot.id}`}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
        </div>

        {showForm ? (
          <form className="space-y-4 rounded-xl border border-border p-4" onSubmit={save}>
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-muted-foreground">Нэр</label>
              <Input
                value={draft.name}
                onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                maxLength={100}
                required
                autoFocus
                data-testid="input-meal-slot-name"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-muted-foreground">Эхлэх цаг</label>
                <Input
                  type="time"
                  value={draft.startTime}
                  onChange={(event) => setDraft((current) => ({ ...current, startTime: event.target.value }))}
                  required
                  data-testid="input-meal-slot-start-time"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-muted-foreground">Дуусах цаг</label>
                <Input
                  type="time"
                  value={draft.endTime}
                  onChange={(event) => setDraft((current) => ({ ...current, endTime: event.target.value }))}
                  required
                  data-testid="input-meal-slot-end-time"
                />
              </div>
            </div>
            {draft.startTime && draft.endTime && draft.startTime === draft.endTime && (
              <p className="text-sm text-destructive" role="alert">
                Эхлэх, дуусах цаг ижил байж болохгүй.
              </p>
            )}
            {draft.startTime && draft.endTime && draft.endTime < draft.startTime && (
              <p className="text-sm text-muted-foreground" data-testid="meal-slot-overnight-hint">
                Хоног дамнана: хуваарийн огноо нь эхлэх өдөр, дуусах цаг нь дараагийн өдөр.
              </p>
            )}
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-muted-foreground">Дараалал</label>
              <Input
                type="number"
                min={0}
                step={1}
                value={draft.sortOrder}
                onChange={(event) => setDraft((current) => ({ ...current, sortOrder: Number(event.target.value) }))}
                required
                data-testid="input-meal-slot-sort-order"
              />
              <p className="mt-1 text-xs text-muted-foreground">Бага тоотой мөр календарийн дээд талд харагдана.</p>
            </div>
            {mutationError && (
              <p className="text-sm text-destructive">Нэр эсвэл дараалал давхардсан, эсвэл цагийн мэдээлэл буруу байна.</p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Болих</Button>
              <Button type="submit" disabled={pending || !draft.startTime || !draft.endTime || draft.startTime === draft.endTime} data-testid="button-save-meal-slot">
                {draft.id ? 'Хадгалах' : 'Нэмэх'}
              </Button>
            </div>
          </form>
        ) : (
          <Button type="button" variant="outline" className="w-full" onClick={startCreate} data-testid="button-add-meal-slot">
            <Plus className="mr-2 size-4" /> Хоолны цаг нэмэх
          </Button>
        )}
      </div>
    </Modal>
  );
}