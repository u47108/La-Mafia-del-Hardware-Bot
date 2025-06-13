// Cargar las variables de entorno desde el archivo .env
require('dotenv').config();

const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');
const app = express();

// Crear cliente de Discord
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, 
    GatewayIntentBits.GuildMessages, 
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

// Definición de los canales a moderar usando un objeto
const CHANNEL_IDS = process.env.CHANNEL_IDS.split(',');
//const CHANNEL_IDS = {
//  general: '1382935501862076507',  // Reemplaza con el ID de tu canal general
//  hardware: '1382370290708910091',      // Reemplaza con el ID de tu canal hardware
//  memes: '1382946630679920720'       // Reemplaza con el ID de tu canal memes
//};

// Mensajes de advertencia para spam, anuncios y scam
const mafiaWarnMessages = [
  "Oye, capo, sin anuncios acá. No queremos problemas.",
  "¿Quieres anunciar? Ve al foro ayuda, capo.",
  "¡Cuidado con los enlaces dudosos, amiguito!"
];

// Mapa para almacenar mensajes recientes y evitar el spam
let lastMessages = new Map();

// Cuando el bot se conecta correctamente
client.on('ready', () => {
  console.log(`El bot mafioso está listo y monitoreando los canales.`);
});

// Evento cuando se recibe un mensaje en cualquier canal
client.on('messageCreate', message => {
  if (message.author.bot) return;  // Ignorar mensajes de otros bots


  // Verificar si el mensaje está en uno de los canales que estamos moderando
  if (!CHANNEL_IDS.includes(message.channel.id)) {
    return;
  }

  // Regex para detectar URLs
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const scamKeywords = ["steamcommunity", "steamtrade", "freegame", "giveaway"];
  const urls = message.content.match(urlRegex);

  // Moderación de enlaces sospechosos (spam, anuncios, scam)
  if (urls) {
    if (urls.some(url => scamKeywords.some(kw => url.toLowerCase().includes(kw)))) {
      message.delete();
      message.channel.send(`${message.author}, ${mafiaWarnMessages[2]}`);
      return;
    }
    if (urls.some(url => url.toLowerCase().includes("discord.gg"))) {
      message.delete();
      message.channel.send(`${message.author}, ${mafiaWarnMessages[0]}`);
      return;
    }
  }

  // Moderación de spam (repetición de mensajes)
  const last = lastMessages.get(message.author.id);
  if (last && last.text === message.content && (Date.now() - last.time) < 5000) {
    message.delete();
    message.channel.send(`${message.author}, tranquilo con tanto mensaje repetido, capo.`);
  } else {
    lastMessages.set(message.author.id, { text: message.content, time: Date.now() });
  }
});

// Para mantener el bot "vivo" en Replit
app.get('/', (req, res) => {
  res.send('La Mafia del Hardware está activa 💼🔫');
});

// Escuchar en el puerto adecuado
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor web activo en puerto ${PORT}`));

// Iniciar sesión del bot con el token de la variable de entorno
client.login(process.env.TOKEN);
