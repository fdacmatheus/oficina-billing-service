import type { ValueTransformer } from 'typeorm';

/** O driver pg devolve bigint como string; o dominio trabalha com epoch em ms (number). */
export const epochMs: ValueTransformer = {
  to: (valor?: number | null) => valor,
  from: (valor?: string | null) => (valor == null ? valor : Number(valor)),
};
