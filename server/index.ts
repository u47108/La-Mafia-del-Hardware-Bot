import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { DiscordBot } from './discord-bot.js';

const app = express();
const server = createServer(app);

// Middleware
app.use(express.json());
app.use(express.static('public'));

// WebSocket server para comunicación en tiempo real
const wss = new WebSocketServer({ server, path: '/ws' });

// Inicializar bot de Discord
const discordBot = new DiscordBot();
discordBot.setWebSocketServer(wss);

// Manejo de conexiones WebSocket
wss.on('connection', (ws) => {
  console.log('Cliente conectado al WebSocket');
  
  // Enviar estado inicial del bot
  ws.send(JSON.stringify({
    type: 'bot_status',
    data: discordBot.getStatus()
  }));

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message.toString());
      
      if (data.type === 'restart_bot') {
        await discordBot.restart();
      } else if (data.type === 'get_status') {
        ws.send(JSON.stringify({
          type: 'bot_status',
          data: discordBot.getStatus()
        }));
      }
    } catch (error) {
      console.error('Error en mensaje WebSocket:', error);
    }
  });

  ws.on('close', () => {
    console.log('Cliente desconectado del WebSocket');
  });
});

// Rutas API básicas
app.get('/api/status', (req, res) => {
  res.json(discordBot.getStatus());
});

app.post('/api/restart', async (req, res) => {
  try {
    await discordBot.restart();
    res.json({ success: true, message: 'Bot reiniciado exitosamente' });
  } catch (error) {
    res.status(500).json({ error: 'Error al reiniciar el bot' });
  }
});

// Iniciar servidor
const PORT = parseInt(process.env.PORT || '5000', 10);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor ejecutándose en puerto ${PORT}`);
  
  // Iniciar bot de Discord
  discordBot.start();
});

// Manejo de errores
process.on('unhandledRejection', (error) => {
  console.error('Unhandled promise rejection:', error);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  process.exit(1);
});