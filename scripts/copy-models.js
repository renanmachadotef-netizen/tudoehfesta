// A selfie e analisada no servidor (server/models): o site nao precisa mais de modelos de reconhecimento facial.
// Remove a pasta antiga para nao publicar arquivos sem uso.
import fs from 'node:fs';
import path from 'node:path';

fs.rmSync(path.resolve('web/public/models'), { recursive: true, force: true });
console.log('[modelos] reconhecimento facial roda no servidor; nada a copiar');
