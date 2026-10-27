import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const [game, directory] = process.argv.slice(2);
const games = new Set(['chess', 'checkers', 'backgammon', 'solitaire', 'sudoku']);
if (!games.has(game) || !directory) {
  throw new Error('Usage: node fix-metadata.mjs <game> <build-directory>');
}

for (const file of ['index.html', 'robots.txt', 'sitemap.xml']) {
  const path = join(directory, file);
  if (!existsSync(path)) continue;
  const original = readFileSync(path, 'utf8');
  const updated = original.replaceAll(
    `https://${game}.puter.com/`,
    `https://games.rediff.com/${game}/`,
  );
  if (updated !== original) writeFileSync(path, updated);
}
