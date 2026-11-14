describe('AppDataSource (CLI de migrations)', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
    jest.resetModules();
  });

  const carregar = () =>
    jest.requireActual<typeof import('./data-source')>('./data-source').AppDataSource.options;

  it('usa o Postgres local do billing por padrão, sem synchronize nem TLS', () => {
    for (const k of ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME', 'DB_SSL'])
      delete process.env[k];
    jest.isolateModules(() => {
      expect(carregar()).toMatchObject({
        type: 'postgres',
        host: 'localhost',
        port: 5434,
        username: 'billing',
        database: 'billing',
        synchronize: false,
        ssl: false,
      });
    });
  });

  it('lê o ambiente e liga TLS para o RDS', () => {
    Object.assign(process.env, {
      DB_HOST: 'rds',
      DB_PORT: '5432',
      DB_USER: 'u',
      DB_PASSWORD: 'p',
      DB_NAME: 'n',
      DB_SSL: 'true',
    });
    jest.isolateModules(() => {
      expect(carregar()).toMatchObject({
        host: 'rds',
        port: 5432,
        username: 'u',
        password: 'p',
        database: 'n',
        ssl: { rejectUnauthorized: false },
      });
    });
  });
});
