// AI Office server entry point.
import { createApp, defaultWebDir, readVersion } from './app';
import { ConfigError, loadConfig } from './config';
import { createLogger } from './log';

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig(process.env, process.argv.slice(2), defaultWebDir());
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`${error.message}\n`);
      process.exit(2);
    }
    throw error;
  }
  const log = createLogger(config.logLevel);
  const app = createApp(config, log, { version: await readVersion(), envDir: process.env.CLAUDE_CONFIG_DIR });
  let stopping = false;
  const shutdown = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    log.debug(`Encerrando (${signal})`);
    app.stop().then(
      () => process.exit(0),
      (error: unknown) => {
        log.error('Falha ao encerrar', error);
        process.exit(1);
      },
    );
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  try {
    await app.start();
  } catch (error) {
    log.error(
      error instanceof Error ? error.message : 'Falha ao iniciar o servidor',
      error instanceof Error ? undefined : error,
    );
    process.exit(1);
  }
}

void main();
