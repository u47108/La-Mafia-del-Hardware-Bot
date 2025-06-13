import { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, Events, ActivityType } from 'discord.js';
import { WebSocketServer, WebSocket } from 'ws';

export class DiscordBot {
  private client: Client;
  private rest: REST | null = null;
  private isReady = false;
  private wsServer: WebSocketServer | null = null;
  private startTime = Date.now();

  constructor() {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });

    const token = process.env.DISCORD_BOT_TOKEN;
    if (!token) {
      console.warn('⚠️ DISCORD_BOT_TOKEN no encontrado en variables de entorno');
      return;
    }

    this.rest = new REST({ version: '10' }).setToken(token);
    this.setupEventHandlers();
    this.registerCommands();
  }

  setWebSocketServer(wss: WebSocketServer) {
    this.wsServer = wss;
  }

  private broadcastToClients(data: any) {
    if (!this.wsServer) return;

    this.wsServer.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(data));
      }
    });
  }

  private setupEventHandlers() {
    this.client.once(Events.ClientReady, async (readyClient) => {
      console.log(`🤖 La Mafia del Hardware Bot está listo! Conectado como ${readyClient.user.tag}`);
      this.isReady = true;
      
      // Establecer estado del bot
      this.client.user?.setActivity('La Mafia del Hardware', { type: ActivityType.Watching });
      
      this.broadcastToClients({
        type: 'bot_status',
        data: { status: 'online', ready: true, tag: readyClient.user.tag }
      });
    });

    this.client.on(Events.GuildCreate, async (guild) => {
      console.log(`📥 Bot se unió al servidor: ${guild.name} (${guild.memberCount} miembros)`);
      
      this.broadcastToClients({
        type: 'server_joined',
        data: { 
          serverId: guild.id, 
          serverName: guild.name, 
          memberCount: guild.memberCount 
        }
      });
    });

    this.client.on(Events.GuildDelete, async (guild) => {
      console.log(`📤 Bot salió del servidor: ${guild.name}`);
      
      this.broadcastToClients({
        type: 'server_left',
        data: { serverId: guild.id, serverName: guild.name }
      });
    });

    // Sistema de moderación de mensajes
    this.client.on(Events.MessageCreate, async (message) => {
      if (message.author.bot) return;
      await this.moderateMessage(message);
    });

    this.client.on(Events.InteractionCreate, async (interaction) => {
      if (!interaction.isChatInputCommand()) return;

      const { commandName } = interaction;

      try {
        switch (commandName) {
          case 'info':
            await this.handleInfoCommand(interaction);
            break;
          case 'hardware':
            await this.handleHardwareCommand(interaction);
            break;
          case 'specs':
            await this.handleSpecsCommand(interaction);
            break;
          case 'precios':
            await this.handlePreciosCommand(interaction);
            break;
          case 'ayuda':
            await this.handleAyudaCommand(interaction);
            break;
          case 'config':
            await this.handleConfigCommand(interaction);
            break;
          case 'familia':
            await this.handleFamiliaCommand(interaction);
            break;
          case 'moderacion':
            await this.handleModeracionCommand(interaction);
            break;
          default:
            await interaction.reply('❌ Comando no reconocido');
        }

        this.broadcastToClients({
          type: 'command_executed',
          data: {
            command: commandName,
            serverId: interaction.guildId,
            serverName: interaction.guild?.name,
            userId: interaction.user.id,
            username: interaction.user.username
          }
        });

      } catch (error) {
        console.error('Error ejecutando comando:', error);
        
        if (!interaction.replied) {
          await interaction.reply('❌ Hubo un error al ejecutar este comando');
        }
      }
    });

    this.client.on(Events.Error, async (error) => {
      console.error('Error del cliente Discord:', error);
      
      this.broadcastToClients({
        type: 'bot_error',
        data: { error: error.message }
      });
    });
  }

  // Patrones de detección para moderación automática
  private spamPatterns = [
    /discord\.gg\/\w+/gi, // Invitaciones de Discord
    /discord\.com\/invite\/\w+/gi,
    /discordapp\.com\/invite\/\w+/gi,
    /@everyone|@here/gi, // Menciones masivas
    /gratis|free|money|dinero/gi, // Palabras spam comunes
    /telegram\.me|t\.me/gi, // Enlaces de Telegram
    /whatsapp|wa\.me/gi, // Enlaces de WhatsApp
  ];

  private steamScamPatterns = [
    /steam.*gift/gi,
    /cs.*go.*skin/gi,
    /steam.*trade/gi,
    /steamcommunity.*com.*profiles/gi,
    /steam.*wallet/gi,
    /free.*steam/gi,
    /steam.*code/gi,
    /votekick.*com|csgopolygon|skinbaron/gi,
  ];

  private adPatterns = [
    /compra|venta|vendo|buy|sell/gi,
    /precio|price|€|\$|usd|eur/gi,
    /tienda|shop|store/gi,
    /descuento|discount|oferta|offer/gi,
    /amazon|mercadolibre|ebay/gi,
  ];

  // Configuración de canales (esto se debería guardar en base de datos)
  private channelConfig = {
    generalChannelNames: ['general', 'chat-general', 'principal'],
    helpChannelNames: ['ayuda', 'help', 'soporte', 'tech-help'],
  };

  // Sistema de moderación de mensajes completo
  private async moderateMessage(message: any) {
    try {
      const content = message.content.toLowerCase();
      const channelName = message.channel.name?.toLowerCase() || '';
      
      // Detectar spam y scams
      const isSpam = this.spamPatterns.some(pattern => pattern.test(content));
      const isSteamScam = this.steamScamPatterns.some(pattern => pattern.test(content));
      const isAd = this.adPatterns.some(pattern => pattern.test(content));

      // Acciones de moderación
      if (isSpam || isSteamScam || isAd) {
        await this.handleViolation(message, isSpam ? 'spam' : isSteamScam ? 'scam' : 'ad');
        return;
      }

      // Redireccionar desde chat general al foro de ayuda
      if (this.channelConfig.generalChannelNames.includes(channelName)) {
        await this.redirectToHelpForum(message);
      }

      // Log de actividad para el dashboard
      this.broadcastToClients({
        type: 'message_activity',
        data: {
          userId: message.author.id,
          username: message.author.username,
          channelName: message.channel.name,
          timestamp: Date.now()
        }
      });

    } catch (error) {
      console.error('Error en moderación:', error);
    }
  }

  private async handleViolation(message: any, violationType: string) {
    try {
      // Eliminar mensaje
      await message.delete();

      // Mensajes temáticos de La Mafia del Hardware
      const mafiaMessages = {
        spam: [
          `🔫 **${message.author.username}**, el spam no es bienvenido en la familia. *elimina el mensaje*`,
          `🎭 Don Corleone no tolera el spam en sus dominios, **${message.author.username}**.`,
          `⚖️ La familia ha decidido: el spam de **${message.author.username}** ha sido... *eliminado*.`
        ],
        scam: [
          `🚨 **${message.author.username}**, los scams de Steam son traición a la familia. Tu mensaje ha sido eliminado.`,
          `🎯 La familia protege sus miembros de estafas. **${message.author.username}**, esto no volverá a pasar.`,
          `🛡️ Don Corleone dice: "Los scams no tienen lugar en nuestra mesa", **${message.author.username}**.`
        ],
        ad: [
          `💼 **${message.author.username}**, la publicidad no autorizada es mala para los negocios. *elimina el mensaje*`,
          `🏛️ La familia tiene reglas sobre el comercio, **${message.author.username}**. Respétalas.`,
          `📜 Las reglas de la casa son claras: no publicidad sin permiso, **${message.author.username}**.`
        ]
      };

      const messages = mafiaMessages[violationType as keyof typeof mafiaMessages];
      const randomMessage = messages[Math.floor(Math.random() * messages.length)];

      // Enviar mensaje de advertencia
      const warningMessage = await message.channel.send(randomMessage);
      
      // Eliminar el mensaje de advertencia después de 10 segundos
      setTimeout(async () => {
        try {
          await warningMessage.delete();
        } catch (e) {
          // Ignorar errores al eliminar
        }
      }, 10000);

      // Broadcast del evento de moderación
      this.broadcastToClients({
        type: 'moderation_action',
        data: {
          userId: message.author.id,
          username: message.author.username,
          violationType,
          channelName: message.channel.name,
          content: message.content.substring(0, 100),
          timestamp: Date.now()
        }
      });

      console.log(`🛡️ Moderación automática: ${violationType} eliminado de ${message.author.username}`);

    } catch (error) {
      console.error('Error al manejar violación:', error);
    }
  }

  private async redirectToHelpForum(message: any) {
    try {
      // Buscar canal de ayuda
      const guild = message.guild;
      if (!guild) return;

      const helpChannel = guild.channels.cache.find((channel: any) => 
        this.channelConfig.helpChannelNames.some(name => 
          channel.name?.toLowerCase().includes(name)
        )
      );

      if (!helpChannel) return;

      const redirectMessages = [
        `🎩 **${message.author.username}**, la familia te recomienda usar ${helpChannel} para tus consultas. Ahí encontrarás la ayuda que necesitas.`,
        `🏛️ Don Corleone dice: "Las preguntas técnicas van en ${helpChannel}", **${message.author.username}**. La familia estará ahí para ayudarte.`,
        `⚖️ **${message.author.username}**, mantengamos el orden. Para soporte técnico, la familia te espera en ${helpChannel}.`,
        `🎭 La etiqueta de la familia: consultas técnicas en ${helpChannel}, **${message.author.username}**. Respetemos las tradiciones.`
      ];

      const randomMessage = redirectMessages[Math.floor(Math.random() * redirectMessages.length)];

      // Enviar mensaje de redirección
      const redirectMsg = await message.channel.send(randomMessage);

      // Eliminar después de 15 segundos
      setTimeout(async () => {
        try {
          await redirectMsg.delete();
        } catch (e) {
          // Ignorar errores
        }
      }, 15000);

      // Broadcast del evento
      this.broadcastToClients({
        type: 'user_redirected',
        data: {
          userId: message.author.id,
          username: message.author.username,
          fromChannel: message.channel.name,
          toChannel: helpChannel.name,
          timestamp: Date.now()
        }
      });

    } catch (error) {
      console.error('Error al redireccionar usuario:', error);
    }
  }

  private async registerCommands() {
    const commands = [
      new SlashCommandBuilder()
        .setName('info')
        .setDescription('Información sobre La Mafia del Hardware'),
      
      new SlashCommandBuilder()
        .setName('hardware')
        .setDescription('Información sobre componentes de hardware')
        .addStringOption(option =>
          option.setName('componente')
            .setDescription('Tipo de componente')
            .setRequired(true)
            .addChoices(
              { name: 'CPU', value: 'cpu' },
              { name: 'GPU', value: 'gpu' },
              { name: 'RAM', value: 'ram' },
              { name: 'Motherboard', value: 'mobo' },
              { name: 'Almacenamiento', value: 'storage' }
            )),
      
      new SlashCommandBuilder()
        .setName('specs')
        .setDescription('Comparte las especificaciones de tu PC'),
      
      new SlashCommandBuilder()
        .setName('precios')
        .setDescription('Consultar precios de hardware')
        .addStringOption(option =>
          option.setName('producto')
            .setDescription('Nombre del producto a buscar')
            .setRequired(true)),
      
      new SlashCommandBuilder()
        .setName('ayuda')
        .setDescription('Muestra todos los comandos disponibles'),

      new SlashCommandBuilder()
        .setName('config')
        .setDescription('Configurar el sistema de moderación (solo administradores)')
        .addStringOption(option =>
          option.setName('accion')
            .setDescription('Acción a realizar')
            .setRequired(true)
            .addChoices(
              { name: 'Ver configuración', value: 'view' },
              { name: 'Activar moderación', value: 'enable' },
              { name: 'Desactivar moderación', value: 'disable' },
              { name: 'Configurar canales', value: 'channels' }
            )),

      new SlashCommandBuilder()
        .setName('familia')
        .setDescription('Información sobre las reglas de La Mafia del Hardware'),

      new SlashCommandBuilder()
        .setName('moderacion')
        .setDescription('Comandos de moderación manual (solo administradores)')
        .addSubcommand(subcommand =>
          subcommand
            .setName('warn')
            .setDescription('Advertir a un usuario')
            .addUserOption(option =>
              option.setName('usuario')
                .setDescription('Usuario a advertir')
                .setRequired(true))
            .addStringOption(option =>
              option.setName('razon')
                .setDescription('Razón de la advertencia')
                .setRequired(true)))
        .addSubcommand(subcommand =>
          subcommand
            .setName('kick')
            .setDescription('Expulsar a un usuario')
            .addUserOption(option =>
              option.setName('usuario')
                .setDescription('Usuario a expulsar')
                .setRequired(true))
            .addStringOption(option =>
              option.setName('razon')
                .setDescription('Razón de la expulsión')
                .setRequired(false)))
    ];

    try {
      const clientId = process.env.DISCORD_CLIENT_ID;
      if (!clientId) {
        console.warn('⚠️ DISCORD_CLIENT_ID no encontrado, omitiendo registro de comandos');
        return;
      }

      console.log('🔄 Registrando comandos slash...');

      if (this.rest) {
        await this.rest.put(
          Routes.applicationCommands(clientId),
          { body: commands },
        );
      }

      console.log('✅ Comandos slash registrados exitosamente');
    } catch (error) {
      console.error('❌ Error registrando comandos:', error);
    }
  }

  private async handleInfoCommand(interaction: any) {
    const embed = {
      title: '🏴‍☠️ La Mafia del Hardware',
      description: 'Tu comunidad de confianza para todo lo relacionado con hardware de PC',
      color: 0x7289DA,
      fields: [
        {
          name: '🎯 Nuestra Misión',
          value: 'Ayudar a los entusiastas del hardware a tomar las mejores decisiones',
          inline: false
        },
        {
          name: '🔧 Servicios',
          value: '• Recomendaciones de hardware\n• Análisis de precios\n• Reviews y comparativas',
          inline: false
        },
        {
          name: '📊 Estadísticas',
          value: `Servidores: ${this.client.guilds.cache.size}\nMiembros: ${this.client.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0)}`,
          inline: true
        }
      ],
      footer: { text: 'La Mafia del Hardware • 2025' },
      timestamp: new Date().toISOString()
    };

    await interaction.reply({ embeds: [embed] });
  }

  private async handleHardwareCommand(interaction: any) {
    const componente = interaction.options.getString('componente') as string;
    
    const info: Record<string, any> = {
      cpu: {
        title: '🔥 CPUs - El cerebro de tu PC',
        description: 'Recomendaciones actuales para diferentes rangos de precio',
        fields: [
          { name: 'Gama Alta', value: ' AMD Ryzen 9 7950X', inline: true },
          { name: 'Gama Media', value: ' AMD Ryzen 5 7600X', inline: true },
          { name: 'Presupuesto', value: 'Intel i3-12100F, AMD Ryzen 5 5600', inline: true }
        ]
      },
      gpu: {
        title: '🎮 GPUs - Potencia gráfica',
        description: 'Las mejores tarjetas gráficas para gaming y trabajo',
        fields: [
          { name: '4K Gaming', value: 'RTX 4090, RTX 4080 Super', inline: true },
          { name: '1440p Gaming', value: 'RTX 4070 Super, RX 7800 XT', inline: true },
          { name: '1080p Gaming', value: 'RTX 4060, RX 7600', inline: true }
        ]
      },
      ram: {
        title: '💾 Memoria RAM',
        description: 'Configuraciones recomendadas para diferentes usos',
        fields: [
          { name: 'Gaming', value: '32GB DDR4-3200 / DDR5-6000', inline: true },
          { name: 'Trabajo/Streaming', value: '32GB DDR4-3600 / DDR5-6000', inline: true },
          { name: 'Workstation', value: '64GB+ DDR5-6400', inline: true }
        ]
      },
      mobo: {
        title: '🔌 Motherboards',
        description: 'La base de tu sistema',
        fields: [
          { name: 'Intel', value: 'Z790, B760 para 12 gen, 13 y 14 estan banneadas', inline: true },
          { name: 'AMD', value: 'X670E, B650 para Ryzen 7000', inline: true },
          { name: 'Características', value: 'WiFi 6E, USB 3.2, PCIe 5.0', inline: true }
        ]
      },
      storage: {
        title: '💿 Almacenamiento',
        description: 'SSDs y HDDs recomendados',
        fields: [
          { name: 'SSD NVMe Gaming', value: 'Samsung 980 Pro, WD SN850X', inline: true },
          { name: 'SSD Económico', value: 'A-DATA Legend 800, Crucial MX4', inline: true },
          { name: 'Almacenamiento Masivo', value: 'Seagate Barracuda, WD Blue', inline: true }
        ]
      }
    };

    const embed = {
      title: info[componente].title,
      description: info[componente].description,
      color: 0x00FF00,
      fields: info[componente].fields,
      footer: { text: 'Precios y disponibilidad pueden variar' }
    };

    await interaction.reply({ embeds: [embed] });
  }

  private async handleSpecsCommand(interaction: any) {
    const embed = {
      title: '📋 Comparte tus Specs',
      description: 'Usa este formato para compartir las especificaciones de tu PC:',
      color: 0xFF6B35,
      fields: [
        {
          name: '🖥️ Formato Sugerido',
          value: '```\n🔥 CPU: [Tu procesador]\n🎮 GPU: [Tu tarjeta gráfica]\n💾 RAM: [Cantidad y tipo]\n🔌 Motherboard: [Modelo]\n💿 Storage: [SSD/HDD]\n⚡ PSU: [Fuente de poder]\n🏠 Case: [Gabinete]\n```',
          inline: false
        },
        {
          name: '💡 Tip',
          value: 'También puedes usar herramientas como HwInfo o CPU-Z para obtener información detallada',
          inline: false
        }
      ]
    };

    await interaction.reply({ embeds: [embed] });
  }

  private async handlePreciosCommand(interaction: any) {
    const producto = interaction.options.getString('producto');
    
    const embed = {
      title: `💰 Búsqueda de Precios: ${producto}`,
      description: 'Aquí tienes algunas recomendaciones para encontrar los mejores precios:',
      color: 0xF39C12,
      fields: [
        {
          name: '🛒 Tiendas Recomendadas',
          value: '• EvoPC\n• Niceone\n• Myshop\n• Megadrive\n• tienda.pc-express',
          inline: true
        },
        {
          name: '💡 Tips de Compra',
          value: '• Compara precios\n• Revisa garantías\n• Lee reviews\n• Verifica stock',
          inline: true
        },
        {
          name: '⚠️ Importante',
          value: 'Los precios cambian constantemente. Siempre verifica antes de comprar.',
          inline: false
        }
      ],
      footer: { text: `Búsqueda para: ${producto}` }
    };

    await interaction.reply({ embeds: [embed] });
  }

  private async handleAyudaCommand(interaction: any) {
    const embed = {
      title: '🆘 Comandos Disponibles',
      description: 'Lista completa de comandos de La Mafia del Hardware Bot',
      color: 0x9B59B6,
      fields: [
        {
          name: '📖 Comandos de Información',
          value: '`/info` - Información sobre la comunidad\n`/ayuda` - Muestra esta lista',
          inline: false
        },
        {
          name: '🔧 Comandos de Hardware',
          value: '`/hardware [componente]` - Info sobre componentes\n`/specs` - Formato para compartir specs\n`/precios [producto]` - Buscar precios',
          inline: false
        },
        {
          name: '🔗 Enlaces Útiles',
          value: '[Página Web](https://pcpartpicker.com/) • [Página Web](https://www.solotodo.cl/)',
          inline: false
        }
      ],
      footer: { text: 'La Mafia del Hardware Bot' }
    };

    await interaction.reply({ embeds: [embed] });
  }

  private async handleConfigCommand(interaction: any) {
    // Verificar permisos de administrador
    if (!interaction.member?.permissions?.has('Administrator')) {
      await interaction.reply({
        content: '🚫 Solo los administradores de la familia pueden usar este comando.',
        ephemeral: true
      });
      return;
    }

    const accion = interaction.options.getString('accion');

    switch (accion) {
      case 'view':
        const embed = {
          title: '⚙️ Configuración de Moderación',
          description: 'Sistema de moderación automática de La Mafia del Hardware',
          color: 0x2C3E50,
          fields: [
            {
              name: '🛡️ Sistema de Moderación',
              value: 'Activo - Redirigiendo usuarios al canal de ayuda',
              inline: false
            },
            {
              name: '📢 Canales Generales',
              value: this.channelConfig.generalChannelNames.join(', '),
              inline: true
            },
            {
              name: '🆘 Canales de Ayuda',
              value: this.channelConfig.helpChannelNames.join(', '),
              inline: true
            },
            {
              name: '🔍 Funciones Activas',
              value: '• Auto-redirección desde chat general\n• Monitoreo de actividad\n• Comandos slash temáticos\n• Dashboard en tiempo real',
              inline: false
            },
            {
              name: '⚠️ Nota Importante',
              value: 'Para moderación completa de contenido, habilita "Message Content Intent" en Discord Developer Portal',
              inline: false
            }
          ],
          footer: { text: 'La Mafia del Hardware - Sistema de Moderación' }
        };
        
        await interaction.reply({ embeds: [embed], ephemeral: true });
        break;

      case 'enable':
        await interaction.reply({
          content: '✅ El sistema de moderación ya está activo. La familia protege el servidor 24/7.',
          ephemeral: true
        });
        break;

      case 'disable':
        await interaction.reply({
          content: '⚠️ El sistema de moderación está integrado en el código del bot. Para desactivarlo, contacta al desarrollador.',
          ephemeral: true
        });
        break;

      case 'channels':
        const channelInfo = {
          title: '📋 Configuración de Canales',
          description: 'Para modificar la configuración de canales, usa estos nombres:',
          color: 0x3498DB,
          fields: [
            {
              name: '📢 Canales Generales (auto-redirección)',
              value: '`general`, `chat-general`, `principal`',
              inline: false
            },
            {
              name: '🆘 Canales de Ayuda (destino)',
              value: '`ayuda`, `help`, `soporte`, `tech-help`',
              inline: false
            },
            {
              name: '💡 Nota',
              value: 'El bot detecta automáticamente canales que contengan estos nombres',
              inline: false
            }
          ]
        };
        
        await interaction.reply({ embeds: [channelInfo], ephemeral: true });
        break;
    }
  }

  private async handleFamiliaCommand(interaction: any) {
    const embed = {
      title: '👑 Las Reglas de La Mafia del Hardware',
      description: 'En esta familia, el respeto y el honor son fundamentales',
      color: 0x8B0000,
      fields: [
        {
          name: '🤝 Código de Honor',
          value: '• Respeta a todos los miembros de la familia\n• No spam ni publicidad sin autorización\n• Mantén las discusiones técnicas en los canales apropiados\n• Ayuda a otros miembros cuando sea posible',
          inline: false
        },
        {
          name: '🚫 Actividades Prohibidas',
          value: '• Scams o estafas de cualquier tipo\n• Invitaciones no autorizadas a otros servidores\n• Contenido ofensivo o discriminatorio\n• Venta sin autorización de administradores',
          inline: false
        },
        {
          name: '⚖️ Consecuencias',
          value: 'Las violaciones serán tratadas por el Don y sus consejeros. La disciplina mantiene el orden en la familia.',
          inline: false
        },
        {
          name: '🎭 Recuerda',
          value: '"Un hombre que no pasa tiempo con su familia nunca puede ser un verdadero hombre" - Don Corleone',
          inline: false
        }
      ],
      footer: { text: 'La Mafia del Hardware • Respeto • Honor • Lealtad' }
    };

    await interaction.reply({ embeds: [embed] });
  }

  private async handleModeracionCommand(interaction: any) {
    // Verificar permisos de moderador
    if (!interaction.member?.permissions?.has('KickMembers') && !interaction.member?.permissions?.has('Administrator')) {
      await interaction.reply({
        content: '🚫 Solo los soldados de confianza de la familia pueden usar estos comandos.',
        ephemeral: true
      });
      return;
    }

    const subcommand = interaction.options.getSubcommand();
    
    switch (subcommand) {
      case 'warn':
        const warnUser = interaction.options.getUser('usuario');
        const warnReason = interaction.options.getString('razon');
        
        const warnEmbed = {
          title: '⚠️ Advertencia de La Familia',
          description: `${warnUser} ha recibido una advertencia oficial`,
          color: 0xFF8C00,
          fields: [
            {
              name: '👤 Usuario',
              value: `${warnUser}`,
              inline: true
            },
            {
              name: '📝 Razón',
              value: warnReason,
              inline: true
            },
            {
              name: '👮 Moderador',
              value: `${interaction.user}`,
              inline: true
            },
            {
              name: '🎭 Mensaje de La Familia',
              value: 'La familia espera que respetes las reglas. Esta es tu oportunidad de redimirte.',
              inline: false
            }
          ],
          timestamp: new Date().toISOString()
        };

        await interaction.reply({ embeds: [warnEmbed] });
        
        // Log para el dashboard
        this.broadcastToClients({
          type: 'moderation_action',
          data: {
            action: 'warn',
            targetUser: warnUser.username,
            moderator: interaction.user.username,
            reason: warnReason,
            timestamp: Date.now()
          }
        });
        break;

      case 'kick':
        const kickUser = interaction.options.getUser('usuario');
        const kickReason = interaction.options.getString('razon') || 'Violación de las reglas de la familia';
        
        try {
          // Intentar expulsar al usuario
          const member = await interaction.guild.members.fetch(kickUser.id);
          await member.kick(kickReason);
          
          const kickEmbed = {
            title: '🔨 Expulsión de La Familia',
            description: 'Un miembro ha sido removido de la familia',
            color: 0xFF0000,
            fields: [
              {
                name: '👤 Usuario Expulsado',
                value: `${kickUser}`,
                inline: true
              },
              {
                name: '📝 Razón',
                value: kickReason,
                inline: true
              },
              {
                name: '👮 Moderador',
                value: `${interaction.user}`,
                inline: true
              },
              {
                name: '🎭 Decisión Final',
                value: 'La familia ha decidido. Que sirva de ejemplo para otros.',
                inline: false
              }
            ],
            timestamp: new Date().toISOString()
          };

          await interaction.reply({ embeds: [kickEmbed] });
          
          // Log para el dashboard
          this.broadcastToClients({
            type: 'moderation_action',
            data: {
              action: 'kick',
              targetUser: kickUser.username,
              moderator: interaction.user.username,
              reason: kickReason,
              timestamp: Date.now()
            }
          });
          
        } catch (error) {
          await interaction.reply({
            content: '❌ No pude expulsar a este usuario. Verifica que tenga los permisos necesarios.',
            ephemeral: true
          });
        }
        break;
    }
  }

  private getUptime(): string {
    const uptime = Date.now() - this.startTime;
    const hours = Math.floor(uptime / (1000 * 60 * 60));
    const minutes = Math.floor((uptime % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${minutes}m`;
  }

  async start() {
    const token = process.env.DISCORD_BOT_TOKEN;
    if (!token) {
      console.warn('⚠️ DISCORD_BOT_TOKEN no proporcionado, el bot no se iniciará');
      return;
    }

    try {
      await this.client.login(token);
    } catch (error) {
      console.error('❌ Error al iniciar el bot de Discord:', error);
    }
  }

  async restart() {
    console.log('🔄 Reiniciando bot de Discord...');
    
    this.broadcastToClients({
      type: 'bot_status',
      data: { status: 'restarting', ready: false }
    });

    if (this.client.isReady()) {
      await this.client.destroy();
    }

    this.isReady = false;
    this.startTime = Date.now();

    setTimeout(() => {
      this.start();
    }, 2000);
  }

  getStatus() {
    return {
      ready: this.isReady,
      status: this.isReady ? 'online' : 'offline',
      uptime: this.getUptime(),
      guilds: this.client.guilds.cache.size,
      users: this.client.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0)
    };
  }
}