INCLUDE ../common/globals.ink
VAR pz_cabinet = 0
-> archive_cabinet

=== archive_cabinet ===
# scene: archive
# show: stranger neutral at=right
# bgm: mystery
Под часовней пахло пылью и холодным камнем. #id:ch2.archive_cabinet.c002
На крюке горела забытая лампа. В пыли на полу темнели чужие следы. #id:ch2.archive_cabinet.c003
{
- g_manor_trust >= 2:
    stranger: Я рад, что ты пошла со мной. Правда рад. #id:ch2.archive_cabinet.c004
- g_manor_trust == 1:
    stranger: Спасибо, что пришла. Я не был уверен, что придёшь. #id:ch2.archive_cabinet.c005
- else:
    stranger: Ты всё ещё мне не доверяешь. Я понимаю. #id:ch2.archive_cabinet.c006
}
{ g_manor_promise:
    stranger: В подвале ты обещала меня вытащить. Теперь моя очередь помогать. #id:ch2.archive_cabinet.c007
}
{ g_gate_forced:
    stranger: Сторож наверняка видел выломанную решётку. Скоро он будет здесь. #id:ch2.archive_cabinet.c008
- else:
    stranger: Сторож делает обход раз в час. Время у нас есть. #id:ch2.archive_cabinet.c009
}
* [Спросить о его деде #id:ch2.archive_cabinet.q001]
    stranger: Он ждал её всю жизнь. Так и не женился. #id:ch2.archive_cabinet.c010
* [Спросить, зачем ему эта правда #id:ch2.archive_cabinet.q002]
    stranger: Дед просил. А ещё… я хотел найти тебя. #id:ch2.archive_cabinet.c011
- В углу стоял шкаф. У него три диска и пыльная табличка. #id:ch2.archive_cabinet.c001
На табличке: «Открою в наш день». #id:ch2.archive_cabinet.c012
# puzzle: cabinet then=archive_after
-> DONE

=== archive_after ===
{ pz_cabinet == 1:
    Диски щёлкнули. Дверца шкафа подалась. #id:ch2.archive_after.a001
- else:
    Диски не поддавались. Механизм заело намертво. #id:ch2.archive_after.a002
}
{ g_gate_forced:
    Наверху хлопнула дверь. Сторож шёл на шум. #sfx: door #id:ch2.archive_after.a003
}
{ pz_cabinet == 1:
    -> archive_truth
}
-> archive_ashes

=== archive_truth ===
# cg: reveal
# bgm: calm
Внутри лежала стопка писем, перевязанных лентой. #id:ch2.archive_truth.t001
Её письма и его. Ни одно так и не было отправлено. #id:ch2.archive_truth.t002
stranger: «Анна, я ждал тебя у часовни каждое двенадцатое мая». #id:ch2.archive_truth.t003
stranger: Они любили друг друга. А семьи сказали: нельзя. #id:ch2.archive_truth.t004
Последнее письмо было от бабушки. «Если наши внуки найдут друг друга, пусть не повторят нашей ошибки». #id:ch2.archive_truth.t005
# cg: off
# show: stranger smile
stranger: Похоже, они знали про нас раньше нас самих. #id:ch2.archive_truth.t006
* [Взять его за руку #id:ch2.archive_truth.q001]
    Его пальцы были тёплыми. Он не отпустил мою руку. #id:ch2.archive_truth.t007
* [Поцеловать его в щёку #id:ch2.archive_truth.q002]
    stranger: Это было «спасибо» или «останься»? #id:ch2.archive_truth.t008
    «Останься», — ответила я. #id:ch2.archive_truth.t009
- Мы вышли из архива вместе. Над усадьбой светало. #id:ch2.archive_truth.t010
-> END

=== archive_ashes ===
# show: stranger serious at=right
# bgm: tension
stranger: Оставь. Его не открыть. #id:ch2.archive_ashes.h001
Я отступила, задела крюк, и лампа сорвалась вниз. #id:ch2.archive_ashes.h002
Сухая бумага вспыхнула сразу. Огонь побежал по полкам. #id:ch2.archive_ashes.h003
stranger: Наверх! Быстрее! #id:ch2.archive_ashes.h004
Мы выбрались из часовни. За спиной горел архив и всё, что они не успели сказать. #id:ch2.archive_ashes.h005
{ g_manor_trust >= 2:
    stranger: Ты не виновата. Но мне нужно побыть одному. #id:ch2.archive_ashes.h006
- else:
    stranger: Наверное, так и должно было кончиться. Как у них. #id:ch2.archive_ashes.h007
}
{ g_manor_promise:
    stranger: Ты сдержала обещание. Спасибо тебе за это. #id:ch2.archive_ashes.h008
}
Он ушёл по дороге навстречу рассвету. Их правду я так и не узнала. #id:ch2.archive_ashes.h009
-> END
