INCLUDE ../common/globals.ink
-> shore

=== shore ===
# scene: shore
# bgm: waves
К вечеру ветер пригнал с моря тяжёлые тучи. #id:ch3.shore.s001
Я засиделась на берегу с альбомом и не заметила, как начался прилив. #id:ch3.shore.s002
Вода уже подбиралась к тропинке, по которой я пришла. #id:ch3.shore.s003
Первая волна лизнула мои кеды. Вторая дошла до колен. #id:ch3.shore.s004
До деревни было два пути. #id:ch3.shore.s005
Вброд, по камням вдоль скал, — короче. Но вода прибывала с каждой минутой. #id:ch3.shore.s006
Или вверх, по старой лестнице к маяку. В его окне горел свет. #id:ch3.shore.s007
В деревне говорили, что смотритель живёт там один и ни с кем не разговаривает. #id:ch3.shore.s008
* [Идти вброд к скалам #id:ch3.shore.c001]
    Я сняла кеды и шагнула в воду. #id:ch3.shore.s009
    -> shore_drowned
* [Подняться к маяку #id:ch3.shore.c002]
    Я прижала альбом к груди и побежала к лестнице. #id:ch3.shore.s010
    -> lighthouse

=== shore_drowned ===
# bgm: stop fade=3000
Камни были скользкими, а вода — ледяной. #id:ch3.shore_drowned.d001
Я почти дошла до скал, когда из темноты поднялась высокая волна. #id:ch3.shore_drowned.d002
Она сбила меня с ног и потянула за собой. #id:ch3.shore_drowned.d003
Свет маяка мелькнул где-то очень далеко. #id:ch3.shore_drowned.d004
А потом море сомкнулось надо мной, и всё стихло. #id:ch3.shore_drowned.d005
-> END

=== lighthouse ===
# scene: lighthouse
# show: keeper worried at=center
Дверь маяка распахнулась раньше, чем я успела постучать. #id:ch3.lighthouse.l001
keeper: Ты с ума сошла? В такой шторм — на берегу? #id:ch3.lighthouse.l002
На пороге стоял парень чуть старше меня, в мокром свитере и с фонарём в руке. #id:ch3.lighthouse.l003
keeper: Заходи. Скорее, пока лестницу не залило. #id:ch3.lighthouse.l004
Внутри пахло солью, керосином и крепким чаем. #id:ch3.lighthouse.l005
keeper: Я Матвей. Смотритель. Гостей здесь не бывает, так что прости за беспорядок. #id:ch3.lighthouse.l006
Он накинул мне на плечи сухой плед. #id:ch3.lighthouse.l007
# show: keeper smile
keeper: Ты ведь рисуешь? Я видел тебя на берегу. Каждый вечер. #id:ch3.lighthouse.l008
Я почувствовала, что краснею. #id:ch3.lighthouse.l009
# show: keeper worried
Лампа под потолком мигнула. Матвей посмотрел вверх. #id:ch3.lighthouse.l010
keeper: Фонарь наверху барахлит третью ночь. А в море ещё лодки. #id:ch3.lighthouse.l011
keeper: В деревне говорят, что я чудак. Что слышу по рации голоса, которых нет. #id:ch3.lighthouse.l012
keeper: Но рация молчит не просто так. Кто-то пытается выйти на связь. #id:ch3.lighthouse.l013
keeper: Ты мне веришь? #id:ch3.lighthouse.l014
* [«Верю. Чем я могу помочь?» #id:ch3.lighthouse.c001]
    ~ g_tide_trust_keeper = 1
    # show: keeper smile
    keeper: Спасибо. Мне давно никто не верил. #id:ch3.lighthouse.l015
    keeper: Тогда идём наверх. Вдвоём мы справимся быстрее. #id:ch3.lighthouse.l016
* [«Не знаю. Я ведь тебя совсем не знаю» #id:ch3.lighthouse.c002]
    ~ g_tide_trust_keeper = 0
    keeper: Понимаю. Я бы тоже себе не поверил. #id:ch3.lighthouse.l017
    keeper: Но наверху мне нужна вторая пара рук. Пожалуйста. #id:ch3.lighthouse.l018
- -> lighthouse_stairs

=== lighthouse_stairs ===
# show: keeper neutral at=center
Винтовая лестница уходила вверх, в темноту. #id:ch3.lighthouse_stairs.t001
Ветер выл за стенами так, что дрожали стёкла. #id:ch3.lighthouse_stairs.t002
{ g_tide_trust_keeper == 1:
    На крутом повороте Матвей протянул мне руку. #id:ch3.lighthouse_stairs.t003
    Его ладонь была тёплой. Я не отпускала её до самого верха. #id:ch3.lighthouse_stairs.t004
- else:
    Матвей шёл впереди и то и дело оглядывался, не отстала ли я. #id:ch3.lighthouse_stairs.t005
}
Мы были почти наверху, когда свет погас. #id:ch3.lighthouse_stairs.t006
# show: keeper worried
keeper: Нет. Только не сейчас. #id:ch3.lighthouse_stairs.t007
В темноте зашипела рация. Сквозь треск пробился чей-то голос. #id:ch3.lighthouse_stairs.t008
«Маяк, ответьте… Мы не видим берега…» #id:ch3.lighthouse_stairs.t009
Матвей обернулся ко мне. В темноте я видела только его глаза. #id:ch3.lighthouse_stairs.t010
keeper: Ты это слышала? Скажи, что ты тоже это слышала. #id:ch3.lighthouse_stairs.t011
-> END
