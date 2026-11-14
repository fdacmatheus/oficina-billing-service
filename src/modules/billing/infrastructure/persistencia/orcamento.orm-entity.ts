import { Column, Entity, PrimaryColumn } from 'typeorm';
import { epochMs } from '../../../../shared/database/epoch-ms.transformer';
import type { ClienteSnapshot, ItemOrcamento } from '../../domain/orcamento.entity';

@Entity({ name: 'orcamentos' })
export class OrcamentoOrmEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64, name: 'os_id', unique: true })
  osId!: string;

  @Column({ type: 'varchar', length: 64, name: 'os_numero' })
  osNumero!: string;

  @Column({ type: 'jsonb' })
  cliente!: ClienteSnapshot;

  @Column({ type: 'jsonb' })
  itens!: ItemOrcamento[];

  @Column({ type: 'numeric', precision: 12, scale: 2, name: 'valor_total' })
  valorTotal!: string;

  @Column({ type: 'varchar', length: 20 })
  status!: string;

  @Column({ type: 'varchar', length: 64, name: 'token_aprovacao' })
  tokenAprovacao!: string;

  @Column({ type: 'bigint', name: 'criado_em', transformer: epochMs })
  criadoEm!: number;

  @Column({ type: 'bigint', name: 'atualizado_em', transformer: epochMs })
  atualizadoEm!: number;
}
