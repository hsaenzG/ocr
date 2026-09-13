import * as path from "node:path";
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as amplify from "@aws-cdk/aws-amplify-alpha";
import * as codebuild from "aws-cdk-lib/aws-codebuild";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction, OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3n from "aws-cdk-lib/aws-s3-notifications";
import * as sns from "aws-cdk-lib/aws-sns";
import * as snsSubscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { SqsEventSource, DynamoEventSource } from "aws-cdk-lib/aws-lambda-event-sources";

export class OcrStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const uploadPrefix = "uploads/";
    const maxUploadBytes = "10485760";
    const maxPdfUploadBytes = "52428800";

    const docsBucket = new s3.Bucket(this, "DocsBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: false,
      cors: [
        {
          allowedMethods: [
            s3.HttpMethods.PUT,
            s3.HttpMethods.GET,
            s3.HttpMethods.HEAD,
          ],
          allowedOrigins: ["*"],
          allowedHeaders: ["*"],
          exposedHeaders: ["ETag"],
          maxAge: 3000,
        },
      ],
      lifecycleRules: [
        {
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(1),
        },
      ],
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const table = new dynamodb.Table(this, "OcrTable", {
      tableName: undefined,
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      stream: dynamodb.StreamViewType.NEW_IMAGE,
      timeToLiveAttribute: "expiresAt",
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const processingDlq = new sqs.Queue(this, "ProcessingDlq", {
      retentionPeriod: cdk.Duration.days(14),
    });

    const processingQueue = new sqs.Queue(this, "ProcessingQueue", {
      visibilityTimeout: cdk.Duration.seconds(360),
      retentionPeriod: cdk.Duration.days(4),
      deadLetterQueue: {
        queue: processingDlq,
        maxReceiveCount: 3,
      },
    });

    docsBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.SqsDestination(processingQueue),
      { prefix: uploadPrefix },
    );

    // --- Async Textract channel (multipage PDF) ---
    const textractTopic = new sns.Topic(this, "TextractCompletionTopic", {
      displayName: "Textract async job completion",
    });

    const textractPublishRole = new iam.Role(this, "TextractPublishRole", {
      assumedBy: new iam.ServicePrincipal("textract.amazonaws.com"),
      description: "Lets Textract publish async job completion to SNS",
    });
    textractTopic.grantPublish(textractPublishRole);

    const textractResultsDlq = new sqs.Queue(this, "TextractResultsDlq", {
      retentionPeriod: cdk.Duration.days(14),
    });

    const textractResultsQueue = new sqs.Queue(this, "TextractResultsQueue", {
      visibilityTimeout: cdk.Duration.seconds(360),
      retentionPeriod: cdk.Duration.days(4),
      deadLetterQueue: {
        queue: textractResultsDlq,
        maxReceiveCount: 3,
      },
    });

    textractTopic.addSubscription(
      new snsSubscriptions.SqsSubscription(textractResultsQueue),
    );

    const authUsername =
      (this.node.tryGetContext("authUsername") as string | undefined) ?? "natalia";
    const authPasswordFromContext = this.node.tryGetContext("authPassword") as
      | string
      | undefined;

    // Single-user auth. Prefer Secrets Manager; password can be provided via
    // `-c authPassword=...` or auto-generated on first deploy.
    const authSecret = authPasswordFromContext
      ? new secretsmanager.Secret(this, "OcrAuthSecret", {
          description: "OCR single-user credentials (username/password)",
          secretObjectValue: {
            username: cdk.SecretValue.unsafePlainText(authUsername),
            password: cdk.SecretValue.unsafePlainText(authPasswordFromContext),
          },
        })
      : new secretsmanager.Secret(this, "OcrAuthSecret", {
          description: "OCR single-user credentials (username + generated password)",
          generateSecretString: {
            secretStringTemplate: JSON.stringify({ username: authUsername }),
            generateStringKey: "password",
            excludeCharacters: " %+~`#$&*()|[]{}:;<>?!'/@\"\\",
            passwordLength: 32,
          },
        });

    const apiFn = new NodejsFunction(this, "ApiFunction", {
      entry: path.join(__dirname, "../../apps/api/src/handler.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_24_X,
      timeout: cdk.Duration.seconds(15),
      memorySize: 256,
      projectRoot: path.join(__dirname, "../.."),
      depsLockFilePath: path.join(__dirname, "../../package-lock.json"),
      bundling: {
        minify: true,
        sourceMap: true,
        target: "node24",
        format: OutputFormat.ESM,
        banner:
          "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
        mainFields: ["module", "main"],
      },
      environment: {
        TABLE_NAME: table.tableName,
        DOCS_BUCKET_NAME: docsBucket.bucketName,
        UPLOAD_PREFIX: uploadPrefix,
        MAX_UPLOAD_BYTES: maxUploadBytes,
        MAX_PDF_UPLOAD_BYTES: maxPdfUploadBytes,
        AUTH_SECRET_ARN: authSecret.secretArn,
      },
    });

    table.grantReadWriteData(apiFn);
    docsBucket.grantPut(apiFn, `${uploadPrefix}*`);
    docsBucket.grantRead(apiFn);
    authSecret.grantRead(apiFn);

    const processorFn = new NodejsFunction(this, "ProcessorFunction", {
      entry: path.join(__dirname, "../../apps/processor/src/handler.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_24_X,
      timeout: cdk.Duration.seconds(60),
      memorySize: 1024,
      projectRoot: path.join(__dirname, "../.."),
      depsLockFilePath: path.join(__dirname, "../../package-lock.json"),
      bundling: {
        minify: true,
        sourceMap: true,
        target: "node24",
        format: OutputFormat.ESM,
        banner:
          "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
        mainFields: ["module", "main"],
      },
      environment: {
        TABLE_NAME: table.tableName,
        TEXTRACT_TOPIC_ARN: textractTopic.topicArn,
        TEXTRACT_PUBLISH_ROLE_ARN: textractPublishRole.roleArn,
      },
    });

    table.grantReadWriteData(processorFn);
    docsBucket.grantRead(processorFn);
    processorFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "textract:DetectDocumentText",
          "textract:StartDocumentTextDetection",
        ],
        resources: ["*"],
      }),
    );
    processorFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["iam:PassRole"],
        resources: [textractPublishRole.roleArn],
        conditions: {
          StringEquals: { "iam:PassedToService": "textract.amazonaws.com" },
        },
      }),
    );
    processorFn.addEventSource(
      new SqsEventSource(processingQueue, {
        batchSize: 1,
        reportBatchItemFailures: true,
      }),
    );

    const textractResultFn = new NodejsFunction(this, "TextractResultFunction", {
      entry: path.join(
        __dirname,
        "../../apps/processor/src/textractResultHandler.ts",
      ),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_24_X,
      timeout: cdk.Duration.seconds(120),
      memorySize: 1024,
      projectRoot: path.join(__dirname, "../.."),
      depsLockFilePath: path.join(__dirname, "../../package-lock.json"),
      bundling: {
        minify: true,
        sourceMap: true,
        target: "node24",
        format: OutputFormat.ESM,
        banner:
          "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
        mainFields: ["module", "main"],
      },
      environment: {
        TABLE_NAME: table.tableName,
        TEXTRACT_TOPIC_ARN: textractTopic.topicArn,
        TEXTRACT_PUBLISH_ROLE_ARN: textractPublishRole.roleArn,
      },
    });

    table.grantReadWriteData(textractResultFn);
    textractResultFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["textract:GetDocumentTextDetection"],
        resources: ["*"],
      }),
    );
    textractResultFn.addEventSource(
      new SqsEventSource(textractResultsQueue, {
        batchSize: 1,
        reportBatchItemFailures: true,
      }),
    );

    const analyticsStreamFn = new NodejsFunction(this, "AnalyticsStreamFunction", {
      entry: path.join(
        __dirname,
        "../../apps/processor/src/analyticsStreamHandler.ts",
      ),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_24_X,
      timeout: cdk.Duration.seconds(120),
      memorySize: 512,
      projectRoot: path.join(__dirname, "../.."),
      depsLockFilePath: path.join(__dirname, "../../package-lock.json"),
      bundling: {
        minify: true,
        sourceMap: true,
        target: "node24",
        format: OutputFormat.ESM,
        banner:
          "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
        mainFields: ["module", "main"],
      },
      environment: {
        TABLE_NAME: table.tableName,
        ANALYTICS_PARSER: "bedrock",
        BEDROCK_MODEL_ID: "amazon.nova-lite-v1:0",
      },
    });

    table.grantReadWriteData(analyticsStreamFn);
    analyticsStreamFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
        resources: ["*"],
      }),
    );
    analyticsStreamFn.addEventSource(
      new DynamoEventSource(table, {
        startingPosition: lambda.StartingPosition.LATEST,
        batchSize: 1,
        retryAttempts: 3,
        reportBatchItemFailures: true,
      }),
    );

    const httpApi = new apigwv2.HttpApi(this, "OcrHttpApi", {
      apiName: "ocr-api",
      description: "OCR API — presign, documents, stats, analytics",
      corsPreflight: {
        allowHeaders: ["content-type", "authorization"],
        allowMethods: [
          apigwv2.CorsHttpMethod.GET,
          apigwv2.CorsHttpMethod.POST,
          apigwv2.CorsHttpMethod.PUT,
          apigwv2.CorsHttpMethod.OPTIONS,
        ],
        allowOrigins: ["*"],
        maxAge: cdk.Duration.days(1),
      },
    });

    const integration = new HttpLambdaIntegration("ApiIntegration", apiFn);

    httpApi.addRoutes({
      path: "/{proxy+}",
      methods: [apigwv2.HttpMethod.ANY],
      integration,
    });
    httpApi.addRoutes({
      path: "/",
      methods: [apigwv2.HttpMethod.ANY],
      integration,
    });

    // --- Amplify Hosting (Astro static) ---
    const githubOwner = this.node.tryGetContext("githubOwner") as
      | string
      | undefined;
    const githubRepo = this.node.tryGetContext("githubRepo") as
      | string
      | undefined;
    const githubTokenSecretName = this.node.tryGetContext(
      "githubTokenSecretName",
    ) as string | undefined;
    const amplifyBranchName =
      (this.node.tryGetContext("amplifyBranch") as string | undefined) ?? "main";

    const amplifyBuildSpec = codebuild.BuildSpec.fromObjectToYaml({
      version: 1,
      frontend: {
        phases: {
          preBuild: {
            commands: [
              "nvm install 22",
              "nvm use 22",
              "npm ci",
              "npm run build -w @ocr/shared",
            ],
          },
          build: {
            commands: [
              'echo "PUBLIC_API_BASE_URL=$PUBLIC_API_BASE_URL"',
              "npm run build -w @ocr/web",
            ],
          },
        },
        artifacts: {
          baseDirectory: "apps/web/dist",
          files: ["**/*"],
        },
        cache: {
          paths: ["node_modules/**/*"],
        },
      },
    });

    const amplifyApp = new amplify.App(this, "OcrWebAmplify", {
      appName: "ocr-web",
      description: "OCR Astro frontend (static)",
      platform: amplify.Platform.WEB,
      buildSpec: amplifyBuildSpec,
      environmentVariables: {
        PUBLIC_API_BASE_URL: httpApi.apiEndpoint,
        _LIVE_UPDATES: JSON.stringify([
          {
            name: "Node.js version",
            pkg: "node",
            type: "nvm",
            version: "22",
          },
        ]),
      },
      ...(githubOwner && githubRepo && githubTokenSecretName
        ? {
            sourceCodeProvider: new amplify.GitHubSourceCodeProvider({
              owner: githubOwner,
              repository: githubRepo,
              oauthToken: cdk.SecretValue.secretsManager(githubTokenSecretName),
            }),
          }
        : {}),
    });

    const amplifyBranch = amplifyApp.addBranch(amplifyBranchName, {
      autoBuild: Boolean(githubOwner && githubRepo && githubTokenSecretName),
      stage: "PRODUCTION",
    });

    const amplifyDefaultUrl = `https://${amplifyBranch.branchName}.${amplifyApp.appId}.amplifyapp.com`;

    new cdk.CfnOutput(this, "ApiUrl", {
      value: httpApi.apiEndpoint,
      description: "HTTP API base URL (set as PUBLIC_API_BASE_URL for Astro)",
    });
    new cdk.CfnOutput(this, "AuthSecretArn", {
      value: authSecret.secretArn,
      description: "Secrets Manager ARN with { username, password }",
    });
    new cdk.CfnOutput(this, "AuthUsername", {
      value: authUsername,
      description: "Single-user login username",
    });
    new cdk.CfnOutput(this, "DocsBucketName", {
      value: docsBucket.bucketName,
    });
    new cdk.CfnOutput(this, "TableName", {
      value: table.tableName,
    });
    new cdk.CfnOutput(this, "ProcessingQueueUrl", {
      value: processingQueue.queueUrl,
    });
    new cdk.CfnOutput(this, "AmplifyAppId", {
      value: amplifyApp.appId,
      description: "Amplify app id for hosting the Astro site",
    });
    new cdk.CfnOutput(this, "AmplifyDefaultDomain", {
      value: amplifyApp.defaultDomain,
    });
    new cdk.CfnOutput(this, "AmplifyUrl", {
      value: amplifyDefaultUrl,
      description: "Frontend URL (after first successful Amplify deploy)",
    });
    new cdk.CfnOutput(this, "AmplifyBranch", {
      value: amplifyBranch.branchName,
    });
  }
}
