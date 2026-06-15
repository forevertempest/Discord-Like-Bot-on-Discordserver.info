# Discord-Like-Bot-on-Discordserver.info
This bot automatically likes your server on the monitoring https://discordserver.info/
## Осторожно! (RU)

Автоматизация пользовательских аккаунтов (self-botting) нарушает Terms of Service платформы Discord. Данный скрипт предоставлен исключительно в ознакомительных и исследовательских целях. Разработчик не несет ответственности за возможные блокировки аккаунтов.

Утилита для автоматизации отправки слэш-команд в Discord. Бот предназначен для точного по времени выполнения команды `/like` на серверах мониторинга с учетом сетевых задержек и ограничений платформы.

## Основные возможности

- **Компенсация задержки сети (Ping Pre-fire)**: Бот автоматически замеряет REST-пинг до API Discord перед наступлением целевого времени и отправляет запрос с упреждением, что позволяет выполнять команды с точностью до миллисекунд.
- **Масштабирование запросов (Multi-Token Burst)**: Поддержка одновременного выполнения команд с нескольких аккаунтов (токенов) для минимизации вероятности отказа или задержки.
- **Ротация аккаунтов через SQLite**: Использование локальной базы данных для логирования времени активности токенов. При каждом запуске цикла скрипт выбирает аккаунты, которые дольше всего не использовались.
- **Мультиязычный парсинг**: Алгоритм анализирует ответы от ботов мониторинга (успех, кулдаун, глобальный сброс) и автоматически вычисляет время следующего запуска на основе текста.
- **Обработка сбросов**: При глобальном сбросе статистики бот автоматически переходит в режим цикличной отправки запросов каждые 30 секунд до получения успешного ответа.

## Архитектура работы

1. **Инициализация**: Извлечение из локальной базы данных (`tokens.db`) заданного количества (`burstCount`) наименее использованных токенов.
2. **Проверка статуса**: Авторизация и отправка команды `/remaining` для получения времени следующего действия.
3. **Ожидание**: При длительном простое сессии отключаются для экономии ресурсов. Бот "засыпает" до наступления нужного времени.
4. **Адаптация и запуск**: За 20 секунд до цели бот активирует сессии, замеряет задержку до API и инициирует таймер с высокоточным `spin-lock` циклом ожидания на последних миллисекундах.
5. **Выполнение**: Синхронная отправка `/like`, проверка результата и обновление статистики использования токенов в базе данных.

## Установка и запуск

### Требования
- ОС: Linux или Windows
- Node.js: версия 16.0 или выше
- Процесс-менеджер: PM2

### Установка зависимостей
```bash
npm install
```

### Настройка конфигурации
Дайте права своим токенам отправлять сообщения + команды и читать историю сообщений в "channelId".
Отредактируйте файл `config.json` в корневой директории:

```json
{
  "tokens": [
    "ВАШ_ТОКЕН_1",
    "ВАШ_ТОКЕН_2"
  ],
  "pingOffsetMs": 100,
  "burstCount": 1,
  "channelId": "1401573518239596564",
  "likeCommand": {
    "botId": "575776004233232386",
    "commandName": "like",
    "commandId": "788801838828879933",
    "versionId": "1343606485460193311"
  },
  "remainingCommand": {
    "botId": "478321260481478677",
    "commandName": "remaining",
    "commandId": "1003291339393339434",
    "versionId": "1003291339393339440"
  },
  "testMode": false,
  "testWaitSeconds": 10
}
```

**Описание параметров:**
- `burstCount` (int): Количество токенов, которые будут использованы одновременно для одного запроса. 
- `pingOffsetMs` (int): Статичное смещение (в миллисекундах) для компенсации пинга в случае, если динамический замер недоступен.
- `tokens` (array): Токены можете вставлять сколько угодно. Хватит и одного, но если вы хотите, чтобы было переключение аккаунтов и не лайкал один токен, то добавьте больше.
- `channelId` (string): Айди вашего канала, куда будут прописываться команды и читаться эмбеды от ботов.
- `likeCommand` (object): Нужная для бота информация о боте мониторинге. Бота мониторинга вы должны добавить к себе на сервер, чтобы была возможность лайкать. Не забудьте добавить сервер на мониторинге https://discordserver.info/add. 
- `remainingCommand` (object): Это бот для парсинга времени следующего лайка. Через него бот узнает информацию о нынешним состоянии сервер. Бот распознает успешный лайк, кулдаун, глобальный сброс лайков, если лайк не прошел или если лайкнуть можно сейчас. Добавить этого бота вы можете по этой ссылке: https://discord.com/oauth2/authorize?client_id=478321260481478677.

**О базе данных (SQLite):**
При первом запуске скрипта в папке автоматически создастся файл `tokens.db`. В нем бот сохраняет историю использования токенов для корректной ротации. Создавать этот файл вручную **не требуется** — бот сделает всё сам.

