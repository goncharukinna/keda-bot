const { Telegraf } = require('telegraf');
const axios = require('axios');
const amqp = require('amqplib');
const { Pool } = require('pg');

const bot = new Telegraf(process.env.BOT_TOKEN);

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://admin:admin123@rabbitmq.default.svc.cluster.local:5672/';
const QUEUE_NAME = 'telegram_messages';

// Настройка пула подключений к PostgreSQL
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

let channel;

// Функция инициализации базы данных (создает обе таблицы)
async function initDatabase() {
  const createMessagesTable = `
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      chat_id BIGINT NOT NULL,
      message_text TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;

  const createPhrasesTable = `
    CREATE TABLE IF NOT EXISTS phrases (
      id SERIAL PRIMARY KEY,
      text TEXT NOT NULL
    );
  `;

  try {
    await pool.query(createMessagesTable);
    await pool.query(createPhrasesTable);
    
    // Проверяем, есть ли фразы в базе. Если нет — добавляем базовые.
    const res = await pool.query('SELECT COUNT(*) FROM phrases');
    if (parseInt(res.rows[0].count) === 0) {
      await pool.query(`
        INSERT INTO phrases (text) VALUES 
        ('Ты справишься!'),
        ('Я в тебя верю.'),
        ('Давай сделаем перерыв на кофе?'),
        ('Ты на верном пути.'),
        ('Я горжусь тобой.')
      `);
      console.log('✅ Таблица phrases была пуста, добавлены базовые фразы');
    }
    
    console.log('✅ База данных подключена, таблицы messages и phrases готовы');
  } catch (err) {
    console.error('❌ Ошибка инициализации БД:', err);
  }
}

// Функция для получения случайной фразы из БД
async function getRandomPhraseFromDB() {
  try {
    const res = await pool.query('SELECT text FROM phrases ORDER BY RANDOM() LIMIT 1');
    if (res.rows.length > 0) {
      return res.rows[0].text;
    }
    return "Я всегда рядом."; 
  } catch (err) {
    console.error('❌ Ошибка получения фразы из БД:', err);
    return "Я всегда рядом."; 
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

// Consumer: читает сообщения из очереди, сохраняет в БД и отправляет ответ
async function startConsumer() {
  channel.consume(QUEUE_NAME, async (msg) => {
    if (msg !== null) {
      const data = JSON.parse(msg.content.toString());
      console.log('📩 Получено сообщение из очереди:', data);

      // 1. Сохраняем сообщение в PostgreSQL
      try {
        const insertQuery = 'INSERT INTO messages(chat_id, message_text) VALUES($1, $2)';
        await pool.query(insertQuery, [data.chatId, data.text]);
        console.log('💾 Сообщение сохранено в БД');
      } catch (dbErr) {
        console.error('❌ Ошибка сохранения в БД:', dbErr);
      }

      // 2. Получаем фразу для ответа из БД
      let replyText = await getRandomPhraseFromDB();

      // (Опционально) Можно добавить логику чередования с внешними цитатами, 
      // но сейчас мы берем только то, что есть в базе.
      // try {
      //   const response = await axios.get('https://api.quotable.io/random');
      //   replyText = `"${response.data.content}" — ${response.data.author}`;
      // } catch (error) {
      //   console.log("Не удалось получить цитату, использую фразу из БД");
      // }

      // 3. Отправляем ответ в Telegram
      try {
        await bot.telegram.sendMessage(data.chatId, replyText);
        console.log(`📤 Ответ отправлен в чат ${data.chatId}: ${replyText}`);
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
  // Сначала инициализируем базу данных, затем запускаем бота и RabbitMQ
  await initDatabase();
  
  bot.launch().catch((err) => {
    console.error('Ошибка запуска бота (сеть):', err.message);
    console.log('Бот не может подключиться к Telegram. Ждем восстановления сети...');
  });

  connectRabbit();
  console.log('🤖 Support-bot запущен!');
}

start();

// Обработка остановки
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
