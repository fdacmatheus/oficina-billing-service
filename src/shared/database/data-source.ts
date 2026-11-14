import { config as loadEnv } from 'dotenv';
import { DataSource } from 'typeorm';

loadEnv({ path: '.env', quiet: true });

/** Usado pela CLI do TypeORM (pnpm migration:run). A aplicacao roda as migrations no startup. */
export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5434),
  username: process.env.DB_USER ?? 'billing',
  password: process.env.DB_PASSWORD ?? 'billing',
  database: process.env.DB_NAME ?? 'billing',
  entities: ['src/**/*.orm-entity.ts'],
  migrations: ['src/shared/database/migrations/*.ts'],
  synchronize: false,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});
