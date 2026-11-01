// The UI string table in Russian, the primary language (principle 8). Its keys are the contract: en.ts must hold the
// same set, so a missing or an extra key there is a compile error. Values are plain text; `{name}` is a placeholder
// that t() fills. Story lines are not here: they come from the chapter tables by line ID.

/** Every UI string of the overlay, in Russian. */
export const ru = {
  'tap.continue_story': 'Продолжить: {story}',
  'quick.advance': 'Дальше',
  'quick.choose': 'Выберите вариант',
  'quick.auto': 'Авто',
  'quick.skip': 'Пропуск',
  'quick.backlog': 'История',
  'quick.menu': 'Меню',
  'toast.resume_checkpoint': 'История обновилась: продолжаем с начала сцены',
  'toast.resume_chapter_start': 'История обновилась: продолжаем с начала главы',
  'toast.save_conflict': 'Прогресс сохранён на другом устройстве',
  'toast.save_conflict_load': 'Загрузить его',
  'toast.save_conflict_keep': 'Играть здесь',
  'toast.sound_resume': 'Нажмите, чтобы вернуть звук',
  'toast.purchase_failed': 'Оплата не прошла',
  'toast.purchase_refunded': 'Покупка возвращена',
  'toast.close': 'Закрыть',
} as const;
