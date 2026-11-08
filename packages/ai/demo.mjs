// Testa a interpretação de um post com a IA real.
// Uso: ANTHROPIC_API_KEY=... node packages/ai/demo.mjs "texto do post" ["Nome do autor"] ["Título do autor"]
import { ClaudePostInterpreter } from './dist/index.js';

const [text, name = 'Autor', headline] = process.argv.slice(2);
if (!text) {
  console.error('Uso: node packages/ai/demo.mjs "texto do post" ["Nome"] ["Título"]');
  process.exit(1);
}
const ai = new ClaudePostInterpreter();
const r = await ai.interpret({ url: 'demo', text, hasMedia: false }, { id: 'demo', firstName: name, headline }, { tone: 'profissional' });
console.log(JSON.stringify(r, null, 2));
