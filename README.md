# Состав — регистрация участников группы (JWT)

Фронтенд для [Band Members API](https://inai-col3.fishrungames.com/api/docs/): регистрация, вход, профиль участника и выход на access/refresh токенах.

## Запуск

Проект написан на TypeScript. Нужен Node 22.18+ (тесты запускают `.ts` напрямую, без сборки).

```sh
npm install
npm start          # сборка src → dist, затем python3 -m http.server 8000 → http://localhost:8000
npm test           # node --test
npm run typecheck  # tsc без вывода файлов, проверяет src и test
npm run build      # tsc → dist/
npm run verify     # typecheck + test + build
```

`dist/` не хранится в git, браузер загружает `dist/main.js`, поэтому перед открытием страницы нужна сборка.

Открывать через `file://` нельзя: браузер не загружает ES-модули с файловой системы, а cookie для `null`-origin работают ненадёжно.

## Как устроена авторизация

| Что | Где хранится | Кто имеет доступ |
|---|---|---|
| access-токен (короткий) | переменная в памяти `src/api.ts` | JS этой вкладки |
| refresh-токен (длинный) | HttpOnly cookie бекенда | только браузер и сервер |

1. `POST /register/` или `POST /login/` возвращает в теле `{access, user}`, а refresh сервер кладёт в cookie.
2. Защищённые запросы отправляются с заголовком `Authorization: Bearer <access>`.
3. Если сервер ответил 401, клиент вызывает `POST /token/refresh/` (cookie браузер прикладывает сам), получает новый access и повторяет запрос один раз. Если несколько запросов получили 401 одновременно, refresh всё равно выполняется только один.
4. При перезагрузке страницы access пропадает из памяти, поэтому `restoreSession()` сразу делает refresh. Если cookie ещё действует, пароль вводить заново не нужно.
5. `POST /logout/` удаляет cookie, а клиент обнуляет access.

Все запросы отправляются с `credentials: 'include'`, иначе браузер не сохранит и не отправит cookie на другой домен.

## Файлы

- `src/api.ts` — HTTP-клиент: токены, refresh, разбор ошибок DRF.
- `src/types.ts` — типы ответов и запросов API (`User`, `Profile`, `ProfileUpdate`…).
- `src/validation.ts` — клиентские правила, повторяющие OpenAPI-схему.
- `src/main.ts` — интерфейс: экраны, формы, вкладки.
- `test/` — тесты сценариев токенов (с подменённым `fetch`) и валидации.
- `tsconfig.json` — проверка типов всего проекта; `tsconfig.build.json` — сборка для браузера.
