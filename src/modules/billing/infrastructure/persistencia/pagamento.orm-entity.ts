import { Column, Entity, PrimaryColumn } from 'typeorm';
import { epochMs } from '../../../../shared/database/epoch-ms.transformer';

@Entity({ name: 'pagamentos' })
export class PagamentoOrmEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'orcamento_id', unique: true })
  orcamentoId!: string;

  @Column({ type: 'varchar', length: 64, name: 'os_id' })
  osId!: string;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  valor!: string;

  @Column({ type: 'varchar', length: 20 })
  status!: string;

  @Column({ type: 'varchar', length: 64, name: 'gateway_id', nullable: true })
  gatewayId!: string | null;

  @Column({ type: 'varchar', length: 255, name: 'motivo_recusa', nullable: true })
  motivoRecusa!: string | null;

  @Column({ type: 'bigint', name: 'criado_em', transformer: epochMs })
  criadoEm!: number;

  @Column({ type: 'bigint', name: 'atualizado_em', transformer: epochMs })
  atualizadoEm!: number;
}
