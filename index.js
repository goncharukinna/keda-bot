const { Telegraf } = require('telegraf');
const axios = require('axios');
const amqp = require('amqplib');
const { Pool } = require('pg'); // 1. Подключаем библиотеку pg

const bot = new Telegraf(process.env.BOT_TOKEN);

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://admin:admin123@rabbitmq.default.svc.cluster.local:5672/';
const QUEUE_NAME = 'telegram_messages';

// 2. Настройка пула подключений к PostgreSQL
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

let channel;

// 3. Функция инициализации базы данных
async function initDatabase() {
  const query = `
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      chat_id BIGINT NOT NULL,
      message_text TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;
  try {
    await pool.query(query);
    console.log('✅ База данных подключена, таблица messages готова');
  } catch (err) {
    console.error('❌ Ошибка инициализации БД:', err);
  }
}

// Функция для подключения к RabbitMQ
async function connectRabbit() {
  try {
    const connection = await amqp.connect(RABBITMQ_URL);
    channel = await connection.createChannel();
    await channel.assertQueue(QUEUE_NAME);
    console.log('✅ Подключено к RabbitMQ, очередь:', QUEUE_NAME);

    // Запускаем Consumer (чтение из очереди)
    startConsumer();
  } catch (error) {
    console.error('❌ Ошибка подключения к RabbitMQ:', error);
    setTimeout(connectRabbit, 5000); // Пытаемся переподключиться через 5 секунд
  }
}

// Consumer: читает сообщения из очереди, сохраняет в БД и отправляет ответ в Telegram
async function startConsumer() {
  channel.consume(QUEUE_NAME, async (msg) => {
    if (msg !== null) {
      const data = JSON.parse(msg.content.toString());
      console.log('📩 Получено сообщение из очереди:', data);

      // 4. Сохраняем сообщение в PostgreSQL
      try {
        const insertQuery = 'INSERT INTO messages(chat_id, message_text) VALUES($1, $2)';
        await pool.query(insertQuery, [data.chatId, data.text]);
        console.log('💾 Сообщение сохранено в БД');
      } catch (dbErr) {
        console.error('❌ Ошибка сохранения в БД:', dbErr);
      }

      // Генерируем ответ
      const localPhrases = [
        "Ты справишься!",
        "Я в тебя верю.",
        "Давай сделаем перерыв на кофе?",
        "Какой отличный план!",
        "Ты сегодня отлично потрудилась.",
        "Не забывай отдыхать!",
        "Ты на верном пути.",
        "Я горжусь тобой.",
        "Отличная работа!",
        "Продолжай в том же духе!",
        "Ты умница!",
        "Всё получится, даже если сейчас сложно.",
        "Сделай глубокий вдох и выдох.",
        "Ты уже сделала много, не забывай про себя.",
        "Я всегда рядом."
      ];
      
      let randomPhrase = localPhrases[Math.floor(Math.random() * localPhrases.length)];

      try {
        const response = await axios.get('https://api.quotable.io/random');
        randomPhrase = `"${response.data.content}" — ${response.data.author}`;
      } catch (error) {
        console.log("Не удалось получить цитату, использую локальную фразу");
      }

      // Отправляем ответ в Telegram
      try {
        await bot.telegram.sendMessage(data.chatId, randomPhrase);
        console.log(`📤 Ответ отправлен в чат ${data.chatId}`);
      } catch (err) {
        console.error('Ошибка отправки в Telegram:', err);
      }

      channel.ack(msg); // Подтверждаем обработку сообщения
    }
  });
}

// Producer: бот получает сообщение от пользователя и кладет его в очередь
bot.on('text', async (ctx) => {
  const messageData = {
    chatId: ctx.chat.id,
    text: ctx.message.text,
    timestamp: Date.now()
  };

  if (channel) {
    channel.sendToQueue(QUEUE_NAME, Buffer.from(JSON.stringify(messageData)));
    console.log('📨 Сообщение отправлено в очередь:', messageData);
  } else {
    console.log('⚠️ RabbitMQ не подключен, сообщение не отправлено');
  }
});

// Запуск
async function start() {
  // 5. Сначала инициализируем базу данных, затем запускаем бота и RabbitMQ
  await initDatabase();
  
  // Запуск бота с обработкой ошибок сети
  bot.launch().catch((err) => {
    console.error('Ошибка запуска бота (сеть):', err.message);
    console.log('Бот не может подключиться к Telegram. Ждем восстановления сети...');
  });

  connectRabbit();
  console.log('🤖 Support-bot запущен!');
}

start(); // Запускаем асинхронную функцию

// Обработка остановки
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
