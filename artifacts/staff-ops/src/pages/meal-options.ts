import type { Meal } from '@workspace/api-client-react';

export const MEAL_CATEGORIES = ['1-р хоол', '2-р хоол', 'хачир', 'уух зүйл', 'ширхэгийн хоол'];

export const MEAL_TYPE_OPTIONS: Array<{ value: Meal['type']; label: string }> = [
  { value: 'set', label: 'Сет хоол' },
  { value: 'packed', label: 'Боолтын хоол' },
  { value: 'therapeutic', label: 'Эмчилгээний хоол' },
];

export function mealTypeLabel(type: Meal['type'] | null) {
  return MEAL_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? 'Хоол';
}