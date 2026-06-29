# Crypto Office AML API

Внутренний асинхронный HTTP-сервис для AML-проверки TRON-адресов из n8n.
Создание проверки быстро возвращает `job_id`, а финальный ответ Crypto Office
получается отдельным запросом без изменения JSON-структуры. Порт на Docker-хост
намеренно не публикуется.

## Требования и настройка

Нужны Docker и Docker Compose, а также существующая внешняя сеть
`n8n_default`.

```bash
cp .env.example .env
```

Заполните `CRYPTO_OFFICE_PUBLIC_KEY`, `CRYPTO_OFFICE_SECRET_KEY` и
`INTERNAL_API_KEY`. `blockchain` во внутреннем API необязателен; если указан,
поддерживается только `TRX` (провайдеру отправляется `tron`).
AML-провайдер задаётся через `CRYPTO_OFFICE_AML_SERVICE`: допустимы `crystal`
(по умолчанию) и `bitok`.

Путь AML API по умолчанию — `/aml/create`. Если путь в выданной вам версии API
Crypto Office отличается, задайте `CRYPTO_OFFICE_AML_PATH` в `.env`.

## Запуск

```bash
docker compose up -d --build
docker compose ps
docker logs -f crypto-office-aml-api
```

Сервис доступен контейнерам сети по адресу
`http://crypto-office-aml-api:8000`, но недоступен снаружи Docker.

## Проверка

Из контейнера n8n:

```bash
docker exec <n8n-container> wget -qO- http://crypto-office-aml-api:8000/health
```

Либо из временного контейнера:

```bash
docker run --rm --network n8n_default curlimages/curl:8.12.1 \
  http://crypto-office-aml-api:8000/health
```

AML-запрос:

```bash
docker run --rm --network n8n_default curlimages/curl:8.12.1 \
  -X POST http://crypto-office-aml-api:8000/v1/aml/check \
  -H 'Content-Type: application/json' \
  -H 'X-Internal-Api-Key: replace-with-INTERNAL_API_KEY' \
  -d '{"address":"TXL9Qc9ZAaxFFTR6DPqwGCeKpSgGyXxA1z","blockchain":"TRX"}'
```

Ответ создания имеет HTTP-статус `202`:

```json
{"job_id":"m_...","status":"pending"}
```

Результат проверяется отдельным запросом:

```bash
curl -H 'X-Internal-Api-Key: replace-with-INTERNAL_API_KEY' \
  http://crypto-office-aml-api:8000/v1/aml/check/m_...
```

Пока проверка выполняется, endpoint возвращает `202` и `status: pending`.
После завершения он возвращает `200` и исходный JSON Crypto Office.

## Локальные тесты

```bash
npm ci
npm test
```
