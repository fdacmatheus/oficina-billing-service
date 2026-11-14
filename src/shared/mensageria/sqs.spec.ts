import { SQSClient } from '@aws-sdk/client-sqs';
import { configFake } from '../../test-utils/fakes';
import { sqsClientProvider } from './sqs';

describe('sqsClientProvider', () => {
  it('cria o client na região configurada (padrão us-east-1)', async () => {
    const padrao = sqsClientProvider.useFactory(configFake());
    expect(padrao).toBeInstanceOf(SQSClient);
    expect(await padrao.config.region()).toBe('us-east-1');
    const outro = sqsClientProvider.useFactory(configFake({ AWS_REGION: 'sa-east-1' }));
    expect(await outro.config.region()).toBe('sa-east-1');
  });
});
