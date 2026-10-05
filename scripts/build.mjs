import { cp, mkdir, rm } from 'node:fs/promises';
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
for (const file of ['index.html', 'app.js', 'style.css', 'favicon.svg']) await cp(`public/${file}`, `dist/${file}`);
console.log('Production frontend built in dist/.');
