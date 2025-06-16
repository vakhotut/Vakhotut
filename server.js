require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const cors = require('cors');
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const { Telegraf } = require('telegraf');
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Инициализация базы данных
const adapter = new FileSync('db.json');
const db = low(adapter);

// Инициализация структуры БД
db.defaults({
  contacts: {
    bot: { title: "Наш бот", description: "Быстрые ответы 24/7", link: "t.me/our_support_bot" },
    channel: { title: "Наш канал", description: "Актуальные новости", link: "t.me/our_news_channel" },
    chat: { title: "Наш чат", description: "Живое общение", link: "t.me/our_community_chat" }
  },
  news: [],
  reviews: [],
  admin: {
    login: process.env.ADMIN_LOGIN || 'admin',
    password: crypto.createHash('sha256').update(process.env.ADMIN_PASSWORD || 'password').digest('hex')
  },
  telegram: {
    newsBotToken: '',
    reviewsBotToken: '',
    newsChannelId: '',
    reviewsChatId: ''
  },
  lastUpdate: {
    news: 0,
    reviews: 0
  }
}).write();

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'supersecret',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 } // 1 день
}));

// Telegram боты
const newsBot = new Telegraf(db.get('telegram.newsBotToken').value());
const reviewsBot = new Telegraf(db.get('telegram.reviewsBotToken').value());

// Обработчики Telegram
newsBot.on('channel_post', (ctx) => {
  const message = ctx.update.channel_post;
  if (message.text) {
    db.get('news').push({
      id: Date.now(),
      title: `Новость #${db.get('news').size().value() + 1}`,
      content: message.text,
      date: new Date().toISOString()
    }).write();
    
    db.set('lastUpdate.news', Date.now()).write();
    console.log('Новая новость получена');
  }
});

reviewsBot.on('message', (ctx) => {
  const message = ctx.message;
  if (message.text && message.text.startsWith('/review')) {
    const reviewText = message.text.replace('/review', '').trim();
    
    db.get('reviews').push({
      id: Date.now(),
      author: `${message.from.first_name} ${message.from.last_name || ''}`,
      text: reviewText,
      rating: 5,
      date: new Date().toISOString()
    }).write();
    
    db.set('lastUpdate.reviews', Date.now()).write();
    console.log('Новый отзыв получен');
    ctx.reply('Спасибо за ваш отзыв!');
  }
});

// Запуск ботов
if (db.get('telegram.newsBotToken').value()) {
  newsBot.launch();
}
if (db.get('telegram.reviewsBotToken').value()) {
  reviewsBot.launch();
}

// Middleware проверки аутентификации
const isAuthenticated = (req, res, next) => {
  if (req.session && req.session.authenticated) {
    return next();
  }
  res.status(401).json({ error: 'Требуется аутентификация' });
};

// API Endpoints
app.get('/api/data', (req, res) => {
  res.json({
    contacts: db.get('contacts').value(),
    news: db.get('news').value().slice(-5).reverse(),
    reviews: db.get('reviews').value().slice(-5).reverse(),
    lastUpdate: db.get('lastUpdate').value()
  });
});

app.post('/api/login', (req, res) => {
  const { login, password } = req.body;
  const hashedPassword = crypto.createHash('sha256').update(password).digest('hex');
  
  if (login === db.get('admin.login').value() && 
      hashedPassword === db.get('admin.password').value()) {
    req.session.authenticated = true;
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Неверные учетные данные' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.post('/api/update-contacts', isAuthenticated, (req, res) => {
  const { contacts } = req.body;
  db.set('contacts', contacts).write();
  res.json({ success: true });
});

app.post('/api/update-telegram', isAuthenticated, (req, res) => {
  const { telegram } = req.body;
  
  // Обновляем токены и перезапускаем ботов
  db.set('telegram', telegram).write();
  
  if (telegram.newsBotToken) {
    newsBot.telegram.token = telegram.newsBotToken;
    newsBot.launch();
  }
  
  if (telegram.reviewsBotToken) {
    reviewsBot.telegram.token = telegram.reviewsBotToken;
    reviewsBot.launch();
  }
  
  res.json({ success: true });
});

// Отдаем фронтенд
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Запуск сервера
app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
  console.log(`Админ-логин: ${db.get('admin.login').value()}`);
});
