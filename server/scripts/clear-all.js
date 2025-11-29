#!/usr/bin/env node
import { Queue } from 'bullmq';
import { promises as fs } from 'fs';
import path from 'path';

const REDIS_URL = process.env.REDIS_URL || process.env.REDI_URL;
const CACHE_DIR = process.env.PARSE_CACHE_DIR || path.join(process.cwd(), 'server/.parse-cache');

async function clearAll() {
  console.log('🧹 Iniciando limpeza completa...\n');

  // 1. Limpar Redis (BullMQ)
  console.log('1️⃣ Limpando jobs do Redis...');
  try {
    const parseQueue = new Queue('playlist-parse', {
      connection: {
        url: REDIS_URL,
      },
    });

    // Limpa todos os jobs em todos os estados
    await parseQueue.obliterate({ force: true });
    console.log('   ✅ Todos os jobs removidos do Redis');

    await parseQueue.close();
  } catch (error) {
    console.error('   ❌ Erro ao limpar Redis:', error.message);
  }

  // 2. Limpar cache do disco
  console.log('\n2️⃣ Limpando cache do disco...');
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    const files = await fs.readdir(CACHE_DIR);

    let removed = 0;
    for (const file of files) {
      if (file.endsWith('.ndjson') || file.endsWith('.meta.json') || file.endsWith('.idx')) {
        await fs.rm(path.join(CACHE_DIR, file), { force: true });
        removed++;
      }
    }

    console.log(`   ✅ ${removed} arquivos removidos de ${CACHE_DIR}`);
  } catch (error) {
    console.error('   ❌ Erro ao limpar cache:', error.message);
  }

  console.log('\n✨ Limpeza completa!');
  process.exit(0);
}

clearAll().catch(err => {
  console.error('💥 Erro fatal:', err);
  process.exit(1);
});
