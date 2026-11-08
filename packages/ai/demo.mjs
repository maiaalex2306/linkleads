// Testa a interpretação de um post com a IA real.
// Uso: ANTHROPIC_API_KEY=... node packages/ai/demo.mjs "texto do post" ["Nome do autor"] ["Título do autor"]
//      AI_PROVIDER=openai OPENAI_API_KEY=... node packages/ai/demo.mjs "..."   (AI_MODEL troca o modelo)
import { createInterpreter } from './dist/index.js';

const [text, name = 'Autor', headline] = process.argv.slice(2);
if (!text) {
  console.error('Uso: node packages/ai/demo.mjs "texto do post" ["Nome"] ["Título"]');
  process.exit(1);
}
const ai = createInterpreter({ provider: process.env.AI_PROVIDER === 'openai' ? 'openai' : 'anthropic', model: process.env.AI_MODEL });
const r = await ai.interpret({ url: 'demo', text, hasMedia: false }, { id: 'demo', firstName: name, headline }, { tone: 'profissional' });
console.log(JSON.stringify(r, null, 2));
