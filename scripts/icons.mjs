// Builds docs/assets/icons.svg: a symbol sprite from Lucide (ISC), drawn thin. Run: node scripts/icons.mjs
import { readFileSync, writeFileSync } from 'node:fs';
const names = ['pencil', 'plus', 'trash-2', 'undo-2', 'rotate-ccw', 'x', 'check', 'users', 'arrow-left-right', 'route', 'map', 'refresh-cw', 'info', 'download', 'user-plus', 'settings-2', 'map-pin', 'arrow-right', 'calendar-plus', 'external-link', 'list', 'share-2', 'search', 'chevron-down', 'globe', 'minus', 'maximize', 'book-open'];
const out = names.map(n => {
  const s = readFileSync(`node_modules/lucide-static/icons/${n}.svg`, 'utf8');
  const inner = s.slice(s.indexOf('>', s.indexOf('<svg')) + 1, s.lastIndexOf('</svg>')).replace(/\s+/g, ' ').trim();
  return `<symbol id="i-${n}" viewBox="0 0 24 24">${inner}</symbol>`;
}).join('');
writeFileSync('docs/assets/icons.svg', `<svg xmlns="http://www.w3.org/2000/svg"><!-- Lucide icons, ISC licence, https://lucide.dev -->${out}</svg>`);
console.log('icons:', names.length);
