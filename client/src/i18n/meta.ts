// The meta overlays' UI strings (META-PLAN M27): their own table, imported only by ui/meta/*, so these texts ship in
// the lazy meta chunk and never in the entry. Russian first (its keys are the contract), English second. Ending
// titles, achievement names and pack titles are server data and never here (MT3). The consent, invite, decline and
// remove texts are the team's drafts; a lawyer reviews them before production (OPEN-QUESTIONS Q23).
import type { Lang } from './index.ts';

/** Every meta overlay string, in Russian. */
export const metaRu = {
  'meta.card_title': 'Прохождение: {story}',
  'meta.card_runs': 'Прохождений: {n}',
  'meta.card_chapters': 'Глав пройдено: {n}',
  'meta.card_endings': 'Найденные концовки',
  'meta.card_achievements': 'Достижения',
  'meta.card_new': 'Новое',
  'meta.card_share': 'Поделиться',
  'meta.friends_title': 'Друзья',
  'meta.friends_invite': 'Пригласить друга',
  'meta.friends_visibility': 'Показывать мой прогресс друзьям',
  'meta.friends_visibility_on': 'Вкл.',
  'meta.friends_visibility_off': 'Выкл.',
  'meta.friends_requests': 'Запросы в друзья',
  'meta.friends_accept': 'Принять',
  'meta.friends_decline': 'Отклонить',
  'meta.friends_decline_note': 'Если отклонить запрос, этот человек не сможет отправить вам новый.',
  'meta.friends_empty': 'Пока нет друзей. Пригласите кого-нибудь по ссылке.',
  'meta.friends_policy': 'Политика конфиденциальности',
  'meta.friend_hidden': 'Прогресс скрыт',
  'meta.friend_endings': 'Концовок найдено: {n}',
  'meta.friend_achievements': 'Достижений: {n}',
  'meta.friend_shared': 'Нашли вы оба',
  'meta.friend_gift': 'Подарить',
  'meta.friend_remove': 'Удалить друга',
  'meta.friend_remove_note': 'Этот человек исчезнет из ваших друзей и не сможет снова отправить вам запрос.',
  'meta.friend_remove_confirm': 'Да, удалить',
  'meta.invite_title': 'Отправить запрос в друзья?',
  'meta.invite_body':
    'Человек, который поделился этой ссылкой, увидит ваше имя из Telegram. Вы станете друзьями, только если он примет ваш запрос.',
  'meta.invite_send': 'Отправить запрос',
  'meta.invite_later': 'Не сейчас',
  'meta.consent_title': 'Прогресс для друзей',
  'meta.consent_body':
    'Ваш прогресс увидят только ваши друзья: люди, чей запрос в друзья вы приняли, и люди, которые приняли ваш запрос. Больше никто. Друзья увидят, сколько концовок и достижений вы нашли в каждой истории, и названия тех, что нашли и они. Согласие можно отозвать в любой момент одним нажатием.',
  'meta.consent_switch': 'Показывать мой прогресс друзьям',
  'meta.consent_policy': 'Политика конфиденциальности',
  'meta.wallet_title': 'Кошелёк',
  'meta.wallet_balance': '{kind}: {n}',
  'meta.wallet_debt': 'долг: {n}',
  'meta.kind_hint': 'Подсказки',
  'meta.wallet_packs': 'Наборы',
  'meta.wallet_buy': 'Купить за {stars} ⭐',
  'meta.wallet_terms_agree': 'Я прочитал(а) условия и согласен(на) с ними',
  'meta.wallet_terms_link': 'Условия',
  'meta.gift_title': 'Подарок для {name}',
  'meta.gift_amount': 'Количество: {n}',
  'meta.gift_less': 'Меньше',
  'meta.gift_more': 'Больше',
  'meta.gift_send': 'Подарить',
  'meta.gift_capped': 'Дневной лимит подарков исчерпан',
  'meta.gift_retry': 'Следующий подарок можно отправить через {hours} ч',
  'meta.gift_insufficient': 'Недостаточно на балансе',
  'meta.gift_not_friend': 'Этот человек больше не в ваших друзьях',
  'meta.error_retry': 'Не получилось. Попробуйте ещё раз',
  'meta.cancel': 'Отмена',
} as const;

/** A key of the meta table; metaRu defines the set. */
export type MetaKey = keyof typeof metaRu;

