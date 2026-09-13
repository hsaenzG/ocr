# OCR

Aplicación **full serverless** para OCR de imágenes y PDFs:

`Astro (Amplify Hosting) → API Gateway → Lambda` + `S3 → SQS → Lambda → Textract → DynamoDB (single table)`.

Los PDFs multipágina usan Textract asíncrono, así que cierran el ciclo por otro camino:

`Lambda → StartDocumentTextDetection → SNS → SQS → Lambda textractResult → DynamoDB`.

## Stack

| Capa | Tech |
|------|------|
| Frontend | Astro (`output: 'static'`) + TypeScript en **AWS Amplify Hosting** |
| API / Processor | AWS Lambda Node.js 24 + TypeScript |
| Infra | AWS CDK (TypeScript) |
| Data | DynamoDB single table, S3, SQS, SNS, Textract |

## Estructura

```txt
apps/web         Astro UI
apps/api         Lambda HTTP API
apps/processor   Lambda OCR worker (handler SQS + textractResultHandler)
packages/shared  Tipos compartidos
infra            CDK stack (API + Amplify app)
amplify.yml      Build spec Amplify (CI desde GitHub)
scripts/         deploy-amplify.sh (deploy manual del frontend)
```

## Prerrequisitos

- Node.js 20+ (recomendado 22/24)
- AWS CLI configurado
- AWS CDK CLI (`npm i -g aws-cdk` o usa el local del workspace)
- Cuenta bootstrapeada: `npx cdk bootstrap`
- `zip` en PATH (para `npm run deploy:web`)

## Setup

```bash
npm install
npm run build -w @ocr/shared
```

## Deploy infra (API + Amplify app)

```bash
cd infra
npx cdk deploy
```

Outputs útiles: `ApiUrl`, `AmplifyAppId`, `AmplifyUrl`, `AuthSecretArn`, `AuthUsername`.

### Auth (usuario único)

La API exige `Authorization: Bearer <jwt>` en todas las rutas excepto `GET /health` y `POST /auth/login`.

Credenciales viven en **Secrets Manager** (JSON `{ "username", "password", "jwtSecret?" }`). Por defecto el username es `natalia`; la password se genera al desplegar salvo que pases `-c authPassword`.

```bash
# Password fija al desplegar
cd infra
npx cdk deploy -c authUsername=natalia -c authPassword='tu-password-segura'

# Ver password generada
aws secretsmanager get-secret-value \
  --secret-id "$(aws cloudformation describe-stacks --stack-name OcrStack --query "Stacks[0].Outputs[?OutputKey=='AuthSecretArn'].OutputValue" --output text)" \
  --query SecretString --output text
```

Login: `POST /auth/login` con `{ "username", "password" }` → `{ token, username, expiresAt }`. El frontend guarda el token en `sessionStorage` y redirige a `/login/` si falta.

### Conectar GitHub (opcional, CI automático)

1. Guarda un GitHub PAT (`repo` scope) en Secrets Manager, p.ej. nombre `ocr-github-token`.
2. Redesplega con context:

```bash
cd infra
npx cdk deploy -c githubOwner=hsaenzG -c githubRepo=ocr -c githubTokenSecretName=ocr-github-token
```

Con eso, cada push a `main` dispara el build de Amplify (`amplify.yml` / buildSpec).

## Deploy frontend a Amplify

Sin GitHub aún, despliega el `dist/` local:

```bash
npm run deploy:web
```

Eso resuelve `ApiUrl` + `AmplifyAppId` del stack, buildea Astro con `PUBLIC_API_BASE_URL` y sube el zip a Amplify.

## Web local

```bash
# apps/web/.env
PUBLIC_API_BASE_URL=https://xxxx.execute-api.region.amazonaws.com

npm run dev:web
```

Abre http://localhost:4321

## Destroy

```bash
cd infra
npx cdk destroy
```

## API (MVP)

Rutas protegidas requieren header `Authorization: Bearer <token>` (excepto las marcadas públicas).

| Method | Path | Auth |
|--------|------|------|
| `GET` | `/health` | público |
| `POST` | `/auth/login` | público |
| `GET` | `/auth/me` | Bearer |
| `POST` | `/uploads/presign` | Bearer |
| `GET` | `/documents` | Bearer |
| `GET` | `/documents/{id}` | Bearer |
| `GET` | `/documents/{id}/preview-url` | Bearer |
| `GET` | `/stats/summary` | Bearer |
| `GET` | `/analytics/summary` | Bearer |

## Formatos soportados

| Content-type | Tamaño máx. | Modo Textract |
|--------------|-------------|---------------|
| `image/jpeg` | 10 MB | `DetectDocumentText` (sync) |
| `image/png` | 10 MB | `DetectDocumentText` (sync) |
| `application/pdf` | 50 MB | `StartDocumentTextDetection` (async vía SNS → SQS) |

Textract no soporta WebP, así que se rechaza en la UI y en el presign.

Un PDF queda en `PROCESSING` hasta que llega la notificación del job; el documento pasa a `COMPLETED` cuando la Lambda `textractResult` persiste el extract.

## Subida de lotes

- El cliente hace **presign + PUT por archivo** (no un solo presign del lote).
- Reintentos del PUT (3× con backoff) y concurrencia 2 si hay PDF pesados (>2 MB).
- Aviso al cerrar la pestaña si hay uploads activos; botón **Reintentar fallidos**.
- META `UPLOADED` lleva `expiresAt` (TTL 24 h). Si el browser nunca hace PUT, Dynamo borra el huérfano. Al pasar a PROCESSING/COMPLETED se quita el TTL.

## Analytics (DynamoDB Streams + Bedrock)

Cuando se inserta un item `EXTRACT`, un stream dispara la Lambda `analyticsStream` que:

1. Pasa el `plainText` por **Amazon Bedrock** (`amazon.nova-lite-v1:0`) para tabular campos limpios (encuestas KAP, facturas, etc.)
2. Si Bedrock falla, cae al parser heurístico
3. Escribe `DOC#… / ANALYTICS` + rollups (`STATS#ANALYTICS#DAILY`, `FIELD#…`, `KIND#…`)
4. Alimenta `GET /analytics/summary` y las gráficas del dashboard

Backfill / refresh (FORCE reescribe ANALYTICS sin duplicar stats diarios):

```bash
TABLE_NAME=$(aws cloudformation describe-stacks --stack-name OcrStack --query "Stacks[0].Outputs[?OutputKey=='TableName'].OutputValue" --output text)
TABLE_NAME=$TABLE_NAME FORCE=1 npx tsx scripts/backfill-analytics.ts
```

Parser solo heurístico: `ANALYTICS_PARSER=heuristic`.