### Управление через PM2

**Запуск:**
```bash
pm2 start index.js --name self-ds-like
```

**Мониторинг логов:**
```bash
pm2 logs self-ds-like
```

**Перезапуск процесса (например, после изменения конфигурации):**
```bash
pm2 restart self-ds-like
```

# Обо мне (медиа):
TGK: https://t.me/tempestdevelop
Telegram: @maga_zovyt
Discord: foreverfame

## Warning! (EN)

Automating user accounts (self-botting) violates the Discord Terms of Service. This script is provided exclusively for educational and research purposes. The developer is not responsible for any potential account bans.

A utility for automating the sending of slash commands in Discord. The bot is designed for precise, time-based execution of the `/like` command on monitoring servers, accounting for network latency and platform limitations.

## Core Features

- **Network Latency Compensation (Ping Pre-fire)**: The bot automatically measures REST ping to the Discord API right before the target time and sends the request with anticipation, allowing command execution with millisecond precision.
- **Request Scaling (Multi-Token Burst)**: Supports simultaneous command execution from multiple accounts (tokens) to minimize the chance of failure or delay.
- **Account Rotation via SQLite**: Uses a local database to log the activity time of tokens. Upon each cycle start, the script selects the accounts that have been idle the longest.
- **Multi-language Parsing**: The algorithm analyzes responses from monitoring bots (success, cooldown, global reset) and automatically calculates the next execution time based on the text.
- **Reset Handling**: During a global statistics reset, the bot automatically enters a loop, sending requests every 30 seconds until a successful response is received.

## Architecture

1. **Initialization**: Retrieves a specified number (`burstCount`) of least recently used tokens from the local database (`tokens.db`).
2. **Status Check**: Authenticates and sends the `/remaining` command to get the time for the next action.
3. **Standby**: During long idle periods, sessions are disconnected to save resources. The bot "sleeps" until the target time approaches.
4. **Adaptation and Launch**: 20 seconds before the target, the bot activates sessions, measures API latency, and initiates a timer with a high-precision `spin-lock` wait loop for the final milliseconds.
5. **Execution**: Synchronous sending of `/like`, result verification, and updating token usage statistics in the database.

## Installation and Setup

### Requirements
- OS: Linux or Windows
- Node.js: version 16.0 or higher
- Process Manager: PM2

### Installing Dependencies
```bash
npm install
```

### Configuration Setup
Grant your tokens the permissions to send messages + commands and read message history in the "channelId".
Edit the `config.json` file in the root directory:

```json
{
  "tokens": [
    "YOUR_TOKEN_1",
    "YOUR_TOKEN_2"
  ],
  "pingOffsetMs": 100,
  "burstCount": 1,
  "channelId": "1401573518239596564",
  "likeCommand": {
    "botId": "575776004233232386",
    "commandName": "like",
    "commandId": "788801838828879933",
    "versionId": "1343606485460193311"
  },
  "remainingCommand": {
    "botId": "478321260481478677",
    "commandName": "remaining",
    "commandId": "1003291339393339434",
    "versionId": "1003291339393339440"
  },
  "testMode": false,
  "testWaitSeconds": 10
}
```

**Parameters Description:**
- `burstCount` (int): Number of tokens to be used simultaneously for a single request. 
- `pingOffsetMs` (int): Static offset (in milliseconds) for ping compensation in case dynamic measurement is unavailable.
- `tokens` (array): You can insert as many tokens as you want. One is enough, but if you want account switching and don't want a single token to do all the liking, add more.
- `channelId` (string): The ID of your channel where commands will be written and embeds from bots will be read.
- `likeCommand` (object): Required bot information about the monitoring bot. You must add the monitoring bot to your server to be able to like. Don't forget to add your server on the monitoring site https://discordserver.info/add. 
- `remainingCommand` (object): This is the bot used to parse the time of the next like. Through it, the bot learns information about the current state of the server. The bot recognizes a successful like, cooldown, global like reset, if a like failed, or if it's time to like right now. You can add this bot via this link: https://discord.com/oauth2/authorize?client_id=478321260481478677.

**About the Database (SQLite):**
On the first run of the script, a `tokens.db` file will be automatically created in the folder. In it, the bot saves the history of token usage for proper rotation. You **do not need** to create this file manually — the bot will do everything itself.

### Managing via PM2

**Start:**
```bash
pm2 start index.js --name self-ds-like
```

**Monitor logs:**
```bash
pm2 logs self-ds-like
```

**Restart process (e.g., after changing configuration):**
```bash
pm2 restart self-ds-like
```

# About Me (Media):
TGK: https://t.me/tempestdevelop
Telegram: @maga_zovyt
Discord: foreverfame