/** Every meta overlay string, in English: a key missing here is TS2741 and an extra one TS2353. */
export const metaEn: Readonly<Record<MetaKey, string>> = {
  'meta.card_title': 'Playthrough: {story}',
  'meta.card_runs': 'Playthroughs: {n}',
  'meta.card_chapters': 'Chapters completed: {n}',
  'meta.card_endings': 'Endings found',
  'meta.card_achievements': 'Achievements',
  'meta.card_new': 'New',
  'meta.card_share': 'Share',
  'meta.friends_title': 'Friends',
  'meta.friends_invite': 'Invite a friend',
  'meta.friends_visibility': 'Show my progress to friends',
  'meta.friends_visibility_on': 'On',
  'meta.friends_visibility_off': 'Off',
  'meta.friends_requests': 'Friend requests',
  'meta.friends_accept': 'Accept',
  'meta.friends_decline': 'Decline',
  'meta.friends_decline_note': 'If you decline, this person cannot send you another request.',
  'meta.friends_empty': 'No friends yet. Invite someone with a link.',
  'meta.friends_policy': 'Privacy policy',
  'meta.friend_hidden': 'Progress hidden',
  'meta.friend_endings': 'Endings found: {n}',
  'meta.friend_achievements': 'Achievements: {n}',
  'meta.friend_shared': 'You both found',
  'meta.friend_gift': 'Send a gift',
  'meta.friend_remove': 'Remove friend',
  'meta.friend_remove_note': 'This person will leave your friends and cannot send you a request again.',
  'meta.friend_remove_confirm': 'Yes, remove',
  'meta.invite_title': 'Send a friend request?',
  'meta.invite_body':
    'The person who shared this link will see your Telegram first name. You become friends only if they accept your request.',
  'meta.invite_send': 'Send request',
  'meta.invite_later': 'Not now',
  'meta.consent_title': 'Progress for friends',
  'meta.consent_body':
    'Only your friends will see your progress: the people whose friend request you accepted and the people who accepted your request. No one else. Friends see how many endings and achievements you have found in each story, and the titles of those they have found too. You can withdraw this consent at any time with one tap.',
  'meta.consent_switch': 'Show my progress to friends',
  'meta.consent_policy': 'Privacy policy',
  'meta.wallet_title': 'Wallet',
  'meta.wallet_balance': '{kind}: {n}',
  'meta.wallet_debt': 'debt: {n}',
  'meta.kind_hint': 'Hints',
  'meta.wallet_packs': 'Packs',
  'meta.wallet_buy': 'Buy for {stars} ⭐',
  'meta.wallet_terms_agree': 'I have read and agree to the terms',
  'meta.wallet_terms_link': 'Terms',
  'meta.gift_title': 'A gift for {name}',
  'meta.gift_amount': 'Amount: {n}',
  'meta.gift_less': 'Less',
  'meta.gift_more': 'More',
  'meta.gift_send': 'Send',
  'meta.gift_capped': 'The daily gift limit is reached',
  'meta.gift_retry': 'The next gift is possible in {hours} h',
  'meta.gift_insufficient': 'Not enough balance',
  'meta.gift_not_friend': 'This person is no longer your friend',
  'meta.error_retry': 'Something went wrong. Please try again',
  'meta.cancel': 'Cancel',
};

/** The consent text's version (META-PLAN M12, MT5): a new wording of the consent text gets a new version. */
export const CONSENT_TEXT_VERSION = 'friends_profile.v1';
/** The one version the consent dialog sends; the server accepts a closed list (LF1). */
export type ConsentTextVersion = typeof CONSENT_TEXT_VERSION;

const TABLES: Readonly<Record<Lang, Readonly<Record<MetaKey, string>>>> = { ru: metaRu, en: metaEn };
const PLACEHOLDER = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/**
 * The meta string under `key` in `lang`, with each `{name}` replaced by `params[name]` in one pass; t()'s rule
 * (i18n/index.ts), copied so this table never joins the entry's module graph.
 */
export function mt(lang: Lang, key: MetaKey, params?: Readonly<Record<string, string | number>>): string {
  const text = TABLES[lang][key];
  if (params === undefined) {
    return text;
  }
  return text.replace(PLACEHOLDER, (whole, name: string) => (Object.hasOwn(params, name) ? String(params[name]) : whole));
}
