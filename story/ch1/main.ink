INCLUDE ../common/globals.ink
// Skeleton chapter for the build pipeline: placeholder text, replaced by the narrative designer.
-> cafe

=== cafe ===
# scene: cafe
# show: ally neutral at=left
# bgm: calm
ally: Привет. Ты всё-таки пришёл. #id:ch1.cafe.k4p2
* [Конечно. Я же обещал. #id:ch1.cafe.w7m3]
    ~ g_trust_ally = 1
    -> street
* [Я ненадолго. #id:ch1.cafe.b2x9]
    -> street

=== street ===
# scene: street
Улица встречает холодным ветром. #id:ch1.street.q8n5
-> END
