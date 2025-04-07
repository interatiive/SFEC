const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const fetch = require('node-fetch');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Configurações
const KEEP_ALIVE_INTERVAL = 14 * 60 * 1000; // 14 minutos
const FETCH_TIMEOUT = 10_000; // 10 segundos

// Middleware pra parsear JSON em rotas que não sejam /send
app.use((req, res, next) => {
  if (req.path === '/send' && req.method === 'POST') {
    // Para a rota /send, vamos ler o corpo como texto bruto
    return next();
  }
  return express.json()(req, res, next);
});

// Função para limpar e corrigir JSON
const cleanAndParseJSON = (data) => {
  try {
    // Se já for um objeto, não precisa processar
    if (typeof data === 'object' && data !== null) {
      return data;
    }

    // Converter pra string, caso não seja
    let jsonString = typeof data === 'string' ? data : JSON.stringify(data);

    // Remover tudo antes do primeiro { e depois do último }
    const firstBrace = jsonString.indexOf('{');
    const lastBrace = jsonString.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1 || firstBrace > lastBrace) {
      throw new Error('JSON inválido: não contém chaves {}');
    }
    jsonString = jsonString.substring(firstBrace, lastBrace + 1);

    // Remover espaços desnecessários no início e fim
    jsonString = jsonString.trim();

    // Tentar corrigir aspas inválidas (ex.: ' por ")
    jsonString = jsonString.replace(/'/g, '"');

    // Parsear o JSON
    const parsed = JSON.parse(jsonString);

    // Garantir que as quebras de linha no campo "message" sejam preservadas
    if (parsed.message && typeof parsed.message === 'string') {
      parsed.message = parsed.message.replace(/\\n/g, '\n');
    }

    return parsed;
  } catch (error) {
    console.error('Erro ao limpar e parsear JSON:', error);
    throw new Error(`Falha ao processar JSON: ${error.message}`);
  }
};

// Rota para enviar mensagem (POST)
app.post('/send', async (req, res) => {
  // Ler o corpo da requisição como texto bruto
  let rawBody = '';
  req.setEncoding('utf8');
  req.on('data', chunk => {
    rawBody += chunk;
  });

  req.on('end', async () => {
    try {
      // Limpar e parsear o JSON
      const body = cleanAndParseJSON(rawBody);

      const { number, message } = body;

      // Validação de entrada
      if (!number || !message) {
        return res.status(400).json({ success: false, error: 'Número e mensagem são obrigatórios' });
      }

      // Limpar o número (remover +, espaços, traços, etc.)
      const cleanNumber = number.toString().replace(/[^0-9]/g, '');
      if (!cleanNumber || cleanNumber.length < 10) {
        return res.status(400).json({ success: false, error: 'Número de telefone inválido' });
      }

      console.log(`Requisição POST recebida na rota /send: { number: ${cleanNumber}, message: ${message} }`);
      try {
        await global.client.sendMessage(`${cleanNumber}@s.whatsapp.net`, { text: message, linkPreview: false }, { timeout: 60_000 });
        console.log(`Mensagem enviada com sucesso para: ${cleanNumber}`);
        res.json({ success: true, message: `Mensagem enviada pra ${cleanNumber}` });
      } catch (error) {
        console.error('Erro ao enviar mensagem:', error);
        if (error.message && error.message.includes('timed out')) {
          res.status(408).json({ success: false, error: 'Timeout ao enviar mensagem' });
        } else {
          res.status(500).json({ success: false, error: 'Erro ao enviar mensagem' });
        }
      }
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });
});

// Rota simples pra "ping"
app.get('/ping', (req, res) => {
  console.log('Ping recebido! Servidor está ativo.');
  res.send('Pong!');
});

// Função para conectar ao WhatsApp
const connectToWhatsApp = async (retryCount = 0) => {
  const authDir = path.join(__dirname, 'auth_info');
  const { state, saveCreds } = await useMultiFileAuthState(authDir);

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    defaultQueryTimeoutMs: 60_000,
  });

  // Evento para salvar credenciais
  sock.ev.on('creds.update', saveCreds);

  // Evento para monitorar mensagens recebidas
  sock.ev.on('messages.upsert', async ({ messages }) => {
    console.log('Nova mensagem recebida:', messages);
    // Não há mais lógica de "Dr. Eliah" ou armazenamento de remetentes
  });

  // Evento de atualização de conexão
  sock.ev.on('connection.update', (update) => {
    const { connection, qr, lastDisconnect } = update;
    if (qr) {
      const qrLink = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(qr)}`;
      console.log('QR Code (link):', qrLink);
    }
    if (connection === 'open') {
      console.log('Conectado ao WhatsApp com sucesso!');
      global.client = sock;
      retryCount = 0;
    }
    if (connection === 'close') {
      const reason = lastDisconnect?.error?.message || 'Motivo desconhecido';
      console.log(`Desconectado! Motivo: ${reason}. Reconectando...`);
      const delay = Math.min(5_000 * Math.pow(2, retryCount), 60_000);
      setTimeout(() => connectToWhatsApp(retryCount + 1), delay);
    }
  });
};

// Inicia o servidor
app.listen(port, '0.0.0.0', () => {
  console.log(`Servidor rodando na porta ${port}`);
});

// Conecta ao WhatsApp
connectToWhatsApp();

// Função para "pingar" a si mesmo a cada 14 minutos
let keepAliveFailures = 0;
const keepAlive = async () => {
  const url = 'https://sfec.onrender.com/ping';
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    const text = await response.text();
    console.log(`Keep-alive ping: ${text}`);
    keepAliveFailures = 0;
  } catch (error) {
    console.error('Erro ao fazer keep-alive ping:', error);
    keepAliveFailures++;
    if (keepAliveFailures >= 3) {
      console.error('Keep-alive falhou 3 vezes consecutivas. Verifique a conectividade.');
    }
  }
};

// Executa o ping a cada 14 minutos
setInterval(keepAlive, KEEP_ALIVE_INTERVAL);
