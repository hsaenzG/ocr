# OCR

Aplicación **full serverless** para OCR de imágenes:

`Astro (Amplify Hosting) → API Gateway → Lambda` + `S3 → SQS → Lambda → Textract → DynamoDB (single table)`.

## Stack

| Capa | Tech |
|------|------|
| Frontend | Astro (`output: 'static'`) + TypeScript en **AWS Amplify Hosting** |
| API / Processor | AWS Lambda Node.js 24 + TypeScript |
| Infra | AWS CDK (TypeScript) |
| Data | DynamoDB single table, S3, SQS, Textract |

## Estructura

```txt
apps/web         Astro UI
apps/api         Lambda HTTP API
apps/processor   Lambda OCR worker
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

Outputs útiles: `ApiUrl`, `AmplifyAppId`, `AmplifyUrl`.

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

| Method | Path |
|--------|------|
| `GET` | `/health` |
| `POST` | `/uploads/presign` |
| `GET` | `/documents` |
| `GET` | `/documents/{id}` |
| `GET` | `/documents/{id}/preview-url` |
| `GET` | `/stats/summary` |

Formatos de imagen: `image/jpeg`, `image/png` (Textract no soporta WebP).
