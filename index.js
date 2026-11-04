const { Telegraf } = require('telegraf');
const axios = require('axios');
const amqp = require('amqplib');

const bot = new Telegraf(process.env.BOT_TOKEN); // Не забудь вставить токен от @BotFather

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://admin:admin123@rabbitmq.default.svc.cluster.local:5672/';
const QUEUE_NAME = 'telegram_messages';

let channel;

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

// Consumer: читает сообщения из очереди и отправляет ответ в Telegram
async function startConsumer() {
    channel.consume(QUEUE_NAME, async (msg) => {
        if (msg !== null) {
            const data = JSON.parse(msg.content.toString());
            console.log('📩 Получено сообщение из очереди:', data);
            
            // Генерируем ответ
            const localPhrases = [
                "Ты справишься!",
                "Я в тебя верю.",
                "Давай сделаем перерыв на кофе?",
                "Какой отличный план!",
                "Ты сегодня отлично потрудилась."
            ];
            let randomPhrase = localPhrases[Math.floor(Math.random() * localPhrases.length)];

            if (Math.random() < 0.3) {
                try {
                    const response = await axios.get('https://api.quotable.io/random');
                    randomPhrase = `"${response.data.content}" — ${response.data.author}`;
                } catch (error) {
                    console.log("Не удалось получить цитату, использую локальную фразу");
                }
            }

            // Отправляем ответ в Telegram
            try {
                await bot.telegram.sendMessage(data.chatId, randomPhrase);
                console.log(`✅ Ответ отправлен в чат ${data.chatId}`);
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
        console.log('📤 Сообщение отправлено в очередь:', messageData);
    } else {
        console.log('⚠️ RabbitMQ не подключен, сообщение не отправлено');
    }
});

// Запуск
bot.launch();
connectRabbit();
console.log('🤖 Support-bot запущен!');
