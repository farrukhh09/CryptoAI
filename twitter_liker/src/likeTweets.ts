import { TwitterApi, ApiResponseError } from "twitter-api-v2";
import * as dotenv from "dotenv";

// Загружаем переменные окружения (.env)
dotenv.config();

// Чтение ключей из .env (OAuth 1.0a)
const consumerKey = process.env.TWITTER_CONSUMER_KEY!;
const consumerSecret = process.env.TWITTER_CONSUMER_SECRET!;
const accessToken = process.env.TWITTER_ACCESS_TOKEN!;
const accessSecret = process.env.TWITTER_ACCESS_SECRET!;

// Инициализируем Twitter-клиент
const client = new TwitterApi({
  appKey: consumerKey,
  appSecret: consumerSecret,
  accessToken,
  accessSecret,
});

/**
 * Примерная функция — проверяем, «интересен» ли твит по ключевым словам.
 * При желании добавьте анализ тональности, или более сложную логику.
 */
function isInterestingTweet(text: string): boolean {
  const keywords = ["ai", "interesting", "cool", "метавселенная"];
  const textLower = text.toLowerCase();
  return keywords.some(kw => textLower.includes(kw));
}

/**
 * Простейшая "задержка" (sleep)
 */
function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Обёртка для userTimeline, чтобы обрабатывать 429 (rate limit) с ретраем.
 * maxAttempts = 3 - три попытки, между ними спим 15 минут.
 */
async function fetchUserTimelineWithRetry(
  userId: string,
  maxAttempts: number = 3
) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await client.v2.userTimeline(userId, {
        max_results: 5,
        "tweet.fields": ["text"],
      });
    } catch (error) {
      if (error instanceof ApiResponseError && error.code === 429) {
        console.warn(
          `Получили 429 (Too Many Requests). Попытка ${attempt} из ${maxAttempts}. Ждём 15 минут...`
        );
        // Ждём 15 минут
        await delay(15 * 60_000);
        // После задержки пойдём на повтор следующего цикла (attempt++)
        continue;
      }
      // Если другая ошибка — пробрасываем
      throw error;
    }
  }
  // Если все попытки исчерпаны
  throw new Error(
    `Не удалось получить твиты после ${maxAttempts} попыток (ограничение API).`
  );
}

/**
 * Обёртка для лайка твита с обработкой ошибок.
 */
async function likeTweetWithRetry(likeUserId: string, tweetId: string) {
  console.log(`Попытка поставить лайк твиту ${tweetId} от пользователя ${likeUserId}`);
  try {
    // Сам лайк:
    const result = await client.v2.like(likeUserId, tweetId);
    return result;
  } catch (error) {
    if (error instanceof ApiResponseError && error.code === 429) {
      console.warn(
        `Лимит при лайке твита ${tweetId}. Ждём 15 минут перед повторной попыткой.`
      );
      // Ждём 15 минут
      await delay(15 * 60_000);
      // Повторная попытка
      try {
        const retryResult = await client.v2.like(likeUserId, tweetId);
        return retryResult;
      } catch (retryError) {
        console.error(`Повторная попытка лайка твита ${tweetId} не удалась:`, retryError);
      }
    } else if (error instanceof ApiResponseError) {
      console.error(`Ошибка при лайке твита ${tweetId}:`, error);
    } else {
      console.error(`Неизвестная ошибка при лайке твита ${tweetId}:`, error);
    }
    throw error;
  }
}

async function main() {
  try {
    // 1) Смотрим, кто мы (какой аккаунт авторизован)
    const me = await client.v2.me();
    const likeUserId = me.data.id;
    console.log("Авторизован как ID =", likeUserId);

    // 2) Массив аккаунтов, чьи твиты анализируем
    const accounts = ["virtuals_io", "aixbt_agent", "elizawakesup"];
    console.log("Начинаем проверку и лайкание твитов...");

    for (const username of accounts) {
      try {
        console.log(`\n=== Анализируем @${username} ===`);
        // a) Получаем ID пользователя по username
        const userData = await client.v2.userByUsername(username);
        const foreignUserId = userData.data.id;

        // b) Стараемся получить 5 последних твитов
        const timeline = await fetchUserTimelineWithRetry(foreignUserId);
        const tweets = timeline.data.data || [];
        if (!tweets.length) {
          console.log("Нет твитов для анализа у @", username);
          continue;
        }

        // c) Проверяем каждый твит
        for (const tweet of tweets) {
          console.log(`Твит ID ${tweet.id}: ${tweet.text}`);

          if (isInterestingTweet(tweet.text)) {
            console.log(" → Твит интересен. Ставим лайк...");
            // Ставим лайк, учитывая возможный retry
            try {
              const likeResult = await likeTweetWithRetry(likeUserId, tweet.id);
              console.log("Результат лайка:", likeResult?.data);
            } catch (likeError) {
              console.error(`Не удалось поставить лайк твиту ${tweet.id}:`, likeError);
            }
          } else {
            console.log(" → Твит не удовлетворяет критериям интересности.");
          }
        }
      } catch (error) {
        console.error(`Ошибка при обработке @${username}:`, error);
      }
    }

    console.log("\nВсе аккаунты обработаны!");
  } catch (error) {
    console.error("Ошибка в main():", error);
  }
}

main().catch((err) => {
  console.error("Необработанная ошибка в main():", err);
});