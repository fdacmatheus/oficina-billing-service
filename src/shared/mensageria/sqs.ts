import { SQSClient } from '@aws-sdk/client-sqs';
import { ConfigService } from '@nestjs/config';

export const SQS_CLIENT = Symbol('SQS_CLIENT');

/** O SDK v3 le AWS_ENDPOINT_URL e as credenciais do ambiente (Floci no local, IAM na AWS). */
export const sqsClientProvider = {
  provide: SQS_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService) =>
    new SQSClient({ region: config.get<string>('AWS_REGION', 'us-east-1') }),
};
