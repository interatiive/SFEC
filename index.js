const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

// Configurações para o SFEC
const EVOLUTION_API_URL = 'https://api.evolution-api.com'; // Ajuste se necessário
const INSTANCE = 'sfec-instancia'; // Instância específica do SFEC
const API_KEY = 'chave-api-sfec'; // Substitua pela chave real do SFEC

app.post('/send-audio', async (req, res) => {
  const { number, audioUrl } = req.body;

  try {
    const response = await axios.post(
      `${EVOLUTION_API_URL}/message/sendMedia/${INSTANCE}`,
      {
        number: `55${number}`, // Prefixo 55 para Brasil, ajuste se necessário
        mediaMessage: {
          mediaType: 'audio',
          media: audioUrl,
        },
      },
      { headers: { apikey: API_KEY } }
    );

    res.status(200).json({ message: 'Áudio enviado com sucesso pelo SFEC!' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao enviar áudio' });
  }
});

app.listen(3001, () => console.log('Servidor do SFEC rodando na porta 3001'));
