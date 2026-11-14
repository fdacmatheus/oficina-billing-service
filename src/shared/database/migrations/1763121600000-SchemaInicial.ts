import { MigrationInterface, QueryRunner } from 'typeorm';

export class SchemaInicial1763121600000 implements MigrationInterface {
  name = 'SchemaInicial1763121600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Datas em bigint (Unix epoch em ms), conforme o contrato da Fase 4.
    await queryRunner.query(`
      CREATE TABLE orcamentos (
        id uuid PRIMARY KEY,
        os_id varchar(64) NOT NULL UNIQUE,
        os_numero varchar(64) NOT NULL,
        cliente jsonb NOT NULL,
        itens jsonb NOT NULL,
        valor_total numeric(12,2) NOT NULL,
        status varchar(20) NOT NULL,
        token_aprovacao varchar(64) NOT NULL,
        criado_em bigint NOT NULL,
        atualizado_em bigint NOT NULL
      )`);
    await queryRunner.query(`
      CREATE TABLE pagamentos (
        id uuid PRIMARY KEY,
        orcamento_id uuid NOT NULL UNIQUE REFERENCES orcamentos(id),
        os_id varchar(64) NOT NULL,
        valor numeric(12,2) NOT NULL,
        status varchar(20) NOT NULL,
        gateway_id varchar(64),
        motivo_recusa varchar(255),
        criado_em bigint NOT NULL,
        atualizado_em bigint NOT NULL
      )`);
    await queryRunner.query('CREATE INDEX idx_pagamentos_gateway_id ON pagamentos (gateway_id)');
    await queryRunner.query('CREATE INDEX idx_pagamentos_os_id ON pagamentos (os_id)');
    await queryRunner.query(`
      CREATE TABLE outbox (
        id uuid PRIMARY KEY,
        tipo varchar(64) NOT NULL,
        fila_destino varchar(255) NOT NULL,
        corpo jsonb NOT NULL,
        correlation_id varchar(64) NOT NULL,
        criada_em bigint NOT NULL,
        publicada_em bigint
      )`);
    // Indice parcial: o publicador so varre o que ainda nao saiu.
    await queryRunner.query(
      'CREATE INDEX idx_outbox_pendentes ON outbox (criada_em) WHERE publicada_em IS NULL',
    );
    await queryRunner.query(`
      CREATE TABLE mensagens_processadas (
        message_id varchar(64) PRIMARY KEY,
        tipo varchar(64) NOT NULL,
        processada_em bigint NOT NULL
      )`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE mensagens_processadas');
    await queryRunner.query('DROP TABLE outbox');
    await queryRunner.query('DROP TABLE pagamentos');
    await queryRunner.query('DROP TABLE orcamentos');
  }
}
