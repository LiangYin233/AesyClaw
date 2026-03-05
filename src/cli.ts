import { Command } from 'commander';
import { bootstrap } from './bootstrap/index.js';

const program = new Command();

program
  .name('aesyclaw')
  .description('A lightweight AI agent framework')
  .version('0.1.0');

program
  .command('gateway')
  .option('-p, --port <port>', 'API Port', '18792')
  .action(async (options) => {
    await bootstrap(parseInt(options.port));
  });

program.parse();
