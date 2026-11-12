# Srpske reči · Сербские карточки

Карточки для сербских слов с наших уроков: интервальные повторения, режим «Собери слово», латиница и кириллица, озвучка, общий прогресс.

- `words.json`: все слова. Новые слова добавляет Claude.
- `audio/`: mp3-озвучка. Её создаёт GitHub Action через Azure AI Speech (голос `sr-Latn-RS-SophieNeural`), только для новых слов.
- `config.js`: адрес и публичный ключ Supabase, где хранится прогресс.
- `supabase/schema.sql`: таблица прогресса. Выполняется один раз.

Секреты репозитория (Settings → Secrets and variables → Actions):
`AZURE_SPEECH_KEY`. Регион по умолчанию `northeurope` (ресурс srpske-reci-tts-mopilek); секрет `AZURE_SPEECH_REGION` нужен только если ресурс переедет.
