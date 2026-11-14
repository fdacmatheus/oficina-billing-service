import { contextoRequisicao } from './correlacao.middleware';
import { LoggerService } from './logger.service';

describe('LoggerService', () => {
  const formato = process.env.LOG_FORMAT;
  let log: jest.SpyInstance;
  let erro: jest.SpyInstance;

  beforeEach(() => {
    log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    erro = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.env.LOG_FORMAT = formato;
    jest.restoreAllMocks();
  });

  it('em JSON inclui servico e correlationId', () => {
    process.env.LOG_FORMAT = 'json';
    const logger = new LoggerService();
    contextoRequisicao.run({ correlationId: 'os-1' }, () => {
      logger.log('ola', 'Teste');
      logger.warn({ a: 1 });
      logger.debug('d');
      logger.verbose('v');
      logger.error('falhou', 'stack', 'Teste');
    });
    const linha = JSON.parse(log.mock.calls[0][0]);
    expect(linha).toMatchObject({
      nivel: 'info',
      servico: 'oficina-billing-service',
      contexto: 'Teste',
      correlationId: 'os-1',
      mensagem: 'ola',
    });
    expect(typeof linha.timestamp).toBe('number');
    expect(JSON.parse(log.mock.calls[1][0]).mensagem).toBe('{"a":1}');
    expect(JSON.parse(erro.mock.calls[0][0])).toMatchObject({ nivel: 'error', detalhe: 'stack' });
  });

  it('fora de JSON escreve texto legível', () => {
    process.env.LOG_FORMAT = 'texto';
    const logger = new LoggerService();
    logger.log('sem contexto');
    contextoRequisicao.run({ correlationId: 'c' }, () => logger.log('com', 'Ctx'));
    logger.error('falhou', 'pilha');
    logger.error('sem pilha');
    expect(log.mock.calls[0][0]).toBe('INFO sem contexto');
    expect(log.mock.calls[1][0]).toBe('INFO [Ctx] com (c)');
    expect(erro.mock.calls[0][0]).toBe('ERROR falhou\npilha');
    expect(erro.mock.calls[1][0]).toBe('ERROR sem pilha');
  });
});
