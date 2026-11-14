import { Global, Module } from '@nestjs/common';
import { OutboxPublicador } from './outbox.publicador';
import { sqsClientProvider, SQS_CLIENT } from './sqs';

@Global()
@Module({
  providers: [sqsClientProvider, OutboxPublicador],
  exports: [SQS_CLIENT],
})
export class MensageriaModule {}
