# Dota 2 Draft Helper

Статический сайт-помощник для анализа драфта Dota 2.

## Структура

- `site/index.html` — входная страница GitHub Pages.
- `collector/collect.mjs` — сбор статистики STRATZ в JSON.
- `.github/workflows/collect.yml` — ручной запуск сбора данных и публикации сайта.
- `data/` — создаваемые сборщиком данные; каталог появляется после успешного запуска.

## Публикация на GitHub Pages

1. В настройках репозитория откройте **Settings → Secrets and variables → Actions**.
2. Добавьте repository secret `STRATZ_TOKEN` со своим токеном STRATZ.
3. В **Settings → Pages** выберите публикацию через **GitHub Actions**.
4. Откройте **Actions → Collect data → Run workflow**.
5. Для полной публикации оставьте поле `heroes` пустым, выберите нужные `weeks` и `ranks`, затем включите `deploy`.

Сбор данных требует действительный `STRATZ_TOKEN`. Не добавляйте токен в HTML, коммиты или публичные файлы.

## Локальная проверка

Откройте `site/index.html` через локальный HTTP-сервер. Для работы рекомендаций нужны JSON-файлы в `data/`, созданные сборщиком.