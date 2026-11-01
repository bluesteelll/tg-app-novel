INCLUDE ../common/globals.ink
VAR pz_gate = 0
VAR pz_drawer_hints = 0
VAR dc_letter = false
VAR calmed_ally = false
-> arrival

=== arrival ===
# scene: street
# show: ally neutral at=left
# bgm: calm
Бабушкин конверт я нашла в её шкатулке, под старыми кольцами. #id:ch1.arrival.a001
Внутри был ключ и одна строчка: «Усадьба Вязы. Отдай ему то, что я не успела». #id:ch1.arrival.a002
ally: Мы правда едем в заброшенную усадьбу на ночь глядя? Ради одной строчки? #id:ch1.arrival.a003
ally: Ладно. Одну я бы тебя всё равно не отпустила. #id:ch1.arrival.a004
# show: stranger neutral at=right
У ворот усадьбы стоял парень с фонариком. #id:ch1.arrival.a005
stranger: Здесь частная территория. Хотя… теперь уже ничья. #id:ch1.arrival.a006
stranger: Я Арсений. Это был дом моего деда. #id:ch1.arrival.a007
stranger: А вы что здесь ищете? #id:ch1.arrival.a008
* [Улыбнуться и показать ему ключ #id:ch1.arrival.c001]
    ~ g_manor_trust += 1
    stranger: Такой же ключ дед носил на цепочке. Всю жизнь. #id:ch1.arrival.a009
    stranger: Значит, она всё-таки ответила. #id:ch1.arrival.a010
* [Спрятать ключ в карман #id:ch1.arrival.c002]
    stranger: Не доверяешь. И правильно: здесь многие что-то ищут. #id:ch1.arrival.a011
- stranger: Мне нужно проверить старый ход в саду. В дом одни не ходите. #id:ch1.arrival.a012
# hide: stranger
ally: Конечно. Именно туда мы и пойдём. #id:ch1.arrival.a013
-> manor_arrive

=== manor_arrive ===
# scene: hall
# show: ally neutral at=left
# bgm: tension
Ключ подошёл к двери так, будто её запирали вчера. #id:ch1.manor_arrive.a002
Внутри пахло воском и сырым деревом. #id:ch1.manor_arrive.a003
Дверь за нами захлопнулась сама. Замок сухо щёлкнул. #sfx: door #id:ch1.manor_arrive.a004
# show: ally worried
ally: Нет-нет-нет. Она не открывается! #id:ch1.manor_arrive.a005
* [Взять Соню за руку #id:ch1.manor_arrive.c001]
    ~ calmed_ally = true
    ally: …Спасибо. Ладно. Я дышу. #id:ch1.manor_arrive.a006
* [«Это ты предложила ехать вечером!» #id:ch1.manor_arrive.c002]
    ally: Я? Это у тебя был ключ! #id:ch1.manor_arrive.a007
- ally: Мы заперты. Должен быть другой выход. #id:ch1.manor_arrive.a001
ally: Вон там, в глубине зала, — решётка в сад. #id:ch1.manor_arrive.a008
# explore: manor
-> DONE

=== manor_cellar_voice ===
voice: Кто там? #id:ch1.manor_cellar_voice.v001
Голос шёл из-за ржавой решётки в стене. Знакомый голос. #id:ch1.manor_cellar_voice.v002
voice: Это ты, у ворот? Я полез в ход из сада, и решётка упала за мной. #id:ch1.manor_cellar_voice.v003
voice: Не бойся. Я выберусь через архив. Наверное. #id:ch1.manor_cellar_voice.v004
* [«Держись. Я найду, как тебя вытащить» #id:ch1.manor_cellar_voice.c001]
    ~ g_manor_promise = true
    ~ g_manor_trust += 1
    voice: Спасибо. Мне давно никто ничего не обещал. #id:ch1.manor_cellar_voice.v005
* [«Что ты ищешь в этом доме?» #id:ch1.manor_cellar_voice.c002]
    voice: То же, что и ты. Правду про них двоих. #id:ch1.manor_cellar_voice.v006
- Шаги за решёткой стихли. #id:ch1.manor_cellar_voice.v007
# explore: manor
-> DONE

=== manor_gate_forced ===
Медальоны провернулись и встали криво. Внутри что-то хрустнуло. #id:ch1.manor_gate_forced.f002
ally: Отойди. Я её выломаю. #id:ch1.manor_gate_forced.f001
Соня навалилась плечом. Петля лопнула с жутким скрежетом. #id:ch1.manor_gate_forced.f003
~ g_gate_forced = true
# explore: manor
-> DONE

=== manor_out ===
# scene: street
# show: ally neutral at=left
{ pz_gate == 1:
    Решётка открылась без единого звука. #id:ch1.manor_out.o001
- else:
    Решётка повисла на одной петле. #id:ch1.manor_out.o002
}
{ pz_drawer_hints > 0:
    ally: С тем ящиком тебе ведь помогли, да? #id:ch1.manor_out.o003
}
{ calmed_ally:
    ally: Ты держала меня за руку, когда я паниковала. Я не забуду. #id:ch1.manor_out.o004
- else:
    ally: Ладно. Я больше не злюсь. Почти. #id:ch1.manor_out.o005
}
-> street

=== street ===
# scene: street
# show: ally neutral at=left
# show: stranger neutral at=right
# bgm: mystery
Сад вывел нас к дороге. У фонаря стоял Арсений. #id:ch1.street.s001
stranger: Выбрались? Я тоже — через старый колодец. #id:ch1.street.s002
{ g_manor_promise:
    stranger: Ты обещала меня вытащить. Я почти дождался. #id:ch1.street.s003
- else:
    stranger: Ты спрашивала, что я ищу. Вот что. #id:ch1.street.s004
}
stranger: Это лежало в подвале, в нише за решёткой. #id:ch1.street.s005
# cg: letter
Пожелтевший конверт, а в нём фотография. Девушка в светлом платье — моя бабушка, совсем юная. #id:ch1.street.s006
Рядом с ней юноша. У него лицо Арсения. #id:ch1.street.s007
На обороте: «12 мая. Наш день. Правда — в архиве». #id:ch1.street.s008
{ dc_letter:
    Я вспомнила письмо из кабинета: «Пусть узнают правду». #id:ch1.street.s009
}
# cg: off
stranger: Наши семьи молчали шестьдесят лет. Я хочу знать почему. #id:ch1.street.s010
stranger: Архив под часовней. Пойдёшь со мной? #id:ch1.street.s011
* [Взять его за руку #id:ch1.street.c001]
    ~ g_manor_trust += 1
    # show: stranger smile
    stranger: У тебя холодные пальцы. #id:ch1.street.s012
    stranger: Тогда идём. Вместе. #id:ch1.street.s013
* [«Сначала скажи, что тебе известно» #id:ch1.street.c002]
    stranger: Немного. Что дед любил её до последнего дня. #id:ch1.street.s014
    stranger: И что ответ он спрятал там, куда никого не пускал. #id:ch1.street.s015
- ally: Подождите. Смотрите — часовня. #id:ch1.street.s016
Над деревьями, в узком окне часовни, вспыхнул свет. #id:ch1.street.s017
# bgm: tension
Кто-то уже был в архиве. #id:ch1.street.s018
-> END
